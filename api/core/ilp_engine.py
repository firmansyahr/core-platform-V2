import functools
import json
from pathlib import Path

import pandas as pd

from api.core.data_loader import load_data
from api.core.aegis_engine import get_store_crs
from api.core.competitor_engine import (
    load_marketshare_brand,
    load_share_provinsi,
    triangulate_aegis_with_asperssi,
)

REWARD: dict[str, int] = {"SEMEN ELANG": 5_000, "SEMEN BADAK": 2_500}
ILP_MONTHS = 6
_MAX_CANDIDATES = 3_000

# Default weights (must sum to 1.0)
W_RATIO_DEFAULT  = 0.47
W_TRX_DEFAULT    = 0.43
W_GROWTH_DEFAULT = 0.10

_GMM_RESULT_PATH = Path("api/data/models/gmm_training_result.json")

# Score multiplier per GMM category (< 1 de-prioritizes, > 1 boosts)
CANNIBALIZATION_ADJUSTMENTS: dict[str, float] = {
    "kanibalisasi":                    0.70,
    "kanibalisasi_sebagian_eksternal": 0.85,
    "tekanan_eksternal":               1.30,
    "fighting_brand_shift":            1.25,
    "perlu_investigasi":               1.10,
    "campuran":                        1.05,
    "de_kanibalisasi":                 1.00,
    "stabil":                          1.00,
}


def load_cannibalization_results() -> dict | None:
    if not _GMM_RESULT_PATH.exists():
        return None
    try:
        return json.loads(_GMM_RESULT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def apply_cannibalization_adjustment(
    scored_df: pd.DataFrame,
    gmm_result: dict | None,
) -> pd.DataFrame:
    """
    Adds GMM-derived columns to a scored DataFrame:
      score_original         — original ILP score (copy of score)
      cannibalization_category / label / confidence
      adjustment_factor      — confidence-scaled multiplier
      score_adjusted         — score * adjustment_factor (ILP objective)
    When gmm_result is None all adjustments are 1.0 and score_adjusted = score.
    """
    df = scored_df.copy()
    df["score_original"] = df["score"]

    if gmm_result is None:
        df["cannibalization_category"]   = None
        df["cannibalization_label"]      = None
        df["cannibalization_confidence"] = None
        df["adjustment_factor"]          = 1.0
        df["score_adjusted"]             = df["score"]
        return df

    assignments: list[dict] = gmm_result.get("store_assignments", [])
    interps: dict            = gmm_result.get("cluster_interpretations", {})
    lookup = {str(s["ID Toko"]): s for s in assignments}

    categories, labels, confidences, factors = [], [], [], []
    for toko_id in df["ID Toko"].astype(str):
        s = lookup.get(toko_id)
        if s is None:
            categories.append(None)
            labels.append(None)
            confidences.append(None)
            factors.append(1.0)
            continue
        cl_id      = str(s["cluster"])
        interp     = interps.get(cl_id, {})
        category   = interp.get("category", "campuran")
        confidence = float(s.get(f"prob_cluster_{cl_id}", 0.5))
        base_adj   = CANNIBALIZATION_ADJUSTMENTS.get(category, 1.0)
        scaled     = 1.0 + (base_adj - 1.0) * confidence
        categories.append(category)
        labels.append(interp.get("label"))
        confidences.append(round(confidence, 3))
        factors.append(round(scaled, 3))

    df["cannibalization_category"]   = categories
    df["cannibalization_label"]      = labels
    df["cannibalization_confidence"] = confidences
    df["adjustment_factor"]          = factors
    df["score_adjusted"]             = (df["score"] * df["adjustment_factor"]).round(4)
    return df


# ── Competitor Intelligence adjustment — layer KEDUA setelah GMM ───────────────

# Score multiplier per verdict triangulasi ASPERSSI (level provinsi)
COMPETITOR_VERDICT_ADJUSTMENTS: dict[str, float] = {
    "KONFIRMASI_KOMPETITOR":  1.30,
    "WASPADA_AWAL":           1.15,
    "INTERNAL_ATAU_SEASONAL": 1.00,
    "TIDAK_CUKUP_DATA":       1.00,
    "NORMAL":                 1.00,
}

# Kategori GMM (level toko) dengan bukti AKTIF pola internal — BUKAN
# "stabil" (yang cuma berarti tidak ada sinyal brand-shift menonjol, bukan
# klaim aktif "ini internal"). Kontradiksi sejati hanya terjadi kalau GMM
# punya bukti aktif ke arah internal yang berlawanan dengan bukti eksternal
# dari triangulasi provinsi — ini dianggap sinyal bertentangan (bukan
# auto-resolve).
_GMM_INTERNAL_CATEGORIES   = {"kanibalisasi", "de_kanibalisasi"}
_COMPETITOR_EXTERNAL_VERDICTS = {"KONFIRMASI_KOMPETITOR", "WASPADA_AWAL"}


def load_competitor_triangulation() -> list[dict] | None:
    """
    Triangulasi AEGIS + ASPERSSI per provinsi (lihat competitor_engine.py).
    Tidak ada cache file terpisah untuk hasil triangulasi itu sendiri — tapi
    store_crs di baliknya sudah ter-cache via aegis_engine.get_store_crs()
    (lru_cache), jadi pemanggilan berulang dari /api/ilp/run tetap cepat
    setelah panggilan pertama. Return None kalau data AEGIS belum tersedia.
    """
    store_crs = get_store_crs()
    if store_crs is None or store_crs.empty:
        return None
    sp = load_share_provinsi()
    ms = load_marketshare_brand()
    return triangulate_aegis_with_asperssi(store_crs, sp, ms)


def apply_competitor_adjustment(
    scored_df: pd.DataFrame,
    triangulation_results: list[dict] | None,
) -> pd.DataFrame:
    """
    Layer KEDUA setelah GMM (apply_cannibalization_adjustment harus dipanggil
    lebih dulu — fungsi ini butuh kolom cannibalization_category, score,
    adjustment_factor, score_adjusted yang sudah ada).

    Pendekatan human-in-the-loop: kalau sinyal GMM (level toko, "internal")
    dan Competitor Intel (level provinsi, "eksternal") bertentangan untuk
    toko yang sama, JANGAN auto-resolve dengan mengalikan kedua faktor —
    combined_adjustment_factor di-set netral (1.0, kembali ke skor dasar)
    dan toko ditandai sinyal_bertentangan=True dengan conflict_note untuk
    validasi manual TSO/ASM.

    Menambah kolom: competitor_verdict, competitor_top_brand,
    competitor_factor, sinyal_bertentangan, conflict_note,
    combined_adjustment_factor, score_final.

    Kalau triangulation_results None (data tidak tersedia atau toggle off):
    combined_adjustment_factor = adjustment_factor (GMM saja), score_final =
    score_adjusted — perilaku identik dengan sebelum Competitor Intel ada.
    """
    df = scored_df.copy()

    if triangulation_results is None:
        df["competitor_verdict"]         = None
        df["competitor_top_brand"]       = None
        df["competitor_factor"]          = 1.0
        df["sinyal_bertentangan"]        = False
        df["conflict_note"]              = None
        df["combined_adjustment_factor"] = df["adjustment_factor"]
        df["score_final"]                = df["score_adjusted"]
        return df

    by_provinsi = {t["provinsi"]: t for t in triangulation_results}

    verdict_map     = {p: t["verdict"] for p, t in by_provinsi.items()}
    top_brand_map   = {
        p: (t.get("top_competitor") or {}).get("brand") for p, t in by_provinsi.items()
    }

    # NB: unmatched provinsi → NaN (float) here, not None — pandas coerces
    # None back to NaN for object/string columns built via .map(), so the
    # NaN→None normalization for API output happens at the router boundary
    # (api/routers/ilp.py::_safe_str), not here.
    df["competitor_verdict"]   = df["Provinsi Toko"].map(verdict_map)
    df["competitor_top_brand"] = df["Provinsi Toko"].map(top_brand_map)
    df["competitor_factor"] = (
        df["competitor_verdict"].map(COMPETITOR_VERDICT_ADJUSTMENTS).fillna(1.0)
    )

    df["sinyal_bertentangan"] = (
        df["cannibalization_category"].isin(_GMM_INTERNAL_CATEGORIES)
        & df["competitor_verdict"].isin(_COMPETITOR_EXTERNAL_VERDICTS)
    )

    df["combined_adjustment_factor"] = (df["adjustment_factor"] * df["competitor_factor"]).round(3)
    df["score_final"] = (df["score"] * df["combined_adjustment_factor"]).round(4)

    # Konflik → netral (kembali ke skor dasar), bukan auto-resolve
    df.loc[df["sinyal_bertentangan"], "combined_adjustment_factor"] = 1.0
    df.loc[df["sinyal_bertentangan"], "score_final"] = df.loc[df["sinyal_bertentangan"], "score"].round(4)

    def _conflict_note(row: pd.Series) -> str | None:
        if not row["sinyal_bertentangan"]:
            return None
        brand = row["competitor_top_brand"]
        brand_txt = f" (kompetitor: {brand})" if pd.notna(brand) else ""
        label = row["cannibalization_label"] or row["cannibalization_category"]
        return (
            f"Sinyal bertentangan: analisis brand-shift toko ini menunjukkan "
            f"'{label}' (pola internal), namun provinsi toko terindikasi "
            f"'{row['competitor_verdict']}' dari triangulasi ASPERSSI{brand_txt}. "
            f"Skor dikembalikan ke nilai dasar — disarankan validasi lapangan "
            f"TSO sebelum menentukan prioritas program."
        )

    df["conflict_note"] = df.apply(_conflict_note, axis=1)
    return df


def _ilp_mask(df: pd.DataFrame) -> pd.Series:
    """Boolean mask: SEMEN ELANG or SEMEN BADAK SERBAGUNA."""
    elang = df["Brands"] == "SEMEN ELANG"
    badak = (df["Brands"] == "SEMEN BADAK") & (
        df["Nama Produk"]
        .str.upper()
        .str.replace(" ", "", regex=False)
        .str.contains("SERBAGUNA", na=False)
    )
    return elang | badak


def _minmax_scale(s: pd.Series, fill: float = 0.0) -> pd.Series:
    """MinMax-normalize a series to 0–100. Constant series → 50."""
    s = s.fillna(fill)
    mn, mx = float(s.min()), float(s.max())
    if mx <= mn:
        return pd.Series(50.0, index=s.index)
    return (s - mn) / (mx - mn) * 100.0


def compute_ilp_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute per-store raw features (no scoring).
    Expensive — results are cached via get_ilp_features().
    Returns columns: ID Toko, avg_ton, avg_trx, ton_growth,
    ratio_vs_cluster, estimated_cost, brand_category,
    Nama Toko, Kabupaten Toko, Provinsi Toko, Cluster Pareto, SSM, ASM, TSO.
    """
    df = df.copy()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()
    window_periods = [latest - i for i in range(ILP_MONTHS)]

    ilp = _ilp_mask(df)
    win = df[period_col.isin(window_periods) & ilp].copy()
    win["_period"] = period_col[win.index]
    win["_brand"] = win["Brands"].map({"SEMEN ELANG": "elang"}).fillna("badak")

    if win.empty:
        return pd.DataFrame()

    monthly = (
        win.groupby(["ID Toko", "_period"])
        .agg(ton=("TON Quantity", "sum"), trx=("No Transaksi", "nunique"))
        .reset_index()
    )
    stores = monthly.groupby("ID Toko").agg(
        avg_ton=("ton", "mean"),
        avg_trx=("trx", "mean"),
    )

    # ton_growth: recent 3 months vs early 3 months of the 6-month window
    recent_p = [latest - i for i in range(3)]
    early_p  = [latest - i for i in range(3, 6)]

    def _period_sum(ps: list) -> pd.Series:
        return (
            win[win["_period"].isin(ps)]
            .groupby("ID Toko")["TON Quantity"]
            .sum()
            .reindex(stores.index, fill_value=0)
        )

    early_vol  = _period_sum(early_p)
    recent_vol = _period_sum(recent_p)
    stores["ton_growth"] = (recent_vol - early_vol) / early_vol.clip(lower=1) * 100

    # Store metadata
    meta_cols = [
        "ID Toko", "Nama Toko", "Kabupaten Toko", "Provinsi Toko",
        "Cluster Pareto", "SSM", "ASM", "TSO",
    ]
    store_meta = (
        df.sort_values("Tanggal Transaksi", ascending=False)[meta_cols]
        .drop_duplicates("ID Toko")
        .set_index("ID Toko")
    )
    stores = stores.join(store_meta, how="left")

    # ratio_vs_cluster: avg_ton / cluster median
    cluster_med = stores.groupby("Cluster Pareto")["avg_ton"].median()
    stores["ratio_vs_cluster"] = (
        stores["avg_ton"] / stores["Cluster Pareto"].map(cluster_med).clip(lower=0.01)
    )

    # Estimated annual incentive cost
    brand_mon = (
        win.groupby(["ID Toko", "_brand", "_period"])["TON Quantity"]
        .sum()
        .groupby(["ID Toko", "_brand"])
        .mean()
        .unstack("_brand", fill_value=0)
        .reindex(columns=["elang", "badak"], fill_value=0)
        .reindex(stores.index, fill_value=0)
    )
    stores["avg_ton_elang"] = brand_mon["elang"]
    stores["avg_ton_badak"] = brand_mon["badak"]
    stores["estimated_cost"] = (
        brand_mon["elang"] * REWARD["SEMEN ELANG"]
        + brand_mon["badak"] * REWARD["SEMEN BADAK"]
    ) * 12

    has_e = brand_mon["elang"] > 0
    has_b = brand_mon["badak"] > 0
    stores["brand_category"] = "Companion Only"
    stores.loc[has_e, "brand_category"] = "Main Only"
    stores.loc[has_e & has_b, "brand_category"] = "Mix"

    return stores.reset_index()


def apply_ilp_scoring(
    features_df: pd.DataFrame,
    weight_ratio:  float = W_RATIO_DEFAULT,
    weight_trx:    float = W_TRX_DEFAULT,
    weight_growth: float = W_GROWTH_DEFAULT,
) -> pd.DataFrame:
    """
    MinMax-normalize the three raw features to 0–100, then compute
    weighted composite score.  Adds columns:
      ratio_score, trx_score, growth_score, score
    """
    df = features_df.copy()
    df["ratio_score"]  = _minmax_scale(df["ratio_vs_cluster"])
    df["trx_score"]    = _minmax_scale(df["avg_trx"])
    df["growth_score"] = _minmax_scale(df["ton_growth"])
    df["score"] = (
        df["ratio_score"]  * weight_ratio
        + df["trx_score"]  * weight_trx
        + df["growth_score"] * weight_growth
    )
    return df


def solve_ilp(
    scores_df: pd.DataFrame,
    budget: float,
    n_max: int,
    cluster_max_pct: dict[str, float] | None = None,
    provinsi_filter: list[str] | None = None,
    ssm_filter: list[str] | None = None,
    asm_filter: list[str] | None = None,
    tso_filter: list[str] | None = None,
) -> tuple[pd.DataFrame, str]:
    """
    Binary ILP: maximize Σ(score × x) subject to budget, n_max, and
    optional per-cluster max-% and org/region filters.
    Falls back to greedy if solver unavailable or infeasible.
    """
    df = scores_df[scores_df["estimated_cost"] > 0].copy()

    if provinsi_filter:
        df = df[df["Provinsi Toko"].isin(provinsi_filter)]
    if ssm_filter:
        df = df[df["SSM"].isin(ssm_filter)]
    if asm_filter:
        df = df[df["ASM"].isin(asm_filter)]
    if tso_filter:
        df = df[df["TSO"].isin(tso_filter)]

    if df.empty:
        return pd.DataFrame(columns=scores_df.columns), "Tidak ada kandidat setelah filter"

    cand = df.nlargest(min(len(df), _MAX_CANDIDATES), "score").reset_index(drop=True)
    n = len(cand)
    scores_list = cand["score"].tolist()
    costs_list  = cand["estimated_cost"].tolist()

    cluster_groups: dict[str, list[int]] = {
        cl: grp.index.tolist()
        for cl, grp in cand.groupby("Cluster Pareto", sort=False)
    }

    try:
        from pulp import PULP_CBC_CMD, LpMaximize, LpProblem, LpVariable, lpSum

        prob = LpProblem("ILP_Store_Selection", LpMaximize)
        x = [LpVariable(f"x_{i}", cat="Binary") for i in range(n)]

        prob += lpSum(scores_list[i] * x[i] for i in range(n))
        prob += lpSum(costs_list[i]  * x[i] for i in range(n)) <= budget
        prob += lpSum(x[i] for i in range(n)) <= n_max

        if cluster_max_pct:
            for cl, max_pct in cluster_max_pct.items():
                if max_pct > 0 and cl in cluster_groups:
                    max_count = max(1, int(max_pct / 100 * n_max))
                    prob += lpSum(x[i] for i in cluster_groups[cl]) <= max_count

        prob.solve(PULP_CBC_CMD(msg=0, timeLimit=30))

        if prob.status == 1:
            sel = [i for i, v in enumerate(x) if v.varValue is not None and v.varValue > 0.5]
            return cand.iloc[sel].reset_index(drop=True), "Optimal"
    except Exception:
        pass

    # Greedy fallback
    out: list = []
    cum = 0.0
    cluster_counts: dict[str, int] = {}
    for _, row in cand.sort_values("score", ascending=False).iterrows():
        if len(out) >= n_max:
            break
        if cum + row["estimated_cost"] > budget:
            continue
        cl = str(row.get("Cluster Pareto", ""))
        if cluster_max_pct and cl in cluster_max_pct and cluster_max_pct[cl] > 0:
            max_count = max(1, int(cluster_max_pct[cl] / 100 * n_max))
            if cluster_counts.get(cl, 0) >= max_count:
                continue
        out.append(row)
        cluster_counts[cl] = cluster_counts.get(cl, 0) + 1
        cum += row["estimated_cost"]

    result = (
        pd.DataFrame(out).reset_index(drop=True)
        if out
        else pd.DataFrame(columns=cand.columns)
    )
    return result, "Greedy fallback"


@functools.lru_cache(maxsize=1)
def get_ilp_features() -> pd.DataFrame:
    """Cached raw feature computation — independent of user weights."""
    return compute_ilp_features(load_data())


@functools.lru_cache(maxsize=1)
def get_ilp_hierarchy() -> dict:
    """Returns SSM→ASM→TSO hierarchy and provinsi list for frontend filters."""
    df = load_data()
    h = (
        df[["SSM", "ASM", "TSO"]]
        .drop_duplicates()
        .dropna(subset=["SSM", "ASM", "TSO"])
    )

    provinsi = sorted(df["Provinsi Toko"].dropna().unique().tolist())

    tree: dict[str, dict[str, list[str]]] = {}
    for _, row in h.iterrows():
        ssm, asm, tso = str(row["SSM"]), str(row["ASM"]), str(row["TSO"])
        tree.setdefault(ssm, {}).setdefault(asm, set()).add(tso)  # type: ignore[arg-type]

    sorted_tree = {
        ssm: {asm: sorted(tsos) for asm, tsos in asms.items()}  # type: ignore[attr-defined]
        for ssm, asms in sorted(tree.items())
    }
    return {"provinsi": provinsi, "hierarchy": sorted_tree}

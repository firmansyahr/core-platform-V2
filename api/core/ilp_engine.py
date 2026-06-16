import functools

import pandas as pd

from api.core.data_loader import load_data

REWARD: dict[str, int] = {"SEMEN ELANG": 5_000, "SEMEN BADAK": 2_500}
ILP_MONTHS = 6
_MAX_CANDIDATES = 3_000

# Default weights (must sum to 1.0)
W_RATIO_DEFAULT  = 0.47
W_TRX_DEFAULT    = 0.43
W_GROWTH_DEFAULT = 0.10


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

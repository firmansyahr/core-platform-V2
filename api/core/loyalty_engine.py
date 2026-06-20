"""Loyalty program analytics — takeout scoring, smart promotions, ILP recommendations."""
from __future__ import annotations

import calendar
from datetime import datetime, timezone

import numpy as np
import pandas as pd

REWARD_RATES: dict[str, int] = {
    "Emergency Boost": 15_000,
    "Retention Boost": 10_000,
    "Loyalty Reward":  10_000,
    "Standard":         5_000,
}


def _ton_window(id_toko: str, df: pd.DataFrame, periods: list) -> float:
    """Average monthly TON for a store over given period list."""
    sub = df[(df["ID Toko"] == id_toko) & (df["_p"].isin(periods))]
    if sub.empty:
        return 0.0
    return float(sub.groupby("_p")["TON Quantity"].sum().mean())


def get_takeout_recommendations(
    members_df: pd.DataFrame,
    df_transaksi: pd.DataFrame,
    store_crs: pd.DataFrame,
) -> pd.DataFrame:
    """
    Score each active loyalty member for potential take-out.
    Criteria:
      volume_turun   (+3): avg TON last 3m < avg 3m prior × 0.7
      tidak_aktif    (+4): no transaction in last 60 days
      sudah_normal   (+2): current pola = D
      efisiensi_rendah (+1): avg_ton below 80% of cluster median
    Returns only members with skor >= 3.
    """
    active = members_df[members_df["status"] == "Aktif"].copy()
    if active.empty:
        return pd.DataFrame()

    today = datetime.now(timezone.utc).date()
    df = df_transaksi.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")
    latest_p = df["_p"].max()
    recent_p = [latest_p - i for i in range(3)]
    prior_p  = [latest_p - i for i in range(3, 6)]

    crs_idx: pd.DataFrame = (
        store_crs.set_index("ID Toko")
        if "ID Toko" in store_crs.columns
        else pd.DataFrame()
    )

    # Pre-compute cluster medians to avoid O(n²) loops per cluster
    cluster_medians: dict[str, float] = {}
    for cl in active["cluster_pareto"].dropna().unique():
        cl_ids = active.loc[active["cluster_pareto"] == cl, "id_toko"].astype(str).tolist()
        vols = [_ton_window(tid, df, recent_p) for tid in cl_ids]
        cluster_medians[cl] = float(np.median(vols)) if vols else 0.0

    results: list[dict] = []
    for _, m in active.iterrows():
        id_toko     = str(m["id_toko"])
        reward_type = str(m.get("reward_type", "Standard"))
        rate        = REWARD_RATES.get(reward_type, 5_000)

        recent_vol = _ton_window(id_toko, df, recent_p)
        prior_vol  = _ton_window(id_toko, df, prior_p)

        skor: int = 0
        alasan: list[str] = []

        # volume_turun
        if prior_vol > 0 and recent_vol < prior_vol * 0.7:
            skor += 3
            alasan.append("Volume Turun >30%")

        # tidak_aktif
        sdf = df[df["ID Toko"] == id_toko]
        if sdf.empty:
            skor += 4
            alasan.append("Tidak Aktif 60 Hari")
        else:
            last_date = sdf["Tanggal Transaksi"].max().date()
            if (today - last_date).days >= 60:
                skor += 4
                alasan.append("Tidak Aktif 60 Hari")

        # sudah_normal (pola D current)
        if not crs_idx.empty and id_toko in crs_idx.index:
            if str(crs_idx.at[id_toko, "pola_kode"] or "N") == "D":
                skor += 2
                alasan.append("Sudah Normal (Pola D)")

        # efisiensi_rendah
        cl = str(m.get("cluster_pareto", ""))
        cl_med = cluster_medians.get(cl, 0.0)
        if cl_med > 0 and 0 < recent_vol < cl_med * 0.8:
            skor += 1
            alasan.append("Efisiensi Rendah")

        if skor >= 3:
            avg_ton = recent_vol if recent_vol > 0 else prior_vol
            results.append({
                "id":             str(m.get("id", id_toko)),
                "id_toko":        id_toko,
                "nama_toko":      str(m.get("nama_toko", "")),
                "kabupaten":      str(m.get("kabupaten", "")),
                "cluster_pareto": cl,
                "tso":            str(m.get("tso", "")),
                "reward_type":    reward_type,
                "skor":           skor,
                "alasan":         alasan,
                "budget_dihemat": round(avg_ton * rate),
            })

    if not results:
        return pd.DataFrame()
    return (
        pd.DataFrame(results)
        .sort_values("skor", ascending=False)
        .reset_index(drop=True)
    )


def _get_gmm_info(id_toko: str, gmm_lookup: dict, interps: dict) -> dict:
    s = gmm_lookup.get(str(id_toko))
    if s is None:
        return {"category": None, "label": None, "confidence": None}
    cl_id = str(s["cluster"])
    interp = interps.get(cl_id, {})
    conf   = float(s.get(f"prob_cluster_{cl_id}", 0.5))
    return {"category": interp.get("category"), "label": interp.get("label"), "confidence": round(conf, 3)}


def get_smart_promotions(
    members_df: pd.DataFrame,
    df_transaksi: pd.DataFrame,
    store_crs: pd.DataFrame,
    gmm_result: dict | None = None,
) -> pd.DataFrame:
    """
    Determine recommended promo type per active member:
      Emergency Boost : Merah + Pola B  → 15 000/ton, 1 month
      Retention Boost : Oranye + Pola A → 10 000/ton, 2 months
      Loyalty Reward  : Pola D + vol +10% → 10 000/ton, 3 months
      Standard        : else             →  5 000/ton
    When gmm_result is provided, kanibalisasi stores are downgraded and
    tekanan_eksternal / fighting_brand_shift stores are upgraded.
    Returns member rows with tipe_promo, rate, est_budget, est_roi,
    plus gmm_category, override_reason, original_recommendation.
    """
    active = members_df[members_df["status"] == "Aktif"].copy()
    if active.empty:
        return pd.DataFrame()

    df = df_transaksi.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")
    latest_p = df["_p"].max()
    recent_p = [latest_p - i for i in range(3)]
    prior_p  = [latest_p - i for i in range(3, 6)]

    crs_idx: pd.DataFrame = (
        store_crs.set_index("ID Toko")
        if "ID Toko" in store_crs.columns
        else pd.DataFrame()
    )

    # Build GMM lookup once for O(1) per-store access
    gmm_lookup: dict = {}
    gmm_interps: dict = {}
    if gmm_result:
        gmm_lookup  = {str(s["ID Toko"]): s for s in gmm_result.get("store_assignments", [])}
        gmm_interps = gmm_result.get("cluster_interpretations", {})

    results: list[dict] = []
    for _, m in active.iterrows():
        id_toko     = str(m["id_toko"])
        promo_aktif = str(m.get("reward_type", "Standard"))

        level = "Normal"; pola_kode = "N"; aegis_score = 0.0
        if not crs_idx.empty and id_toko in crs_idx.index:
            level       = str(crs_idx.at[id_toko, "alert"]       or "Normal")
            pola_kode   = str(crs_idx.at[id_toko, "pola_kode"]   or "N")
            aegis_score = float(crs_idx.at[id_toko, "aegis_score"] or 0.0)

        recent_vol = _ton_window(id_toko, df, recent_p)
        prior_vol  = _ton_window(id_toko, df, prior_p)
        vol_growth = (
            (recent_vol - prior_vol) / prior_vol * 100
            if prior_vol > 0 else 0.0
        )

        # Base AEGIS recommendation
        if level == "Merah" and pola_kode == "B":
            tipe_promo = "Emergency Boost"; durasi = 1
        elif level == "Oranye" and pola_kode == "A":
            tipe_promo = "Retention Boost"; durasi = 2
        elif pola_kode == "D" and vol_growth > 10:
            tipe_promo = "Loyalty Reward";  durasi = 3
        else:
            tipe_promo = "Standard";        durasi = 0

        # GMM override/modifier
        original_recommendation: str | None = None
        override_reason:         str | None = None
        gmm_category:            str | None = None
        gmm_label:               str | None = None
        gmm_confidence:          float | None = None

        if gmm_result:
            g = _get_gmm_info(id_toko, gmm_lookup, gmm_interps)
            gmm_category   = g["category"]
            gmm_label      = g["label"]
            gmm_confidence = g["confidence"]

            if gmm_category == "kanibalisasi" and tipe_promo in ("Emergency Boost", "Retention Boost"):
                original_recommendation = tipe_promo
                tipe_promo = "Standard"
                durasi = 0
                override_reason = (
                    f"AEGIS mendeteksi pola {pola_kode} (level {level}), namun analisis "
                    f"brand-shift menunjukkan ini pola Kanibalisasi Internal "
                    f"(Elang→Badak, volume stabil) — bukan kehilangan revenue nyata. "
                    f"Reward diturunkan ke Standard untuk efisiensi budget."
                )
            elif gmm_category in ("tekanan_eksternal", "fighting_brand_shift") and tipe_promo == "Standard":
                original_recommendation = tipe_promo
                tipe_promo = "Retention Boost"
                durasi = 2
                override_reason = (
                    f"Analisis brand-shift menunjukkan indikasi {gmm_label} "
                    f"meski AEGIS belum menaikkan level warning. Rekomendasi reward "
                    f"dinaikkan sebagai tindakan pencegahan dini."
                )

        rate       = REWARD_RATES[tipe_promo]
        avg_ton    = recent_vol if recent_vol > 0 else prior_vol
        est_budget = avg_ton * rate
        est_roi    = (
            round(avg_ton * 800_000 / max(est_budget, 1), 2)
            if est_budget > 0 else 0.0
        )

        results.append({
            "id":            str(m.get("id", id_toko)),
            "id_toko":       id_toko,
            "nama_toko":     str(m.get("nama_toko", "")),
            "kabupaten":     str(m.get("kabupaten", "")),
            "cluster_pareto": str(m.get("cluster_pareto", "")),
            "tso":           str(m.get("tso", "")),
            "aegis_score":   round(aegis_score, 2),
            "level":         level,
            "promo_aktif":   promo_aktif,
            "tipe_promo":    tipe_promo,
            "rate":          rate,
            "durasi":        durasi,
            "est_budget":    round(est_budget),
            "est_roi":       est_roi,
            "gmm_category":            gmm_category,
            "gmm_label":               gmm_label,
            "gmm_confidence":          gmm_confidence,
            "override_reason":         override_reason,
            "original_recommendation": original_recommendation,
        })

    return pd.DataFrame(results).reset_index(drop=True) if results else pd.DataFrame()


def get_ilp_recommendations(
    store_crs: pd.DataFrame,
    loyalty_member_ids: set[str],
    limit: int = 50,
) -> pd.DataFrame:
    """Top ILP-scored stores not yet in the loyalty program."""
    from api.core.ilp_engine import apply_ilp_scoring, get_ilp_features  # lazy to avoid circular

    ilp_feat = get_ilp_features()
    if ilp_feat.empty:
        return pd.DataFrame()

    scored = apply_ilp_scoring(ilp_feat)
    scored = scored[~scored["ID Toko"].isin(loyalty_member_ids)].copy()

    if "ID Toko" in store_crs.columns:
        crs_slim = store_crs[["ID Toko", "alert", "aegis_score"]].copy()
        scored = scored.merge(crs_slim, on="ID Toko", how="left")

    if "alert" not in scored.columns:
        scored["alert"] = "Normal"
    if "aegis_score" not in scored.columns:
        scored["aegis_score"] = 0.0

    scored["alert"]       = scored["alert"].fillna("Normal")
    scored["aegis_score"] = scored["aegis_score"].fillna(0.0)

    return scored.nlargest(limit, "score").reset_index(drop=True)


# ── Target system ─────────────────────────────────────────────────────────────

DEFAULT_CONFIG: dict = {
    "w1": 0.6,
    "w2": 0.4,
    "min_pct_sp": 0.80,
    "min_pct_platinum": 0.70,
    "min_pct_gold": 0.60,
    "min_pct_silver": 0.50,
    "growth_rates": {
        "default": {
            "normal": 0.03,
            "warning": 0.01,
            "kritis": 0.00,
        },
        "overrides": [],
    },
}

_CLUSTER_FLOOR_KEY: dict[str, str | None] = {
    "Super Platinum": "min_pct_sp",
    "Platinum": "min_pct_platinum",
    "Gold": "min_pct_gold",
    "Silver": "min_pct_silver",
    "Bronze": None,
}


def get_growth_rate(
    kondisi: str,
    bulan: int,
    tahun: int,
    growth_rates_cfg: dict,
) -> tuple[float, str]:
    """
    Return (growth_rate, source_label) for the given period and condition.

    Priority: monthly override > quarterly override > default.
    kondisi must be one of 'normal', 'warning', 'kritis'.
    """
    overrides = growth_rates_cfg.get("overrides", [])

    # 1. Monthly override (highest priority)
    for ov in overrides:
        if ov.get("type") == "monthly" and ov.get("bulan") == bulan and ov.get("tahun") == tahun:
            return float(ov.get(kondisi, 0.0)), str(ov.get("label", "Override"))

    # 2. Quarterly override
    kuartal = ((bulan - 1) // 3) + 1
    for ov in overrides:
        if ov.get("type") == "quarterly" and ov.get("kuartal") == kuartal and ov.get("tahun") == tahun:
            return float(ov.get(kondisi, 0.0)), str(ov.get("label", "Override"))

    # 3. Default
    default = growth_rates_cfg.get("default", {})
    return float(default.get(kondisi, 0.0)), "Default"


def calculate_loyalty_targets(
    members_df: pd.DataFrame,
    df_transaksi: pd.DataFrame,
    store_crs: pd.DataFrame,
    config: dict | None = None,
) -> pd.DataFrame:
    """
    Hybrid Adaptive Target per active loyalty member.

    Base_1 = avg TON last 3 complete months
    Base_2 = same-month YoY (if available)
    Baseline = Base_1*w1 + Base_2*w2  (or Base_1 alone if no YoY)
    growth_rate by AEGIS condition + period overrides (monthly > quarterly > default):
        Pola D / score<40  → 'normal' rate
        Pola B / score≥65  → 'kritis' rate
        else               → 'warning' rate
    target_final = max(target_hybrid, cluster_floor)
    """
    cfg: dict = {**DEFAULT_CONFIG, **(config or {})}
    active = members_df[members_df["status"] == "Aktif"].copy()
    if active.empty:
        return pd.DataFrame()

    df = df_transaksi.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")

    latest_p = df["_p"].max()
    max_date = df[df["_p"] == latest_p]["Tanggal Transaksi"].max()
    days_elapsed = int(max_date.day)
    days_total = calendar.monthrange(latest_p.year, latest_p.month)[1]

    complete_months = [latest_p - i for i in range(1, 4)]
    yoy_month = latest_p - 12
    bulan = latest_p.month
    tahun = latest_p.year
    growth_rates_cfg: dict = cfg.get("growth_rates", DEFAULT_CONFIG["growth_rates"])

    # Pre-aggregate store × period for O(1) lookups
    agg_dict: dict = (
        df.groupby(["ID Toko", "_p"])["TON Quantity"]
        .sum()
        .to_dict()
    )

    crs_idx = (
        store_crs.set_index("ID Toko")
        if "ID Toko" in store_crs.columns
        else pd.DataFrame()
    )

    # Cluster medians (from members' Base_1 values) for floor computation
    cluster_medians: dict[str, float] = {}
    for cl in active["cluster_pareto"].dropna().unique():
        cl_ids = active.loc[active["cluster_pareto"] == cl, "id_toko"].astype(str).tolist()
        base1_vals: list[float] = []
        for tid in cl_ids:
            vals = [agg_dict.get((tid, p), 0.0) for p in complete_months]
            nonzero = [v for v in vals if v > 0]
            base1_vals.append(float(np.mean(nonzero)) if nonzero else 0.0)
        nonzero_cl = [v for v in base1_vals if v > 0]
        cluster_medians[cl] = float(np.median(nonzero_cl)) if nonzero_cl else 0.0

    results: list[dict] = []
    for _, m in active.iterrows():
        id_toko = str(m["id_toko"])
        cluster = str(m.get("cluster_pareto", ""))

        pola_kode = "N"
        aegis_score = 0.0
        if not crs_idx.empty and id_toko in crs_idx.index:
            pola_kode = str(crs_idx.at[id_toko, "pola_kode"] or "N")
            aegis_score = float(crs_idx.at[id_toko, "aegis_score"] or 0.0)

        # Base_1: avg last 3 complete months
        b1_vals = [agg_dict.get((id_toko, p), 0.0) for p in complete_months]
        b1_nonzero = [v for v in b1_vals if v > 0]
        base1 = float(np.mean(b1_nonzero)) if b1_nonzero else 0.0

        # Base_2: same month YoY
        b2_raw = agg_dict.get((id_toko, yoy_month), 0.0)
        base2: float | None = float(b2_raw) if b2_raw > 0 else None

        # Baseline
        if base2 is not None:
            baseline = base1 * cfg["w1"] + base2 * cfg["w2"]
        else:
            baseline = base1

        # Growth rate: AEGIS condition determines kondisi, period overrides may apply
        if pola_kode == "D" or aegis_score < 40:
            kondisi = "normal"
        elif pola_kode == "B" or aegis_score >= 65:
            kondisi = "kritis"
        else:
            kondisi = "warning"
        growth_rate, growth_label = get_growth_rate(kondisi, bulan, tahun, growth_rates_cfg)

        target_hybrid = baseline * (1 + growth_rate)

        # Cluster floor
        floor_key = _CLUSTER_FLOOR_KEY.get(cluster)
        floor_pct = float(cfg.get(floor_key, 0.0)) if floor_key else 0.0
        cl_median = cluster_medians.get(cluster, 0.0)
        min_target = cl_median * floor_pct if floor_pct > 0 and cl_median > 0 else 0.0

        target_final = max(target_hybrid, min_target) if (target_hybrid > 0 or min_target > 0) else 0.0

        # Realisasi: TON in latest (partial) month
        realisasi = float(agg_dict.get((id_toko, latest_p), 0.0))

        # Proyeksi: annualized to full month
        proyeksi = realisasi / max(days_elapsed, 1) * days_total

        # Achievement
        achievement_pct = (realisasi / target_final * 100) if target_final > 0 else 0.0

        if achievement_pct >= 90:
            status = "On Track"
        elif achievement_pct >= 70:
            status = "At Risk"
        else:
            status = "Below Target"

        results.append({
            "id":              str(m.get("id", id_toko)),
            "id_toko":         id_toko,
            "nama_toko":       str(m.get("nama_toko", "")),
            "kabupaten":       str(m.get("kabupaten", "")),
            "cluster_pareto":  cluster,
            "tso":             str(m.get("tso", "")),
            "reward_type":     str(m.get("reward_type", "Standard")),
            "aegis_score":     round(aegis_score, 2),
            "pola_kode":       pola_kode,
            "base1":           round(base1, 2),
            "base2":           round(base2, 2) if base2 is not None else None,
            "baseline":        round(baseline, 2),
            "growth_rate_pct": round(growth_rate * 100, 1),
            "growth_label":    growth_label,
            "target_hybrid":   round(target_hybrid, 2),
            "min_target":      round(min_target, 2),
            "target_final":    round(target_final, 2),
            "realisasi":       round(realisasi, 2),
            "proyeksi":        round(proyeksi, 2),
            "achievement_pct": round(achievement_pct, 2),
            "status":          status,
            "bulan_target":    str(latest_p),
            "days_elapsed":    days_elapsed,
            "days_total":      days_total,
        })

    return pd.DataFrame(results).reset_index(drop=True) if results else pd.DataFrame()


def calculate_historical_targets(
    members_df: pd.DataFrame,
    df_transaksi: pd.DataFrame,
    store_crs: pd.DataFrame,
    config: dict | None = None,
    bulan_start: str = "2024-01",
    bulan_end: str = "2024-12",
) -> list[dict]:
    """
    Calculate targets for every active member for each month in [bulan_start, bulan_end].
    Uses only data available UP TO each target month (no future data).
    bulan_start / bulan_end format: "YYYY-MM"
    """
    cfg: dict = {**DEFAULT_CONFIG, **(config or {})}
    active = members_df[members_df["status"] == "Aktif"].copy()
    if active.empty:
        return []

    df = df_transaksi.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")

    growth_rates_cfg: dict = cfg.get("growth_rates", DEFAULT_CONFIG["growth_rates"])
    agg_dict: dict = df.groupby(["ID Toko", "_p"])["TON Quantity"].sum().to_dict()

    crs_idx = (
        store_crs.set_index("ID Toko") if "ID Toko" in store_crs.columns else pd.DataFrame()
    )

    month_names = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"]

    try:
        start_p = pd.Period(bulan_start, "M")
        end_p   = pd.Period(bulan_end,   "M")
    except Exception:
        return []

    all_results: list[dict] = []
    p = start_p
    while p <= end_p:
        bulan = p.month
        tahun = p.year
        label = f"{month_names[bulan-1]} {tahun}"

        complete_months = [p - i for i in range(1, 4)]
        yoy_month = p - 12

        cluster_medians: dict[str, float] = {}
        for cl in active["cluster_pareto"].dropna().unique():
            cl_ids = active.loc[active["cluster_pareto"] == cl, "id_toko"].astype(str).tolist()
            b1_list: list[float] = []
            for tid in cl_ids:
                vals = [agg_dict.get((tid, pm), 0.0) for pm in complete_months]
                nz = [v for v in vals if v > 0]
                b1_list.append(float(np.mean(nz)) if nz else 0.0)
            nz_cl = [v for v in b1_list if v > 0]
            cluster_medians[cl] = float(np.median(nz_cl)) if nz_cl else 0.0

        for _, m in active.iterrows():
            id_toko = str(m["id_toko"])
            cluster = str(m.get("cluster_pareto", ""))

            pola_kode = "N"; aegis_score = 0.0
            if not crs_idx.empty and id_toko in crs_idx.index:
                pola_kode   = str(crs_idx.at[id_toko, "pola_kode"]   or "N")
                aegis_score = float(crs_idx.at[id_toko, "aegis_score"] or 0.0)

            b1_vals   = [agg_dict.get((id_toko, pm), 0.0) for pm in complete_months]
            b1_nonzero = [v for v in b1_vals if v > 0]
            base1     = float(np.mean(b1_nonzero)) if b1_nonzero else 0.0

            b2_raw = agg_dict.get((id_toko, yoy_month), 0.0)
            base2: float | None = float(b2_raw) if b2_raw > 0 else None
            baseline = base1 * cfg["w1"] + base2 * cfg["w2"] if base2 is not None else base1

            if pola_kode == "D" or aegis_score < 40:   kondisi = "normal"
            elif pola_kode == "B" or aegis_score >= 65: kondisi = "kritis"
            else:                                        kondisi = "warning"
            growth_rate, growth_label = get_growth_rate(kondisi, bulan, tahun, growth_rates_cfg)

            target_hybrid = baseline * (1 + growth_rate)
            floor_key = _CLUSTER_FLOOR_KEY.get(cluster)
            floor_pct = float(cfg.get(floor_key, 0.0)) if floor_key else 0.0
            cl_median = cluster_medians.get(cluster, 0.0)
            min_target   = cl_median * floor_pct if floor_pct > 0 and cl_median > 0 else 0.0
            target_final = max(target_hybrid, min_target) if (target_hybrid > 0 or min_target > 0) else 0.0

            realisasi       = float(agg_dict.get((id_toko, p), 0.0))
            achievement_pct = (realisasi / target_final * 100) if target_final > 0 else 0.0

            if achievement_pct >= 90:   status_ach = "On Track"
            elif achievement_pct >= 70: status_ach = "At Risk"
            else:                       status_ach = "Below Target"

            all_results.append({
                "id_toko":            id_toko,
                "nama_toko":          str(m.get("nama_toko", "")),
                "cluster":            cluster,
                "bulan":              bulan,
                "tahun":              tahun,
                "periode":            str(p),
                "periode_label":      label,
                "base_1":             round(base1, 2),
                "base_2":             round(base2, 2) if base2 is not None else None,
                "baseline":           round(baseline, 2),
                "growth_rate":        round(growth_rate * 100, 1),
                "growth_label":       growth_label,
                "target_ton":         round(target_final, 2),
                "realisasi_ton":      round(realisasi, 2),
                "achievement_pct":    round(achievement_pct, 2),
                "status_achievement": status_ach,
            })
        p = p + 1

    return all_results


def calculate_effectiveness(
    members_df: pd.DataFrame,
    df_transaksi: pd.DataFrame,
    targets_df: pd.DataFrame,
    bulan: int,
    tahun: int,
) -> dict:
    """Program effectiveness for a given month."""
    active = members_df[members_df["status"] == "Aktif"]
    total_peserta = len(active)
    if total_peserta == 0:
        return {
            "bulan": bulan, "tahun": tahun,
            "volume_achievement_pct": 0.0, "peserta_aktif_pct": 0.0,
            "efektivitas_pct": 0.0, "total_realisasi_ton": 0.0,
            "total_target_ton": 0.0, "peserta_bertransaksi": 0,
            "total_peserta": 0, "interpretasi": "Perlu Perhatian",
        }

    active_ids = set(active["id_toko"].astype(str).tolist())
    df = df_transaksi.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")
    target_p = pd.Period(f"{tahun}-{bulan:02d}", "M")

    if not targets_df.empty and "target_final" in targets_df.columns:
        total_target    = float(targets_df["target_final"].sum())
        total_realisasi = float(targets_df["realisasi"].sum())
    else:
        month_trx = df[df["_p"] == target_p]
        total_realisasi = float(
            month_trx[month_trx["ID Toko"].astype(str).isin(active_ids)]["TON Quantity"].sum()
        )
        total_target = 0.0

    volume_pct = (total_realisasi / total_target * 100) if total_target > 0 else 0.0

    month_trx  = df[df["_p"] == target_p]
    loyalty_trx = month_trx[month_trx["ID Toko"].astype(str).isin(active_ids)]
    peserta_bertransaksi = int(loyalty_trx["ID Toko"].nunique())
    aktif_pct  = (peserta_bertransaksi / total_peserta * 100) if total_peserta > 0 else 0.0

    efektivitas = (volume_pct * 0.6) + (aktif_pct * 0.4)

    if efektivitas >= 90:   interpretasi = "Sangat Baik"
    elif efektivitas >= 80: interpretasi = "Baik"
    elif efektivitas >= 60: interpretasi = "Cukup"
    else:                   interpretasi = "Perlu Perhatian"

    return {
        "bulan": bulan, "tahun": tahun,
        "volume_achievement_pct": round(volume_pct, 2),
        "peserta_aktif_pct":      round(aktif_pct, 2),
        "efektivitas_pct":        round(efektivitas, 2),
        "total_realisasi_ton":    round(total_realisasi, 2),
        "total_target_ton":       round(total_target, 2),
        "peserta_bertransaksi":   peserta_bertransaksi,
        "total_peserta":          total_peserta,
        "interpretasi":           interpretasi,
    }


def get_target_triggers(targets_df: pd.DataFrame) -> pd.DataFrame:
    """
    Members whose achievement triggers a reward type change suggestion:
    achievement < 70%  → Retention Boost
    achievement > 110% → Loyalty Reward
    """
    if targets_df.empty:
        return pd.DataFrame()

    mask = (targets_df["achievement_pct"] < 70) | (targets_df["achievement_pct"] > 110)
    triggered = targets_df[mask].copy()
    if triggered.empty:
        return pd.DataFrame()

    triggered["trigger_reward"] = triggered["achievement_pct"].apply(
        lambda x: "Retention Boost" if x < 70 else "Loyalty Reward"
    )
    triggered["trigger_alasan"] = triggered["achievement_pct"].apply(
        lambda x: f"Achievement {x:.1f}% — {'di bawah 70%' if x < 70 else 'di atas 110%'}"
    )
    return triggered.reset_index(drop=True)

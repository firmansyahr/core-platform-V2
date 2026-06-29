"""Promo program analytics — achievement calculation and summary."""
from __future__ import annotations

import pandas as pd

from api.core.brand_config_engine import get_brand_reward_multiplier
from api.core.promo_calculator import (
    filter_transactions_by_brand,
    normalize_brand_name,
    resolve_brands_for_promo,
)

PRICE_PER_TON_ESTIMATE = 800_000  # Rp/ton, fallback for cashback when Harga column absent


def _effective_rate(peserta_item: dict, rr_cfg: dict) -> float:
    """Return reward rate (Rp/ton) for one participant given the reward_rate config."""
    cluster = str(peserta_item.get("cluster", ""))
    mode    = str(rr_cfg.get("mode", "flat"))
    if mode == "flat":
        return float(rr_cfg.get("flat_rate", 0))
    if mode == "per_cluster":
        return float(rr_cfg.get("per_cluster_rates", {}).get(cluster, 0))
    # per_toko: use per-store override if set, else cluster rate
    override = peserta_item.get("rate_override")
    if override is not None:
        return float(override)
    return float(rr_cfg.get("per_cluster_rates", {}).get(cluster, 0))


def estimate_budget(peserta: list[dict], konfigurasi: dict) -> int:
    """Estimate total promo budget assuming 100% target achievement."""
    rr_cfg = konfigurasi.get("reward_rate",  {"enabled": False})
    tb_cfg = konfigurasi.get("target_bonus", {"enabled": False})
    cb_cfg = konfigurasi.get("cashback",     {"enabled": False})

    total = 0.0
    for p in peserta:
        target_ton = float(p.get("target_ton") or 0)
        if rr_cfg.get("enabled"):
            total += target_ton * _effective_rate(p, rr_cfg)
        if tb_cfg.get("enabled"):
            total += target_ton * float(tb_cfg.get("bonus_rate", 0))
        if cb_cfg.get("enabled"):
            total += target_ton * PRICE_PER_TON_ESTIMATE * float(cb_cfg.get("cashback_pct", 0)) / 100
    return round(total)


_V3_TYPES = frozenset(("flat_multiplier", "flat_per_batch", "multi_tier", "leaderboard"))


def estimate_budget_v3(
    peserta: list[dict],
    tipe_program: str,
    reward_config: dict,
    loyalty_config: dict | None = None,
) -> int:
    """Estimasi budget promo v3 dengan asumsi semua peserta achieve 100% target."""
    bpv     = (loyalty_config or {}).get("brand_point_values", {})
    pv_mb   = float(bpv.get("Semen Elang", 5000))
    total   = 0.0

    if tipe_program == "flat_multiplier":
        mult = float(reward_config.get("multiplier", 1))
        for p in peserta:
            total += float(p.get("target_ton") or 0) * mult * pv_mb

    elif tipe_program == "flat_per_batch":
        tpp = float(reward_config.get("ton_per_poin", 2)) or 2.0
        for p in peserta:
            total += (float(p.get("target_ton") or 0) / tpp) * pv_mb

    elif tipe_program == "multi_tier":
        tiers = reward_config.get("tiers", [])
        top_mult = max((float(t.get("multiplier", 1)) for t in tiers), default=1.0)
        for p in peserta:
            total += float(p.get("target_ton") or 0) * top_mult * pv_mb

    elif tipe_program == "leaderboard":
        positions = reward_config.get("reward_positions", [])
        if positions:
            total = sum(float(pos.get("reward_value", 0)) for pos in positions)
        else:
            for p in peserta:
                total += float(p.get("target_ton") or 0) * pv_mb

    return round(total)


def calculate_promo_achievement(promo: dict, df_transaksi: pd.DataFrame) -> pd.DataFrame:
    """Compute per-participant achievement for the promo period."""
    peserta = promo.get("peserta", [])
    if not peserta:
        return pd.DataFrame()

    mulai   = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai = pd.Timestamp(promo["periode_selesai"]).normalize()

    # BUG 1 FIX: filter transaksi berdasarkan brand setting promo
    allowed_brands = resolve_brands_for_promo(promo)
    df = filter_transactions_by_brand(df_transaksi.copy(), allowed_brands)
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()
    df_period = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]

    agg_ton: dict = df_period.groupby("ID Toko")["TON Quantity"].sum().to_dict()

    has_harga = "Harga" in df_period.columns
    agg_nilai: dict = {}
    if has_harga:
        tmp = df_period.copy()
        tmp["_nilai"] = tmp["TON Quantity"] * tmp["Harga"]
        agg_nilai = tmp.groupby("ID Toko")["_nilai"].sum().to_dict()

    cfg    = promo.get("konfigurasi_promo", {})
    rr_cfg = cfg.get("reward_rate",  {"enabled": False})
    tb_cfg = cfg.get("target_bonus", {"enabled": False})
    cb_cfg = cfg.get("cashback",     {"enabled": False})

    results: list[dict] = []
    for p in peserta:
        id_toko    = str(p["id_toko"])
        cluster    = str(p.get("cluster", ""))
        target_ton = float(p.get("target_ton") or 0)

        realisasi_ton   = float(agg_ton.get(id_toko, 0.0))
        achievement_pct = (realisasi_ton / target_ton * 100) if target_ton > 0 else 0.0

        reward_rate_earned = 0.0
        if rr_cfg.get("enabled"):
            brand = str(p.get("brand_utama") or "SEMEN ELANG")
            brand_multiplier = get_brand_reward_multiplier(
                normalize_brand_name(brand), "", "", db=None
            )
            reward_rate_earned = realisasi_ton * _effective_rate(p, rr_cfg) * brand_multiplier

        bonus_earned = 0.0
        if tb_cfg.get("enabled") and target_ton > 0:
            if achievement_pct >= float(tb_cfg.get("threshold_pct", 100)):
                bonus_earned = realisasi_ton * float(tb_cfg.get("bonus_rate", 0))

        cashback_earned = 0.0
        if cb_cfg.get("enabled"):
            if has_harga and id_toko in agg_nilai:
                nilai = float(agg_nilai[id_toko])
            else:
                nilai = realisasi_ton * PRICE_PER_TON_ESTIMATE
            cashback_earned = nilai * float(cb_cfg.get("cashback_pct", 0)) / 100

        total_reward = reward_rate_earned + bonus_earned + cashback_earned

        if achievement_pct > 100:
            status = "Melampaui Target"
        elif achievement_pct >= 100:
            status = "Mencapai Target"
        elif achievement_pct >= 80:
            status = "On Track"
        else:
            status = "Belum Mencapai"

        results.append({
            "id_toko":            id_toko,
            "nama_toko":          str(p.get("nama_toko", "")),
            "cluster":            cluster,
            "target_ton":         round(target_ton, 2),
            "realisasi_ton":      round(realisasi_ton, 2),
            "achievement_pct":    round(achievement_pct, 2),
            "reward_rate_earned": round(reward_rate_earned),
            "bonus_earned":       round(bonus_earned),
            "cashback_earned":    round(cashback_earned),
            "total_reward":       round(total_reward),
            "status":             status,
        })

    return pd.DataFrame(results).reset_index(drop=True) if results else pd.DataFrame()


def get_promo_summary(promo: dict, achievements_df: pd.DataFrame) -> dict:
    """Aggregate totals and top/bottom 5 from achievement rows."""
    total_peserta = len(promo.get("peserta", []))
    est_budget    = int((promo.get("summary_peserta") or {}).get("estimasi_budget_total", 0))

    if achievements_df.empty:
        return {
            "total_peserta":           total_peserta,
            "peserta_aktif_transaksi": 0,
            "total_target_ton":        0.0,
            "total_realisasi_ton":     0.0,
            "overall_achievement_pct": 0.0,
            "total_reward_earned":     0,
            "estimasi_budget_sisa":    est_budget,
            "mencapai_target_count":   0,
            "belum_mencapai_count":    total_peserta,
            "melampaui_count":         0,
            "top_5_toko":              [],
            "bottom_5_toko":           [],
        }

    peserta_aktif   = int((achievements_df["realisasi_ton"] > 0).sum())
    total_target    = float(achievements_df["target_ton"].sum())
    total_realisasi = float(achievements_df["realisasi_ton"].sum())
    overall_ach     = (total_realisasi / total_target * 100) if total_target > 0 else 0.0
    total_reward    = int(achievements_df["total_reward"].sum())
    sisa            = max(0, est_budget - total_reward)

    melampaui = int((achievements_df["achievement_pct"] > 100).sum())
    mencapai  = int((achievements_df["achievement_pct"] >= 100).sum()) - melampaui
    belum     = int((achievements_df["achievement_pct"] < 100).sum())

    cols = ["id_toko", "nama_toko", "cluster", "achievement_pct", "total_reward"]
    top5 = achievements_df.nlargest(5, "achievement_pct")[cols].to_dict("records")
    bot5 = achievements_df.nsmallest(5, "achievement_pct")[cols].to_dict("records")

    return {
        "total_peserta":           total_peserta,
        "peserta_aktif_transaksi": peserta_aktif,
        "total_target_ton":        round(total_target, 2),
        "total_realisasi_ton":     round(total_realisasi, 2),
        "overall_achievement_pct": round(overall_ach, 2),
        "total_reward_earned":     total_reward,
        "estimasi_budget_sisa":    sisa,
        "mencapai_target_count":   mencapai,
        "belum_mencapai_count":    belum,
        "melampaui_count":         melampaui,
        "top_5_toko":              top5,
        "bottom_5_toko":           bot5,
    }


def get_daily_trend(promo: dict, df_transaksi: pd.DataFrame) -> list[dict]:
    """Return daily cumulative realisasi vs. pro-rata target for all peserta."""
    peserta = promo.get("peserta", [])
    if not peserta:
        return []

    mulai        = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai      = pd.Timestamp(promo["periode_selesai"]).normalize()
    peserta_ids  = {str(p["id_toko"]) for p in peserta}
    total_target = sum(float(p.get("target_ton") or 0) for p in peserta)

    df = df_transaksi.copy()
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()
    df_period = df[
        (df["_dt"] >= mulai) & (df["_dt"] <= selesai)
        & df["ID Toko"].astype(str).isin(peserta_ids)
    ]

    date_range = pd.date_range(mulai, selesai, freq="D")
    if df_period.empty:
        daily_ton = pd.Series(0.0, index=date_range)
    else:
        daily_ton = (
            df_period.groupby("_dt")["TON Quantity"].sum()
            .reindex(date_range, fill_value=0.0)
        )

    cumulative  = daily_ton.cumsum()
    period_days = max(len(date_range), 1)

    result: list[dict] = []
    for i, (dt, cum_ton) in enumerate(cumulative.items()):
        day_num        = i + 1
        target_runrate = total_target * day_num / period_days
        result.append({
            "tanggal":             dt.strftime("%Y-%m-%d"),
            "realisasi_kumulatif": round(float(cum_ton), 2),
            "target_kumulatif":    round(float(target_runrate), 2),
            "gap":                 round(float(cum_ton - target_runrate), 2),
        })

    return result


def get_cluster_comparison(promo: dict, df_transaksi: pd.DataFrame) -> list[dict]:
    """Compare per-cluster volume during promo vs. same-length period before."""
    peserta = promo.get("peserta", [])
    if not peserta:
        return []

    mulai       = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai     = pd.Timestamp(promo["periode_selesai"]).normalize()
    period_days = max((selesai - mulai).days + 1, 1)
    pre_selesai = mulai - pd.Timedelta(days=1)
    pre_mulai   = pre_selesai - pd.Timedelta(days=period_days - 1)

    cluster_map: dict[str, list[str]] = {}
    for p in peserta:
        cl = str(p.get("cluster", "Unknown"))
        cluster_map.setdefault(cl, []).append(str(p["id_toko"]))

    df = df_transaksi.copy()
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()

    agg_promo = (
        df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]
        .groupby("ID Toko")["TON Quantity"].sum().to_dict()
    )
    agg_pre = (
        df[(df["_dt"] >= pre_mulai) & (df["_dt"] <= pre_selesai)]
        .groupby("ID Toko")["TON Quantity"].sum().to_dict()
    )

    result: list[dict] = []
    for cluster, ids in sorted(cluster_map.items()):
        vol_promo = sum(float(agg_promo.get(i, 0)) for i in ids)
        vol_pre   = sum(float(agg_pre.get(i, 0)) for i in ids)
        delta_pct = round((vol_promo - vol_pre) / vol_pre * 100, 1) if vol_pre > 0 else 0.0
        result.append({
            "cluster":    cluster,
            "vol_promo":  round(vol_promo, 2),
            "vol_before": round(vol_pre, 2),
            "delta":      round(vol_promo - vol_pre, 2),
            "delta_pct":  delta_pct,
        })

    return result

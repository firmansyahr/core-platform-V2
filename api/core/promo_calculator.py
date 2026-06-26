"""Multi-tier target reward calculator — brand-based point conversion."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from api.core.brand_config_engine import get_brand_reward_multiplier

_CONFIG_PATH = Path("api/data/loyalty_config.json")


def load_loyalty_config() -> dict:
    if not _CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def get_brand_point_values() -> dict[str, int]:
    cfg = load_loyalty_config()
    return cfg.get("brand_point_values", {
        "Semen Elang":   5000,
        "Semen Badak":   4000,
        "Semen Banteng": 0,
    })


_DEFAULT_BRANDS  = ["SEMEN ELANG", "SEMEN BADAK", "SEMEN BADAK SERBAGUNA"]
_FIGHTING_BRANDS = ["SEMEN BANTENG"]
_FIGHTING_BRAND  = "SEMEN BANTENG"  # single string for legacy exclusion


def resolve_brands_for_promo(promo: dict) -> list[str] | None:
    """
    Resolve brand mana saja yang boleh dihitung transaksinya untuk program ini.

    Return:
    - None     → gunakan legacy default (exclude SEMEN BANTENG saja)
    - list[str]→ whitelist uppercase; hanya transaksi dengan brand ini yang dihitung

    Priority: brand_selection_json (new) → brand_selection_mode (legacy) → None
    """
    brands: set[str] = set()

    bsj = promo.get("brand_selection_json")
    if bsj:
        try:
            sel = json.loads(bsj)
            modes         = sel.get("modes") or []
            custom_brands = sel.get("custom_brands") or []
            if "default" in modes:
                brands.update(_DEFAULT_BRANDS)
            if "fighting_brand" in modes:
                brands.update(_FIGHTING_BRANDS)
            if "custom" in modes and custom_brands:
                brands.update(b.upper().strip() for b in custom_brands)
            return list(brands) if brands else None
        except Exception:
            pass

    # Legacy fallback
    mode = promo.get("brand_selection_mode")
    if mode == "fighting":
        return list(_FIGHTING_BRANDS)
    if mode == "wilayah":
        return None  # all brands; legacy caller excludes nothing extra

    return None  # no selection → legacy default (caller excludes BANTENG)


def filter_transactions_by_brand(
    df: pd.DataFrame,
    allowed_brands: list[str] | None,
) -> pd.DataFrame:
    """
    Filter DataFrame transaksi berdasarkan brand.

    allowed_brands = None  → legacy: exclude SEMEN BANTENG saja
    allowed_brands = list  → whitelist; hanya brand dalam list yang lolos
    """
    import logging
    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)

    if brand_col is None:
        if allowed_brands is not None:
            logging.getLogger(__name__).warning(
                "Brand column not found; brand filter diabaikan. Columns: %s",
                list(df.columns),
            )
        return df

    if allowed_brands is None:
        # Legacy: exclude fighting brand
        return df[~df[brand_col].str.upper().eq(_FIGHTING_BRAND)]

    allowed_upper = [b.upper() for b in allowed_brands]
    filtered = df[df[brand_col].str.upper().isin(allowed_upper)]
    if filtered.empty:
        logging.getLogger(__name__).warning(
            "Brand filter menghasilkan 0 transaksi. allowed=%s, available=%s",
            allowed_brands,
            df[brand_col].unique().tolist(),
        )
    return filtered


def _get_brand_rate_for_promo(brand: str, base_rate: float) -> float:
    """
    Rate reward per ton untuk brand ini berdasarkan Brand Config multiplier.
    brand (any casing) di-uppercase sebelum lookup ke DEFAULT_CONFIG.
    MB=1.0×, CB/FB=0.5×, unknown=0.5× (conservative default).
    db=None → selalu pakai DEFAULT_CONFIG (MB/CB/FB hardcoded), tanpa query DB.
    """
    multiplier = get_brand_reward_multiplier(brand.upper(), "", "", db=None)
    if multiplier == 0.0:
        multiplier = 0.5
    return round(base_rate * multiplier, 2)


def calculate_tier_reward(
    volume_realisasi: float,
    volume_target: float,
    reward_config: dict,
    brand_name: str,
    brand_point_values: dict[str, int],
) -> dict[str, Any]:
    """
    Hitung reward multi-tier untuk satu toko satu periode.

    Tier tertinggi ditentukan dinamis dari reward_config['tiers'] —
    TIDAK ada angka hardcode. Overflow terjadi di atas threshold tier tertinggi
    program tersebut, bukan angka tetap.
    """
    if volume_target <= 0:
        return {"error": "Target tidak valid"}

    achievement_pct     = (volume_realisasi / volume_target) * 100
    tiers               = sorted(reward_config.get("tiers", []), key=lambda x: x["threshold_pct"])
    reguler_multiplier  = reward_config.get("reguler_multiplier",  1)
    overflow_multiplier = reward_config.get("overflow_multiplier", 1)

    default_pv         = get_brand_point_values().get("Semen Elang", 5000)
    point_value_per_poin = brand_point_values.get(brand_name, default_pv)

    # Cari tier tertinggi yang telah dicapai
    applicable_tier: dict | None = None
    for tier in tiers:
        if achievement_pct >= tier["threshold_pct"]:
            applicable_tier = tier

    highest_tier_in_program = tiers[-1] if tiers else None

    if not tiers:
        # Tidak ada tier → semua reguler
        breakdown = [{
            "segmen":    "Reguler",
            "volume_ton": round(volume_realisasi, 2),
            "multiplier": reguler_multiplier,
            "poin":       round(volume_realisasi * reguler_multiplier, 2),
            "keterangan": "Tidak ada tier terdefinisi — semua volume reguler",
        }]
        tier_label          = "Reguler"
        multiplier_efektif  = reguler_multiplier
        threshold_tertinggi = 0
    elif applicable_tier is None:
        # Belum capai tier pertama → semua volume reguler 1X
        breakdown = [{
            "segmen":    "Reguler",
            "volume_ton": round(volume_realisasi, 2),
            "multiplier": reguler_multiplier,
            "poin":       round(volume_realisasi * reguler_multiplier, 2),
            "keterangan": f"Di bawah threshold tier pertama ({tiers[0]['threshold_pct']}%)",
        }]
        tier_label          = "Reguler"
        multiplier_efektif  = reguler_multiplier
        threshold_tertinggi = highest_tier_in_program["threshold_pct"]  # type: ignore[index]
    else:
        assert highest_tier_in_program is not None
        breakdown: list[dict] = []
        threshold_tertinggi   = highest_tier_in_program["threshold_pct"]

        if applicable_tier["tier_id"] == highest_tier_in_program["tier_id"]:
            # Sudah mencapai tier tertinggi program → cek overflow
            volume_at_threshold = volume_target * (threshold_tertinggi / 100)
            volume_overflow     = max(0.0, volume_realisasi - volume_at_threshold)
            volume_in_tier      = volume_realisasi - volume_overflow

            if volume_in_tier > 0:
                breakdown.append({
                    "segmen":    f"Tier {applicable_tier['tier_id']} — {applicable_tier['label']}",
                    "volume_ton": round(volume_in_tier, 2),
                    "multiplier": applicable_tier["multiplier"],
                    "poin":       round(volume_in_tier * applicable_tier["multiplier"], 2),
                    "keterangan": (
                        f"Capai {applicable_tier['threshold_pct']}% target "
                        f"→ {applicable_tier['multiplier']}X Poin"
                    ),
                })
            if volume_overflow > 0:
                breakdown.append({
                    "segmen":    "Overflow (di atas tier tertinggi program ini)",
                    "volume_ton": round(volume_overflow, 2),
                    "multiplier": overflow_multiplier,
                    "poin":       round(volume_overflow * overflow_multiplier, 2),
                    "keterangan": (
                        f"Kelebihan di atas {threshold_tertinggi}% "
                        f"(threshold tertinggi program) → {overflow_multiplier}X Poin"
                    ),
                })
        else:
            # Tier tengah (bukan tertinggi) → seluruh volume dapat multiplier tier ini
            # belum overflow karena belum melewati threshold tertinggi program
            breakdown.append({
                "segmen":    f"Tier {applicable_tier['tier_id']} — {applicable_tier['label']}",
                "volume_ton": round(volume_realisasi, 2),
                "multiplier": applicable_tier["multiplier"],
                "poin":       round(volume_realisasi * applicable_tier["multiplier"], 2),
                "keterangan": (
                    f"Capai {applicable_tier['threshold_pct']}% target "
                    f"→ {applicable_tier['multiplier']}X Poin"
                ),
            })

        tier_label         = f"{applicable_tier['label']} ({applicable_tier['threshold_pct']}%)"
        multiplier_efektif = applicable_tier["multiplier"]

    total_poin   = sum(b["poin"] for b in breakdown)
    total_rupiah = total_poin * point_value_per_poin

    return {
        "achievement_pct":              round(achievement_pct, 1),
        "tier_berlaku":                 tier_label,
        "multiplier_efektif":           multiplier_efektif,
        "threshold_tertinggi_program":  threshold_tertinggi if highest_tier_in_program else 0,
        "breakdown":                    breakdown,
        "total_poin":                   round(total_poin, 2),
        "brand":                        brand_name,
        "point_value_per_poin":         point_value_per_poin,
        "total_rupiah":                 round(total_rupiah, 0),
        "formula": (
            f"{volume_realisasi} ton realisasi, target {volume_target} ton "
            f"({achievement_pct:.1f}%)"
        ),
    }


def get_baseline_volume(
    toko_ids: list[str],
    periode_mulai: str,
    periode_selesai: str,
    transaksi_df: pd.DataFrame,
    lookback_months: int = 3,
) -> dict[str, float]:
    """
    Volume baseline per toko SEBELUM program, dinormalisasi ke durasi yang SAMA
    dengan periode program (bukan total mentah lookback_months) — supaya
    perbandingan before/during adil terlepas dari berapa lama program berjalan.

    baseline[toko] = (rata-rata volume harian toko selama lookback window
    sebelum periode_mulai) × jumlah hari periode program.
    """
    mulai   = pd.Timestamp(periode_mulai).normalize()
    selesai = pd.Timestamp(periode_selesai).normalize()
    durasi_hari = (selesai - mulai).days + 1

    lookback_end   = mulai - pd.Timedelta(days=1)
    lookback_start = mulai - pd.DateOffset(months=lookback_months)
    lookback_days  = max((lookback_end - lookback_start).days + 1, 1)

    df = transaksi_df.copy()
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()

    df_lookback = df[
        (df["_dt"] >= lookback_start) & (df["_dt"] <= lookback_end)
        & (df["ID Toko"].isin(toko_ids))
    ]
    agg = df_lookback.groupby("ID Toko")["TON Quantity"].sum()

    return {
        str(toko_id): round(float(agg.get(toko_id, 0.0)) / lookback_days * durasi_hari, 2)
        for toko_id in toko_ids
    }


def compute_program_analytics(
    peserta_rows: list[dict],
    baseline: dict[str, float],
    total_reward_issued: float,
) -> dict[str, Any]:
    """
    Analytics universal untuk semua tipe program — dipanggil SETELAH masing-masing
    calculator menormalisasi baris pesertanya ke bentuk:
      {id_toko, nama_toko, during_vol, target_ton, reward_rupiah, forced_status?}

    target_ton None → tipe program ini tidak punya target volume eksplisit
    (flat_multiplier/leaderboard) — achievement diukur dari lift vs baseline
    sendiri (maintain/tumbuh = sukses), BUKAN diam-diam dianggap 0%.

    forced_status (opsional) → override status untuk business rule yang tidak
    bisa diturunkan dari volume saja (mis. leaderboard: masuk rank 1-3 = sukses
    walau basis_ranking-nya growth_pct dengan volume absolut kecil).
    """
    default_pv = get_brand_point_values().get("Semen Elang", 5000)

    per_toko: list[dict] = []
    baseline_total = 0.0
    during_total   = 0.0

    for r in peserta_rows:
        toko_id      = r["id_toko"]
        baseline_vol = float(baseline.get(toko_id, 0.0))
        during_vol   = float(r["during_vol"])
        baseline_total += baseline_vol
        during_total   += during_vol

        if baseline_vol > 0:
            lift_pct = (during_vol - baseline_vol) / baseline_vol * 100
        else:
            lift_pct = 100.0 if during_vol > 0 else 0.0

        target_ton = r.get("target_ton")
        if target_ton:
            achievement_pct = during_vol / target_ton * 100
        else:
            # Tidak ada target eksplisit — pakai baseline sendiri sebagai
            # "target implisit": maintain/tumbuh dari kondisi sebelum program
            # dianggap sukses, bukan dipaksa 0%.
            achievement_pct = lift_pct + 100

        if baseline_vol == 0 and during_vol == 0:
            status = "no_movement"
        elif achievement_pct >= 110:
            status = "over_achiever"
        elif achievement_pct >= 90:
            status = "on_track"
        else:
            status = "under_achiever"
        status = r.get("forced_status") or status

        per_toko.append({
            "toko_id":      toko_id,
            "nama_toko":    r.get("nama_toko", ""),
            "baseline_vol": round(baseline_vol, 2),
            "during_vol":   round(during_vol, 2),
            "lift_pct":     round(lift_pct, 1),
            "status":       status,
        })

    if baseline_total > 0:
        overall_lift_pct = (during_total - baseline_total) / baseline_total * 100
    else:
        overall_lift_pct = 100.0 if during_total > 0 else 0.0

    total_peserta  = len(per_toko)
    over_achiever  = sum(1 for p in per_toko if p["status"] == "over_achiever")
    on_track       = sum(1 for p in per_toko if p["status"] == "on_track")
    under_achiever = sum(1 for p in per_toko if p["status"] == "under_achiever")
    non_movers     = sum(1 for p in per_toko if p["status"] == "no_movement")
    mencapai_target = over_achiever + on_track

    incremental_volume = max(during_total - baseline_total, 0.0)
    cost_per_incremental_ton = (
        round(total_reward_issued / incremental_volume, 0) if incremental_volume > 0 else None
    )
    # Nilai volume inkremental diestimasi sebagai poin reguler (1X) pada
    # point_value brand default — proxy kasar (point_value sebenarnya bervariasi
    # per brand/tier), dipakai HANYA untuk sinyal arah ROI, bukan angka presisi.
    implied_value = incremental_volume * default_pv
    roi_pct = (
        round((implied_value - total_reward_issued) / total_reward_issued * 100, 1)
        if total_reward_issued > 0 else None
    )
    breakeven_volume = round(total_reward_issued / default_pv, 2) if default_pv > 0 else 0.0

    sorted_by_lift = sorted(per_toko, key=lambda p: p["lift_pct"], reverse=True)

    return {
        "volume_lift": {
            "baseline_total": round(baseline_total, 2),
            "during_total":   round(during_total, 2),
            "lift_pct":       round(overall_lift_pct, 1),
            "per_toko":       per_toko,
        },
        "achievement": {
            "total_peserta":   total_peserta,
            "mencapai_target": mencapai_target,
            "pct_achieved":    round(mencapai_target / total_peserta * 100, 1) if total_peserta else 0.0,
            "over_achiever":   over_achiever,
            "on_track":        on_track,
            "under_achiever":  under_achiever,
        },
        "roi": {
            "total_reward_issued":      round(total_reward_issued, 0),
            "incremental_volume":       round(incremental_volume, 2),
            "cost_per_incremental_ton": cost_per_incremental_ton,
            "roi_pct":                  roi_pct,
            "breakeven_volume":         breakeven_volume,
        },
        "responders": {
            "top_5":      sorted_by_lift[:5],
            "bottom_5":   sorted_by_lift[-5:][::-1] if len(sorted_by_lift) > 5 else [],
            "non_movers": non_movers,
        },
    }


def calculate_program_reward_summary(
    promo: dict,
    peserta_data: list[dict],
    transaksi_df: pd.DataFrame,
    loyalty_config: dict,
) -> dict[str, Any]:
    """Hitung reward semua peserta dalam satu program dengan multi-tier."""
    brand_point_values = loyalty_config.get("brand_point_values", get_brand_point_values())
    reward_config      = promo.get("reward_config", {})

    mulai   = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai = pd.Timestamp(promo["periode_selesai"]).normalize()

    allowed_brands = resolve_brands_for_promo(promo)
    df_filtered    = filter_transactions_by_brand(transaksi_df.copy(), allowed_brands)
    df             = df_filtered.copy()
    df["_dt"]      = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()
    df_period      = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]

    agg_ton: dict = df_period.groupby("ID Toko")["TON Quantity"].sum().to_dict()

    results: list[dict] = []
    for peserta in peserta_data:
        id_toko        = str(peserta["id_toko"])
        volume_realisasi = float(agg_ton.get(id_toko, 0.0))
        volume_target  = float(peserta.get("target_ton") or 0)
        brand_utama    = peserta.get("brand_utama", "Semen Elang")

        calc = calculate_tier_reward(
            volume_realisasi  = volume_realisasi,
            volume_target     = volume_target,
            reward_config     = reward_config,
            brand_name        = brand_utama,
            brand_point_values = brand_point_values,
        )

        results.append({
            "id_toko":   id_toko,
            "nama_toko": peserta.get("nama_toko", ""),
            "cluster":   peserta.get("cluster_pareto", peserta.get("cluster", "")),
            "target_ton":    volume_target,
            "realisasi_ton": volume_realisasi,
            **calc,
        })

    total_poin_program   = sum(r.get("total_poin", 0)   for r in results)
    total_rupiah_program = sum(r.get("total_rupiah", 0) for r in results)

    tier_distribution: dict[str, int] = {}
    for r in results:
        tier = r.get("tier_berlaku", "Reguler")
        tier_distribution[tier] = tier_distribution.get(tier, 0) + 1

    baseline = get_baseline_volume(
        [r["id_toko"] for r in results], promo["periode_mulai"], promo["periode_selesai"], df_filtered,
    )
    analytics_rows = [
        {
            "id_toko":   r["id_toko"], "nama_toko": r["nama_toko"],
            "during_vol": r["realisasi_ton"], "target_ton": r["target_ton"] or None,
            "reward_rupiah": r["total_rupiah"],
        }
        for r in results
    ]
    analytics = compute_program_analytics(analytics_rows, baseline, total_rupiah_program)

    return {
        "tipe_program":       "multi_tier",
        "program_id":         promo["id"],
        "program_nama":       promo.get("nama_promo", promo.get("nama", "")),
        "total_peserta":      len(results),
        "total_poin":         round(total_poin_program, 0),
        "total_rupiah":       round(total_rupiah_program, 0),
        "tier_distribution":  tier_distribution,
        "peserta_detail":     results,
        "analytics":          analytics,
    }


def calculate_flat_multiplier_program(
    promo: dict,
    peserta_data: list[dict],
    transaksi_df: pd.DataFrame,
    loyalty_config: dict,
) -> dict[str, Any]:
    """Tipe 1 — Flat Multiplier: setiap transaksi × multiplier tetap, tanpa target."""
    reward_config      = promo.get("reward_config", {})
    multiplier         = float(reward_config.get("multiplier", 1))
    brand_point_values = loyalty_config.get("brand_point_values", get_brand_point_values())
    base_rate          = float(brand_point_values.get("Semen Elang", 5000))

    mulai   = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai = pd.Timestamp(promo["periode_selesai"]).normalize()

    allowed_brands = resolve_brands_for_promo(promo)
    df_filtered    = filter_transactions_by_brand(transaksi_df.copy(), allowed_brands)
    df             = df_filtered.copy()
    df["_dt"]      = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()
    df_period      = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]
    agg_ton        = df_period.groupby("ID Toko")["TON Quantity"].sum().to_dict()

    brand_program     = ", ".join(allowed_brands) if allowed_brands else None
    allowed_upper_set = {b.upper() for b in allowed_brands} if allowed_brands else set()

    results: list[dict] = []
    for peserta in peserta_data:
        id_toko       = str(peserta["id_toko"])
        volume        = float(agg_ton.get(id_toko, 0.0))
        brand         = peserta.get("brand_utama", "Semen Elang")
        brand_display = brand_program or brand

        if allowed_brands and len(allowed_brands) == 1:
            rate_brand = allowed_brands[0]
        elif allowed_brands:
            bu = peserta.get("brand_utama", "")
            rate_brand = bu if bu.upper() in allowed_upper_set else allowed_brands[0]
        else:
            rate_brand = brand

        mult_efektif = multiplier
        keterangan   = f"{multiplier}X flat multiplier"

        pv           = _get_brand_rate_for_promo(rate_brand, base_rate)
        total_poin   = round(volume * mult_efektif, 2)
        total_rupiah = round(total_poin * pv, 0)

        results.append({
            "id_toko":            id_toko,
            "nama_toko":          peserta.get("nama_toko", ""),
            "cluster":            peserta.get("cluster_pareto", peserta.get("cluster", "")),
            "brand_utama":        brand_display,
            "brand_program":      brand_program,
            "volume_ton":         round(volume, 2),
            "multiplier_berlaku": mult_efektif,
            "total_poin":         total_poin,
            "total_rupiah":       total_rupiah,
            "keterangan":         keterangan,
        })

    total_poin_prog   = sum(r["total_poin"]   for r in results)
    total_rupiah_prog = sum(r["total_rupiah"] for r in results)

    baseline = get_baseline_volume(
        [r["id_toko"] for r in results], promo["periode_mulai"], promo["periode_selesai"], df_filtered,
    )
    analytics_rows = [
        {
            "id_toko": r["id_toko"], "nama_toko": r["nama_toko"],
            "during_vol": r["volume_ton"], "target_ton": None,
            "reward_rupiah": r["total_rupiah"],
        }
        for r in results
    ]
    analytics = compute_program_analytics(analytics_rows, baseline, total_rupiah_prog)

    return {
        "tipe_program":   "flat_multiplier",
        "program_id":     promo["id"],
        "program_nama":   promo.get("nama_promo", ""),
        "multiplier":     multiplier,
        "brand_filter":   allowed_brands,
        "total_peserta":  len(results),
        "total_poin":     round(total_poin_prog, 0),
        "total_rupiah":   round(total_rupiah_prog, 0),
        "peserta_detail": results,
        "analytics":      analytics,
    }


def calculate_flat_per_batch_program(
    promo: dict,
    peserta_data: list[dict],
    transaksi_df: pd.DataFrame,
    loyalty_config: dict,
) -> dict[str, Any]:
    """Tipe flat_per_batch: setiap ton_per_poin ton = 1 poin (desimal ok)."""
    reward_config      = promo.get("reward_config", {})
    ton_per_poin       = float(reward_config.get("ton_per_poin", 2.0))
    if ton_per_poin <= 0:
        ton_per_poin = 2.0
    brand_point_values = loyalty_config.get("brand_point_values", get_brand_point_values())
    base_rate          = float(brand_point_values.get("Semen Elang", 5000))

    mulai   = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai = pd.Timestamp(promo["periode_selesai"]).normalize()

    allowed_brands = resolve_brands_for_promo(promo)
    df_filtered    = filter_transactions_by_brand(transaksi_df.copy(), allowed_brands)
    df             = df_filtered.copy()
    df["_dt"]      = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()
    df_period      = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]
    agg_ton        = df_period.groupby("ID Toko")["TON Quantity"].sum().to_dict()

    brand_program     = ", ".join(allowed_brands) if allowed_brands else None
    allowed_upper_set = {b.upper() for b in allowed_brands} if allowed_brands else set()

    results: list[dict] = []
    for peserta in peserta_data:
        id_toko       = str(peserta["id_toko"])
        volume        = float(agg_ton.get(id_toko, 0.0))
        brand         = peserta.get("brand_utama", "Semen Elang")
        brand_display = brand_program or brand

        if allowed_brands and len(allowed_brands) == 1:
            rate_brand = allowed_brands[0]
        elif allowed_brands:
            bu = peserta.get("brand_utama", "")
            rate_brand = bu if bu.upper() in allowed_upper_set else allowed_brands[0]
        else:
            rate_brand = brand

        poin_earned  = round(volume / ton_per_poin, 2)
        keterangan   = f"{volume} ton / {ton_per_poin} ton per poin = {poin_earned} poin"

        pv           = _get_brand_rate_for_promo(rate_brand, base_rate)
        total_rupiah = round(poin_earned * pv, 0)

        results.append({
            "id_toko":       id_toko,
            "nama_toko":     peserta.get("nama_toko", ""),
            "cluster":       peserta.get("cluster_pareto", peserta.get("cluster", "")),
            "brand_utama":   brand_display,
            "brand_program": brand_program,
            "volume_ton":    round(volume, 2),
            "poin_earned":   poin_earned,
            "ton_per_poin":  ton_per_poin,
            "total_rupiah":  total_rupiah,
            "keterangan":    keterangan,
        })

    total_poin_prog   = sum(r["poin_earned"]   for r in results)
    total_rupiah_prog = sum(r["total_rupiah"]  for r in results)

    baseline = get_baseline_volume(
        [r["id_toko"] for r in results], promo["periode_mulai"], promo["periode_selesai"], df_filtered,
    )
    analytics_rows = [
        {
            "id_toko": r["id_toko"], "nama_toko": r["nama_toko"],
            "during_vol": r["volume_ton"], "target_ton": None,
            "reward_rupiah": r["total_rupiah"],
        }
        for r in results
    ]
    analytics = compute_program_analytics(analytics_rows, baseline, total_rupiah_prog)

    return {
        "tipe_program":   "flat_per_batch",
        "program_id":     promo["id"],
        "program_nama":   promo.get("nama_promo", ""),
        "ton_per_poin":   ton_per_poin,
        "brand_filter":   allowed_brands,
        "total_peserta":  len(results),
        "total_poin":     round(total_poin_prog, 2),
        "total_rupiah":   round(total_rupiah_prog, 0),
        "peserta_detail": results,
        "analytics":      analytics,
    }


def calculate_leaderboard_standings(
    promo: dict,
    peserta_data: list[dict],
    transaksi_df: pd.DataFrame,
    loyalty_config: dict,
) -> dict[str, Any]:
    """Tipe 3 — Leaderboard: ranking volume atau growth%, reward per peringkat."""
    reward_config      = promo.get("reward_config", {})
    basis              = reward_config.get("basis_ranking", "volume")
    scope              = reward_config.get("scope", "global")
    bentuk_reward      = reward_config.get("bentuk_reward", "poin")
    rank_rewards: list = reward_config.get("rank_rewards", [])
    min_trx            = int(reward_config.get("minimum_transaksi", 1))
    brand_point_values = loyalty_config.get("brand_point_values", get_brand_point_values())

    mulai   = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai = pd.Timestamp(promo["periode_selesai"]).normalize()

    allowed_brands = resolve_brands_for_promo(promo)
    df_filtered    = filter_transactions_by_brand(transaksi_df.copy(), allowed_brands)
    df             = df_filtered.copy()
    df["_dt"]      = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()

    df_period   = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]
    agg_ton     = df_period.groupby("ID Toko")["TON Quantity"].sum().to_dict()
    agg_trx_cnt = df_period.groupby("ID Toko").size().to_dict()

    if basis == "growth_pct":
        durasi     = (selesai - mulai).days + 1
        prev_end   = mulai - pd.Timedelta(days=1)
        prev_start = prev_end - pd.Timedelta(days=durasi - 1)
        df_prev    = df[(df["_dt"] >= prev_start) & (df["_dt"] <= prev_end)]
        agg_prev   = df_prev.groupby("ID Toko")["TON Quantity"].sum().to_dict()
    else:
        agg_prev = {}

    eligible:       list[dict] = []
    tidak_eligible: int        = 0

    for peserta in peserta_data:
        id_toko    = str(peserta["id_toko"])
        jumlah_trx = int(agg_trx_cnt.get(id_toko, 0))

        if jumlah_trx < min_trx:
            tidak_eligible += 1
            continue

        volume     = float(agg_ton.get(id_toko, 0.0))
        vol_lalu   = float(agg_prev.get(id_toko, 0.0)) if basis == "growth_pct" else 0.0
        score      = ((volume - vol_lalu) / vol_lalu * 100) if basis == "growth_pct" and vol_lalu > 0 else volume

        eligible.append({
            "id_toko":          id_toko,
            "nama_toko":        peserta.get("nama_toko", ""),
            "cluster":          peserta.get("cluster_pareto", peserta.get("cluster", "")),
            "brand_utama":      peserta.get("brand_utama", "Semen Elang"),
            "volume_periode":   round(volume, 2),
            "jumlah_transaksi": jumlah_trx,
            "score":            round(score, 2),
        })

    def _assign_rewards(items: list[dict]) -> list[dict]:
        items_sorted = sorted(items, key=lambda x: x["score"], reverse=True)
        out: list[dict] = []
        for i, item in enumerate(items_sorted):
            rank = i + 1
            rv, rl = 0, "Tidak dapat reward"
            for rr in rank_rewards:
                if "rank" in rr and rr.get("rank") == rank:
                    rv, rl = rr["reward_value"], rr.get("label", f"Rank {rank}")
                    break
                if "rank_range" in rr:
                    lo, hi = rr["rank_range"][0], rr["rank_range"][1]
                    if lo <= rank <= hi:
                        rv, rl = rr["reward_value"], rr.get("label", f"Rank {lo}–{hi}")
                        break
            pv       = brand_point_values.get(item["brand_utama"], 5000)
            r_poin   = float(rv) if bentuk_reward == "poin" else None
            r_rupiah = round(float(rv) * pv if bentuk_reward == "poin" else float(rv), 0)
            out.append({**item, "rank": rank, "reward_label": rl,
                        "reward_poin": r_poin, "reward_rupiah": r_rupiah})
        return out

    if scope == "global":
        standings      = _assign_rewards(eligible)
        grouped: dict | None = None
    else:
        clusters  = sorted({s["cluster"] for s in eligible})
        grouped   = {}
        standings = []
        for cl in clusters:
            cl_ranked = _assign_rewards([s for s in eligible if s["cluster"] == cl])
            for item in cl_ranked:
                item["cluster_scope"] = cl
            grouped[cl] = cl_ranked
            standings.extend(cl_ranked)

    total_rupiah = round(sum(s["reward_rupiah"] for s in standings), 0)

    # Leaderboard tidak punya target volume — "target"-nya adalah masuk rank
    # 1-3 (di scope masing-masing, global atau per-cluster). forced_status
    # override status berbasis-lift supaya toko rank 1-3 selalu dihitung sukses
    # walau basis_ranking-nya growth_pct dengan volume absolut kecil.
    baseline = get_baseline_volume(
        [s["id_toko"] for s in standings], promo["periode_mulai"], promo["periode_selesai"], df_filtered,
    )
    analytics_rows = [
        {
            "id_toko": s["id_toko"], "nama_toko": s["nama_toko"],
            "during_vol": s["volume_periode"], "target_ton": None,
            "reward_rupiah": s["reward_rupiah"],
            "forced_status": "over_achiever" if s["rank"] <= 3 else None,
        }
        for s in standings
    ]
    analytics = compute_program_analytics(analytics_rows, baseline, total_rupiah)

    return {
        "tipe_program":           "leaderboard",
        "program_id":             promo["id"],
        "program_nama":           promo.get("nama_promo", ""),
        "basis_ranking":          basis,
        "scope":                  scope,
        "bentuk_reward":          bentuk_reward,
        "minimum_transaksi":      min_trx,
        "total_peserta_eligible": len(eligible),
        "tidak_eligible":         tidak_eligible,
        "total_reward_rupiah":    total_rupiah,
        "standings":              standings,
        "grouped_standings":      grouped,
        "analytics":              analytics,
    }


def calculate_program_reward(
    promo: dict,
    peserta_data: list[dict],
    transaksi_df: pd.DataFrame,
    loyalty_config: dict,
) -> dict[str, Any]:
    """Router: panggil kalkulasi sesuai tipe_program."""
    tipe = promo.get("tipe_program") or (
        "multi_tier" if promo.get("reward_config") else "legacy"
    )
    if tipe == "flat_multiplier":
        return calculate_flat_multiplier_program(promo, peserta_data, transaksi_df, loyalty_config)
    if tipe == "flat_per_batch":
        return calculate_flat_per_batch_program(promo, peserta_data, transaksi_df, loyalty_config)
    if tipe == "multi_tier":
        return calculate_program_reward_summary(promo, peserta_data, transaksi_df, loyalty_config)
    if tipe == "leaderboard":
        return calculate_leaderboard_standings(promo, peserta_data, transaksi_df, loyalty_config)
    return {}

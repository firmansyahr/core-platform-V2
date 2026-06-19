"""Multi-tier target reward calculator — brand-based point conversion."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

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

    df = transaksi_df.copy()
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()
    df_period = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]

    # Volume per toko (exclude fighting brand)
    fighting = "SEMEN BANTENG"
    brand_col = next(
        (c for c in df_period.columns if "brand" in c.lower()), None
    )
    if brand_col:
        df_period = df_period[~df_period[brand_col].str.upper().eq(fighting)]

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

    return {
        "tipe_program":       "multi_tier",
        "program_id":         promo["id"],
        "program_nama":       promo.get("nama_promo", promo.get("nama", "")),
        "total_peserta":      len(results),
        "total_poin":         round(total_poin_program, 0),
        "total_rupiah":       round(total_rupiah_program, 0),
        "tier_distribution":  tier_distribution,
        "peserta_detail":     results,
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
    brand_filter: list = reward_config.get("brand_filter", [])
    brand_point_values = loyalty_config.get("brand_point_values", get_brand_point_values())

    mulai   = pd.Timestamp(promo["periode_mulai"]).normalize()
    selesai = pd.Timestamp(promo["periode_selesai"]).normalize()

    df = transaksi_df.copy()
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()

    fighting  = "SEMEN BANTENG"
    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if brand_col:
        df = df[~df[brand_col].str.upper().eq(fighting)]

    df_period = df[(df["_dt"] >= mulai) & (df["_dt"] <= selesai)]
    agg_ton   = df_period.groupby("ID Toko")["TON Quantity"].sum().to_dict()

    results: list[dict] = []
    for peserta in peserta_data:
        id_toko  = str(peserta["id_toko"])
        volume   = float(agg_ton.get(id_toko, 0.0))
        brand    = peserta.get("brand_utama", "Semen Elang")

        if brand_filter and brand not in brand_filter:
            mult_efektif = 1.0
            keterangan   = f"Brand {brand} tidak dalam filter → multiplier 1X"
        else:
            mult_efektif = multiplier
            keterangan   = f"{multiplier}X flat multiplier"

        pv           = brand_point_values.get(brand, brand_point_values.get("Semen Elang", 5000))
        total_poin   = round(volume * mult_efektif, 2)
        total_rupiah = round(total_poin * pv, 0)

        results.append({
            "id_toko":            id_toko,
            "nama_toko":          peserta.get("nama_toko", ""),
            "cluster":            peserta.get("cluster_pareto", peserta.get("cluster", "")),
            "brand_utama":        brand,
            "volume_ton":         round(volume, 2),
            "multiplier_berlaku": mult_efektif,
            "total_poin":         total_poin,
            "total_rupiah":       total_rupiah,
            "keterangan":         keterangan,
        })

    total_poin_prog   = sum(r["total_poin"]   for r in results)
    total_rupiah_prog = sum(r["total_rupiah"] for r in results)

    return {
        "tipe_program":   "flat_multiplier",
        "program_id":     promo["id"],
        "program_nama":   promo.get("nama_promo", ""),
        "multiplier":     multiplier,
        "brand_filter":   brand_filter,
        "total_peserta":  len(results),
        "total_poin":     round(total_poin_prog, 0),
        "total_rupiah":   round(total_rupiah_prog, 0),
        "peserta_detail": results,
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

    df = transaksi_df.copy()
    df["_dt"] = pd.to_datetime(df["Tanggal Transaksi"]).dt.normalize()

    fighting  = "SEMEN BANTENG"
    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if brand_col:
        df = df[~df[brand_col].str.upper().eq(fighting)]

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
    if tipe == "multi_tier":
        return calculate_program_reward_summary(promo, peserta_data, transaksi_df, loyalty_config)
    if tipe == "leaderboard":
        return calculate_leaderboard_standings(promo, peserta_data, transaksi_df, loyalty_config)
    return {}

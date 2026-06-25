"""Data collectors for AI Report Generator — keeps home.py and insight_engine.py lean."""
from __future__ import annotations

import json
from pathlib import Path

from api.core.aegis_engine import get_store_crs
from api.core.competitor_engine import (
    get_competitor_ranking,
    load_marketshare_brand,
    load_share_provinsi,
    triangulate_aegis_with_asperssi,
)
from api.core.data_loader import load_data
from api.core.performance_engine import get_performance_overview

_LOYALTY_PATH = Path("api/data/loyalty_members.json")
_PROMOS_PATH  = Path("api/data/promos.json")


def _load_loyalty_members() -> list[dict]:
    if not _LOYALTY_PATH.exists():
        return []
    try:
        return json.loads(_LOYALTY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _load_promos() -> list[dict]:
    if not _PROMOS_PATH.exists():
        return []
    try:
        data = json.loads(_PROMOS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ── Competitor ────────────────────────────────────────────────────────────────

def collect_competitor_data() -> dict:
    """Ringkasan kompetitor dari ASPERSSI + triangulasi AEGIS untuk laporan."""
    try:
        store_crs = get_store_crs()
        sp        = load_share_provinsi()
        ms        = load_marketshare_brand()

        tri: list[dict] = []
        if not store_crs.empty:
            tri = triangulate_aegis_with_asperssi(store_crs, sp, ms)

        ranking_result  = get_competitor_ranking(ms)
        rankings        = ranking_result.get("rankings", [])
        aggregate_others = ranking_result.get("aggregate_others")

        konfirmasi = [t for t in tri if t.get("verdict") == "KONFIRMASI_KOMPETITOR"]
        waspada    = [t for t in tri if t.get("verdict") == "WASPADA_AWAL"]
        top_threats = (konfirmasi + waspada)[:3]

        return {
            "triangulation_summary": {
                "konfirmasi_kompetitor": len(konfirmasi),
                "waspada_awal":          len(waspada),
                "internal_seasonal":     len([t for t in tri if t.get("verdict") == "INTERNAL_ATAU_SEASONAL"]),
                "tidak_cukup_data":      len([t for t in tri if t.get("verdict") == "TIDAK_CUKUP_DATA"]),
                "total_provinsi":        len(tri),
            },
            "top_3_threats": [
                {
                    "provinsi":         t.get("provinsi", ""),
                    "verdict":          t.get("verdict", ""),
                    "top_kompetitor":   (t.get("top_competitor") or {}).get("brand", "—"),
                    "ms_change_pp":     (t.get("top_competitor") or {}).get("ms_change_pp", 0),
                    "aegis_warning_pct": t.get("aegis_warning_pct", 0),
                    "aggregate_others_pct": t.get("aggregate_others_pct"),
                    "aggregate_others_trend": t.get("aggregate_others_trend"),
                }
                for t in top_threats
            ],
            "top_5_kompetitor_asperssi": [
                {
                    "brand":        r.get("brand", ""),
                    "avg_ms_pct":   r.get("avg_ms_pct", 0),
                    "avg_trend_pp": r.get("avg_trend_pp", 0),
                    "trend_label":  r.get("trend_label", ""),
                }
                for r in rankings[:5]
            ],
            "aggregate_others": {
                "avg_ms_pct":  aggregate_others.get("avg_ms_pct", 0),
                "trend_label": aggregate_others.get("trend_label", ""),
                "avg_trend_pp": aggregate_others.get("avg_trend_pp", 0),
            } if aggregate_others else None,
        }
    except Exception as e:
        return {
            "error": str(e),
            "triangulation_summary": {
                "konfirmasi_kompetitor": 0, "waspada_awal": 0,
                "internal_seasonal": 0, "tidak_cukup_data": 0, "total_provinsi": 0,
            },
            "top_3_threats": [],
            "top_5_kompetitor_asperssi": [],
            "aggregate_others": None,
        }


# ── Program Promo ─────────────────────────────────────────────────────────────

def collect_program_promo_breakdown() -> dict:
    """Kelompokkan program promo per tipe dan hitung summary masing-masing."""
    promos = _load_promos()

    aktif  = [p for p in promos if p.get("status") == "Aktif"]
    selesai = [p for p in promos if p.get("status") == "Selesai"]

    flat      = [p for p in aktif if p.get("tipe_program") == "flat_multiplier"]
    batch     = [p for p in aktif if p.get("tipe_program") == "flat_per_batch"]
    tier      = [p for p in aktif if p.get("tipe_program") == "multi_tier"]
    lb        = [p for p in aktif if p.get("tipe_program") == "leaderboard"]
    legacy    = [p for p in aktif if p.get("tipe_program") not in ("flat_multiplier", "flat_per_batch", "multi_tier", "leaderboard")]

    def _peserta(prog_list: list[dict]) -> int:
        return sum(len(p.get("peserta", [])) for p in prog_list)

    def _budget(prog_list: list[dict]) -> int:
        return sum(
            p.get("summary_peserta", {}).get("estimasi_budget_total", 0)
            for p in prog_list
        )

    # Multi-tier: distribusi tier saat ini dari monitoring data
    tier_dist: dict[str, int] = {}
    for p in tier:
        for toko_data in p.get("monitoring_data", {}).values():
            t = toko_data.get("tier_saat_ini", "Belum Tercapai")
            tier_dist[t] = tier_dist.get(t, 0) + 1

    # Leaderboard: top 3 peserta overall (dari peserta list, sorted by posisi jika ada)
    lb_top: list[dict] = []
    for p in lb:
        peserta = p.get("peserta", [])
        mon     = p.get("monitoring_data", {})
        ranked = sorted(
            peserta,
            key=lambda pe: mon.get(pe.get("id_toko", ""), {}).get("total_poin", 0),
            reverse=True,
        )
        for pe in ranked[:3]:
            lb_top.append({
                "nama_promo": p.get("nama_promo", ""),
                "nama_toko":  pe.get("nama_toko") or pe.get("id_toko", ""),
            })
    lb_top = lb_top[:3]

    return {
        "total_program":    len(promos),
        "total_aktif":      len(aktif),
        "total_selesai":    len(selesai),
        "flat_multiplier": {
            "jumlah_aktif":  len(flat),
            "total_peserta": _peserta(flat),
            "total_rupiah":  _budget(flat),
            "nama_program":  [p.get("nama_promo", "") for p in flat[:3]],
        },
        "flat_per_batch": {
            "jumlah_aktif":  len(batch),
            "total_peserta": _peserta(batch),
            "total_rupiah":  _budget(batch),
            "nama_program":  [p.get("nama_promo", "") for p in batch[:3]],
        },
        "multi_tier": {
            "jumlah_aktif":    len(tier),
            "total_peserta":   _peserta(tier),
            "distribusi_tier": tier_dist,
            "total_rupiah":    _budget(tier),
            "nama_program":    [p.get("nama_promo", "") for p in tier[:3]],
        },
        "leaderboard": {
            "jumlah_aktif":   len(lb),
            "total_peserta":  _peserta(lb),
            "top_3_overall":  lb_top,
            "total_rupiah":   _budget(lb),
            "nama_program":   [p.get("nama_promo", "") for p in lb[:3]],
        },
        "legacy_atau_lainnya": {
            "jumlah_aktif":  len(legacy),
            "total_peserta": _peserta(legacy),
            "total_rupiah":  _budget(legacy),
            "nama_program":  [p.get("nama_promo", "") for p in legacy[:3]],
        },
    }


# ── Performance Tracker ───────────────────────────────────────────────────────

def collect_performance_tracker_data() -> dict:
    """Verdict distribution + top/bottom performers dari Performance Tracker."""
    try:
        df      = load_data()
        crs     = get_store_crs()
        members = _load_loyalty_members()
        overview = get_performance_overview(df, crs, members)

        total   = overview.get("total_dipantau", 0)
        membaik = overview.get("membaik", 0)
        success_rate = round(membaik / total * 100, 1) if total > 0 else 0.0

        stores = overview.get("stores", [])

        top_5 = [
            {
                "nama_toko":    s["nama_toko"],
                "kabupaten":    s.get("kabupaten", ""),
                "vol_delta_pct": s["vol_delta_pct"],
                "verdict":      s["verdict"],
            }
            for s in stores
            if s.get("verdict") == "Membaik"
        ][:5]

        watch_list = [
            {
                "nama_toko":    s["nama_toko"],
                "kabupaten":    s.get("kabupaten", ""),
                "vol_delta_pct": s["vol_delta_pct"],
                "verdict":      s["verdict"],
            }
            for s in stores
            if s.get("verdict") == "Perlu Perhatian"
        ][:5]

        return {
            "total_dipantau":   total,
            "verdict_distribution": {
                "membaik":          overview.get("membaik", 0),
                "stabil":           overview.get("stabil", 0),
                "perlu_perhatian":  overview.get("perlu_perhatian", 0),
                "dalam_pemantauan": overview.get("dalam_pemantauan", 0),
            },
            "success_rate_pct":      success_rate,
            "top_5_success_stories": top_5,
            "watch_list":            watch_list,
        }
    except Exception as e:
        return {
            "error": str(e),
            "total_dipantau":   0,
            "verdict_distribution": {
                "membaik": 0, "stabil": 0,
                "perlu_perhatian": 0, "dalam_pemantauan": 0,
            },
            "success_rate_pct":      0.0,
            "top_5_success_stories": [],
            "watch_list":            [],
        }

"""
OracleToolkit — fungsi-fungsi data nyata yang dipanggil ORACLE (tool calling).

PRINSIP: setiap method di sini WAJIB delegasi ke engine yang sudah ada
(aegis_engine, cannibalization_engine, competitor_engine, cad_storage,
promo_engine, promo_calculator, ilp_engine) — TIDAK ADA data fiktif.
Kalau data tidak tersedia secara nyata di sistem (mis. riwayat alokasi ILP
per toko tidak pernah dipersist), method mengembalikan status eksplisit
"tidak tersedia", bukan mengarang angka.
"""
from __future__ import annotations

import functools
from typing import Any, Callable

import pandas as pd

from api.core.aegis_engine import get_store_crs
from api.core.oracle_guard import TTLCache
from api.core.cad_storage import get_records as cad_get_records
from api.core.cad_storage import get_toko_cad_history
from api.core.cannibalization_engine import get_store_cannibalization_status, load_cached_result
from api.core.competitor_engine import (
    get_competitor_ranking,
    load_marketshare_brand,
    load_share_provinsi,
    triangulate_aegis_with_asperssi,
)
from api.core.data_loader import get_data
from api.core.ilp_engine import get_ilp_features, solve_ilp
from api.core.promo_calculator import calculate_program_reward, get_baseline_volume, load_loyalty_config
from api.core.promo_engine import calculate_promo_achievement, get_cluster_comparison, get_promo_summary
from api.database import SessionLocal
from api.models import LoyaltyHistory, LoyaltyMember


def _cached(ttl_seconds: float) -> Callable:
    """Cache hasil method (keyed dari nama method + args) di self._cache (TTLCache).
    Hanya untuk tool read-only — data yang berubah dari aksi admin (mis. tambah
    peserta promo) TIDAK dipakaikan decorator ini, supaya tidak basi."""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(self: "OracleToolkit", *args: Any, **kwargs: Any) -> Any:
            key = f"{func.__name__}:{args}:{sorted(kwargs.items())}"
            cached = self._cache.get(key)
            if cached is not None:
                return cached
            result = func(self, *args, **kwargs)
            self._cache.set(key, result, ttl_seconds)
            return result
        return wrapper
    return decorator


def _promo_tipe(promo: dict) -> str:
    return promo.get("tipe_program") or ("multi_tier" if promo.get("reward_config") else "legacy")


class OracleToolkit:
    """Tool implementations — satu method = satu tool yang bisa dipanggil Claude."""

    def __init__(self) -> None:
        self._cache = TTLCache()

    # ── Promo ────────────────────────────────────────────────────────────────

    @_cached(300)  # 5 menit — peserta/config promo bisa berubah dari aksi admin
    def get_promo_detail(self, promo_id: str) -> dict:
        """Detail lengkap program promo termasuk peserta dan config."""
        from api.routers.promo import _get_promo_by_id  # lazy — hindari circular import saat startup

        promo = _get_promo_by_id(promo_id)
        if not promo:
            return {"status": "not_found", "promo_id": promo_id}
        return {"status": "ok", "promo": promo, "tipe_program": _promo_tipe(promo)}

    @_cached(300)  # 5 menit — sama alasan dengan get_promo_detail
    def get_program_roi_analysis(self, promo_id: str) -> dict:
        """ROI lengkap: baseline, incremental volume, cost per ton — semua tipe program."""
        from api.routers.promo import _get_promo_by_id

        promo = _get_promo_by_id(promo_id)
        if not promo:
            return {"status": "not_found", "promo_id": promo_id}
        if promo["status"] not in ("Aktif", "Selesai"):
            return {"status": "error", "message": "ROI hanya tersedia untuk promo Aktif atau Selesai"}

        tipe = _promo_tipe(promo)
        df_trx = get_data()
        loyalty_cfg = load_loyalty_config()

        if tipe in ("flat_multiplier", "multi_tier", "leaderboard"):
            result = calculate_program_reward(promo, promo.get("peserta", []), df_trx, loyalty_cfg)
            return {"status": "ok", "tipe_program": tipe, "analytics": result.get("analytics")}

        # Legacy: tidak punya struktur "analytics" universal, pakai jalur lama.
        ach_df = calculate_promo_achievement(promo, df_trx)
        summary = get_promo_summary(promo, ach_df)
        cluster_cmp = get_cluster_comparison(promo, df_trx) if promo["status"] == "Selesai" else []
        return {
            "status": "ok", "tipe_program": "legacy",
            "legacy_summary": summary, "cluster_comparison": cluster_cmp,
        }

    def compare_programs(self, promo_ids: list[str]) -> dict:
        """Bandingkan ROI/analytics dua atau lebih program promo."""
        comparisons = [
            {"promo_id": pid, **self.get_program_roi_analysis(pid)}
            for pid in promo_ids
        ]
        return {"status": "ok", "comparisons": comparisons}

    # ── Volume & baseline ────────────────────────────────────────────────────

    @_cached(1800)  # 30 menit — histori bulanan, cukup stabil dalam jangka pendek
    def get_toko_volume_history(self, toko_id: str, bulan_mulai: str, bulan_selesai: str) -> dict:
        """Volume bulanan toko dari data transaksi nyata, periode [bulan_mulai, bulan_selesai] (YYYY-MM)."""
        df = get_data()
        if df is None or df.empty:
            return {"status": "error", "message": "Data transaksi tidak tersedia"}

        sub = df[df["ID Toko"] == toko_id].copy()
        if sub.empty:
            return {"status": "not_found", "toko_id": toko_id}

        sub["_bulan"] = sub["Tanggal Transaksi"].dt.to_period("M").astype(str)
        sub = sub[(sub["_bulan"] >= bulan_mulai) & (sub["_bulan"] <= bulan_selesai)]
        monthly = (
            sub.groupby("_bulan")["TON Quantity"].sum().round(2).sort_index()
        )
        return {
            "status": "ok", "toko_id": toko_id,
            "monthly_volume": [{"bulan": k, "volume_ton": float(v)} for k, v in monthly.items()],
        }

    @_cached(3600)  # 1 jam — data historis tidak berubah
    def get_baseline_comparison(self, toko_ids: list[str], periode_mulai: str, lookback_months: int = 3) -> dict:
        """Baseline vs realisasi volume per toko — pakai get_baseline_volume() yang sama dengan Analisis promo."""
        df = get_data()
        periode_selesai = periode_mulai  # baseline 1 bulan ke depan dari mulai, kalau caller tidak kasih range

        # Estimasi periode_selesai = akhir bulan periode_mulai supaya durasi baseline = 1 bulan kalender.
        mulai_ts = pd.Timestamp(periode_mulai).normalize()
        periode_selesai = str((mulai_ts + pd.offsets.MonthEnd(0)).date())

        baseline = get_baseline_volume(toko_ids, periode_mulai, periode_selesai, df, lookback_months=lookback_months)

        sub = df[df["ID Toko"].isin(toko_ids)].copy()
        sub["_bulan"] = sub["Tanggal Transaksi"].dt.to_period("M").astype(str)
        bulan_target = str(mulai_ts.to_period("M"))
        during = sub[sub["_bulan"] == bulan_target].groupby("ID Toko")["TON Quantity"].sum().to_dict()

        rows = []
        for tid in toko_ids:
            b = float(baseline.get(tid, 0.0))
            d = float(during.get(tid, 0.0))
            lift_pct = ((d - b) / b * 100) if b > 0 else (100.0 if d > 0 else 0.0)
            rows.append({"toko_id": tid, "baseline_vol": round(b, 2), "during_vol": round(d, 2), "lift_pct": round(lift_pct, 1)})
        return {"status": "ok", "periode": bulan_target, "per_toko": rows}

    # ── Competitor ───────────────────────────────────────────────────────────

    @_cached(3600)  # 1 jam — data ASPERSSI update bulanan, tidak perlu real-time
    def get_competitor_activity(self, area_ids: list[str], periode: str | None = None) -> dict:
        """Triangulasi AEGIS + ASPERSSI untuk provinsi tertentu (area_ids = nama provinsi)."""
        crs = get_store_crs()
        share_prov = load_share_provinsi()
        ms_brand = load_marketshare_brand()
        triangulation = triangulate_aegis_with_asperssi(crs, share_prov, ms_brand)
        filtered = [t for t in triangulation if t.get("provinsi") in area_ids] if area_ids else triangulation
        return {"status": "ok", "periode": periode, "triangulation": filtered}

    @_cached(3600)  # 1 jam — sama alasan dengan get_competitor_activity
    def get_market_share_trend(self, area_id: str, periode: str | None = None) -> dict:
        """Ranking brand kompetitor dari data ASPERSSI untuk satu provinsi."""
        ms_brand = load_marketshare_brand()
        entries = [e for e in ms_brand.get("data", []) if e.get("provinsi") == area_id]
        if periode:
            entries = [e for e in entries if e.get("periode") == periode]
        ranking = get_competitor_ranking({"data": entries})
        return {"status": "ok", "area_id": area_id, "periode": periode, "ranking": ranking}

    # ── AEGIS / CAD ──────────────────────────────────────────────────────────

    def get_aegis_alerts(self, toko_id: str | None = None, area_id: str | None = None) -> dict:
        """CAD alert aktif + history — per toko (history) atau per kabupaten (alert aktif)."""
        if toko_id:
            history = get_toko_cad_history(toko_id)
            crs = get_store_crs()
            row = crs[crs["ID Toko"] == toko_id]
            current = None
            if not row.empty:
                r = row.iloc[0]
                current = {"alert": str(r.get("alert", "Normal")), "aegis_score": round(float(r.get("aegis_score", 0)), 2)}
            return {"status": "ok", "toko_id": toko_id, "current": current, "cad_history": history}

        records, total = cad_get_records(kabupaten=area_id, limit=20)
        return {"status": "ok", "area_id": area_id, "total": total, "alerts": records}

    # ── GMM / Cannibalization ────────────────────────────────────────────────

    @_cached(3600)  # 1 jam — model GMM statis sampai re-training
    def get_cluster_migration(self, toko_id: str, periode: str | None = None) -> dict:
        """Status kanibalisasi/brand-shift toko dari model GMM ter-train terakhir."""
        training_result = load_cached_result()
        if not training_result:
            return {"status": "unavailable", "message": "Model GMM belum pernah di-training"}
        status = get_store_cannibalization_status(toko_id, training_result)
        return {"status": "ok", "periode_model": training_result.get("trained_at"), **status}

    # ── ILP ──────────────────────────────────────────────────────────────────

    def get_ilp_allocation_history(self, toko_id: str) -> dict:
        """Riwayat alokasi budget ILP — TIDAK dipersist di sistem ini (ILP adalah optimizer
        stateless yang dijalankan on-demand, bukan tabel histori per toko). Return apa adanya,
        jangan dikarang."""
        return {
            "status": "not_tracked",
            "message": (
                "ILP adalah optimizer on-demand — sistem tidak menyimpan riwayat alokasi per toko. "
                "Cek apakah toko ini pernah masuk ke program loyalty (get_loyalty_member_profile) "
                "sebagai indikasi tidak langsung."
            ),
        }

    @_cached(900)  # 15 menit — AEGIS score update berkala, tidak perlu real-time
    def get_area_heatmap_data(self, metric: str, periode: str | None = None) -> dict:
        """Agregasi per kabupaten: 'risk' (AEGIS) atau 'volume'."""
        if metric == "risk":
            crs = get_store_crs()
            if crs.empty:
                return {"status": "ok", "metric": metric, "areas": []}
            agg = (
                crs.groupby("Kabupaten Toko")
                .agg(avg_score=("aegis_score", "mean"), n_warning=("alert", lambda s: (s != "Normal").sum()), total=("alert", "size"))
                .reset_index()
            )
            areas = [
                {"kabupaten": r["Kabupaten Toko"], "avg_aegis_score": round(float(r["avg_score"]), 1),
                 "n_warning": int(r["n_warning"]), "total_toko": int(r["total"])}
                for _, r in agg.iterrows()
            ]
            return {"status": "ok", "metric": metric, "areas": sorted(areas, key=lambda a: -a["avg_aegis_score"])[:20]}

        if metric == "volume":
            df = get_data()
            sub = df.copy()
            sub["_bulan"] = sub["Tanggal Transaksi"].dt.to_period("M").astype(str)
            if periode:
                sub = sub[sub["_bulan"] == periode]
            agg = sub.groupby("Kabupaten Toko")["TON Quantity"].sum().sort_values(ascending=False)
            areas = [{"kabupaten": k, "volume_ton": round(float(v), 2)} for k, v in agg.head(20).items()]
            return {"status": "ok", "metric": metric, "periode": periode, "areas": areas}

        return {"status": "error", "message": f"metric '{metric}' tidak dikenal — pakai 'risk' atau 'volume'"}

    # ── Loyalty ──────────────────────────────────────────────────────────────

    def get_loyalty_member_profile(self, toko_id: str) -> dict:
        """Profile loyalty member: status, reward_type, tanggal masuk, history perubahan."""
        db = SessionLocal()
        try:
            member = db.query(LoyaltyMember).filter_by(id_toko=toko_id).order_by(LoyaltyMember.tgl_masuk.desc()).first()
            if not member:
                return {"status": "not_member", "toko_id": toko_id}
            history = (
                db.query(LoyaltyHistory)
                .filter_by(id_toko=toko_id)
                .order_by(LoyaltyHistory.tanggal.desc())
                .limit(10)
                .all()
            )
            return {
                "status": "ok",
                "toko_id": toko_id,
                "nama_toko": member.nama_toko,
                "cluster_pareto": member.cluster_pareto,
                "reward_type": member.reward_type,
                "status_member": member.status,
                "tgl_masuk": member.tgl_masuk.isoformat() if member.tgl_masuk else None,
                "tgl_keluar": member.tgl_keluar.isoformat() if member.tgl_keluar else None,
                "history": [
                    {"tanggal": h.tanggal.isoformat(), "perubahan": h.perubahan, "alasan": h.alasan}
                    for h in history
                ],
            }
        finally:
            db.close()

    # ── Cross-module ─────────────────────────────────────────────────────────

    def get_cross_module_summary(self, toko_id: str) -> dict:
        """Summary toko dari semua modul: AEGIS, loyalty, cannibalization, market context."""
        crs = get_store_crs()
        row = crs[crs["ID Toko"] == toko_id]
        aegis = None
        provinsi = kabupaten = None
        if not row.empty:
            r = row.iloc[0]
            aegis = {"alert": str(r.get("alert", "Normal")), "aegis_score": round(float(r.get("aegis_score", 0)), 2)}
            provinsi = str(r.get("Provinsi Toko", "")) or None
            kabupaten = str(r.get("Kabupaten Toko", "")) or None

        loyalty = self.get_loyalty_member_profile(toko_id)
        cannibalization = self.get_cluster_migration(toko_id)

        return {
            "status": "ok", "toko_id": toko_id,
            "provinsi": provinsi, "kabupaten": kabupaten,
            "aegis": aegis,
            "loyalty": {k: v for k, v in loyalty.items() if k != "history"},
            "cannibalization": cannibalization if cannibalization.get("status") == "ok" else None,
        }

    # ── What-if simulation ───────────────────────────────────────────────────

    def simulate_scenario(self, scenario_type: str, params: dict) -> dict:
        """
        What-if simulation. Dua tipe didukung secara nyata (pakai solve_ilp/data asli):
          - "budget_change": re-run ILP optimizer dengan budget baru, bandingkan jumlah
            toko terpilih dan total skor vs budget saat ini.
          - "reward_rate_change": estimasi ulang total budget loyalty bulanan dari avg_ton
            member aktif × rate baru (Rp/ton), dibandingkan dengan rate saat ini.
        Tipe lain ditolak eksplisit — TIDAK mengarang hasil simulasi.
        """
        if scenario_type == "budget_change":
            new_budget = float(params.get("new_budget", 0))
            n_max = int(params.get("n_max", 100))
            features = get_ilp_features()
            if features.empty:
                return {"status": "error", "message": "Data fitur ILP tidak tersedia"}
            from api.core.ilp_engine import apply_ilp_scoring
            scored = apply_ilp_scoring(features)
            selected, _ = solve_ilp(scored, budget=new_budget, n_max=n_max)
            return {
                "status": "ok", "scenario_type": scenario_type, "new_budget": new_budget,
                "n_toko_terpilih": len(selected),
                "total_estimated_cost": round(float(selected["estimated_cost"].sum()), 0) if not selected.empty else 0,
                "avg_score": round(float(selected["score"].mean()), 2) if not selected.empty else 0,
            }

        if scenario_type == "reward_rate_change":
            new_rate = float(params.get("new_rate_per_ton", 0))
            db = SessionLocal()
            try:
                members = db.query(LoyaltyMember).filter_by(status="Aktif").all()
                toko_ids = [m.id_toko for m in members]
            finally:
                db.close()
            df = get_data()
            sub = df[df["ID Toko"].isin(toko_ids)]
            latest_month = sub["Tanggal Transaksi"].dt.to_period("M").max()
            avg_ton_total = sub[sub["Tanggal Transaksi"].dt.to_period("M") == latest_month]["TON Quantity"].sum()
            new_total_budget = round(float(avg_ton_total) * new_rate, 0)
            return {
                "status": "ok", "scenario_type": scenario_type, "new_rate_per_ton": new_rate,
                "total_volume_bulan_terakhir": round(float(avg_ton_total), 2),
                "estimated_new_monthly_budget": new_total_budget,
            }

        return {
            "status": "error",
            "message": f"scenario_type '{scenario_type}' belum didukung — pakai 'budget_change' atau 'reward_rate_change'",
        }

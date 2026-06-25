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

        if tipe in ("flat_multiplier", "flat_per_batch", "multi_tier", "leaderboard"):
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

    # ── ORACLE Phase 2.5 — sinyal untuk CAD auto-validation ──────────────────
    #
    # CAD alert beroperasi di level KABUPATEN (id format "CAD-YYYYMMDD-
    # KABUPATEN", lihat CADAlert di models.py), bukan per-toko — semua sinyal
    # di bawah ini diagregasi dari toko-toko di kabupaten alert tersebut.

    def get_volume_trend(self, cad_id: str) -> dict:
        """Trend volume bulanan (6 bulan terakhir) kabupaten dari CAD alert."""
        from api.core.cad_storage import get_record_by_id

        alert = get_record_by_id(cad_id)
        if not alert:
            return {"status": "not_found", "cad_id": cad_id}
        kabupaten = alert["kabupaten"]
        df = get_data()
        sub = df[df["Kabupaten Toko"] == kabupaten]
        if sub.empty:
            return {"status": "not_found", "kabupaten": kabupaten}
        monthly = sub.groupby(sub["Tanggal Transaksi"].dt.to_period("M"))["TON Quantity"].sum().sort_index().tail(6)
        trend = [{"bulan": str(p), "volume_ton": round(float(v), 2)} for p, v in monthly.items()]
        mom_change_pct = None
        if len(trend) >= 2 and trend[-2]["volume_ton"] > 0:
            mom_change_pct = round((trend[-1]["volume_ton"] - trend[-2]["volume_ton"]) / trend[-2]["volume_ton"] * 100, 1)
        return {"status": "ok", "kabupaten": kabupaten, "trend": trend, "mom_change_pct": mom_change_pct}

    def get_gmm_cluster_history(self, cad_id: str) -> dict:
        """Distribusi cluster GMM toko-toko di kabupaten dari CAD alert ini."""
        from api.core.cad_storage import get_record_by_id

        alert = get_record_by_id(cad_id)
        if not alert:
            return {"status": "not_found", "cad_id": cad_id}
        training_result = load_cached_result()
        if not training_result:
            return {"status": "not_tracked", "message": "Model GMM belum pernah di-training"}
        kabupaten = alert["kabupaten"]
        df = get_data()
        toko_ids = df[df["Kabupaten Toko"] == kabupaten]["ID Toko"].unique().tolist()
        labels = []
        for tid in toko_ids:
            r = get_store_cannibalization_status(tid, training_result)
            if r.get("status") == "ok":
                labels.append(r["cluster_label"])
        if not labels:
            return {"status": "not_found", "kabupaten": kabupaten}
        counts = pd.Series(labels).value_counts().to_dict()
        return {
            "status": "ok", "kabupaten": kabupaten, "cluster_distribution": counts,
            "dominant_cluster": max(counts, key=counts.get), "total_toko_dianalisis": len(labels),
        }

    def get_competitor_activity_nearby(self, cad_id: str) -> dict:
        """Delegasi ke get_competitor_activity untuk provinsi dari CAD alert ini."""
        from api.core.cad_storage import get_record_by_id

        alert = get_record_by_id(cad_id)
        if not alert:
            return {"status": "not_found", "cad_id": cad_id}
        provinsi = alert.get("provinsi")
        if not provinsi:
            return {"status": "not_tracked", "message": "Provinsi tidak tercatat di CAD alert ini"}
        return self.get_competitor_activity([provinsi])

    def get_seasonal_pattern(self, cad_id: str) -> dict:
        return {
            "status": "not_tracked",
            "message": "Tidak ada engine seasonal decomposition di sistem ini — pola musiman tidak tersedia.",
        }

    def get_peer_comparison(self, cad_id: str) -> dict:
        """Bandingkan AEGIS score rata-rata kabupaten vs provinsi vs nasional."""
        from api.core.cad_storage import get_record_by_id

        alert = get_record_by_id(cad_id)
        if not alert:
            return {"status": "not_found", "cad_id": cad_id}
        kabupaten, provinsi = alert["kabupaten"], alert.get("provinsi")
        crs = get_store_crs()
        if crs.empty:
            return {"status": "not_found", "kabupaten": kabupaten}
        kab_avg = crs.loc[crs["Kabupaten Toko"] == kabupaten, "aegis_score"].mean()
        prov_avg = crs.loc[crs["Provinsi Toko"] == provinsi, "aegis_score"].mean() if provinsi else None
        nat_avg = crs["aegis_score"].mean()
        return {
            "status": "ok", "kabupaten": kabupaten, "provinsi": provinsi,
            "avg_aegis_kabupaten": round(float(kab_avg), 1) if pd.notna(kab_avg) else None,
            "avg_aegis_provinsi": round(float(prov_avg), 1) if provinsi and pd.notna(prov_avg) else None,
            "avg_aegis_nasional": round(float(nat_avg), 1),
        }

    def get_program_status(self, cad_id: str) -> dict:
        """Persentase toko di kabupaten ini yang aktif dalam program loyalty."""
        from api.core.cad_storage import get_record_by_id

        alert = get_record_by_id(cad_id)
        if not alert:
            return {"status": "not_found", "cad_id": cad_id}
        kabupaten = alert["kabupaten"]
        df = get_data()
        toko_ids = set(df[df["Kabupaten Toko"] == kabupaten]["ID Toko"].unique().tolist())
        if not toko_ids:
            return {"status": "not_found", "kabupaten": kabupaten}
        db = SessionLocal()
        try:
            n_aktif = db.query(LoyaltyMember).filter(
                LoyaltyMember.id_toko.in_(toko_ids), LoyaltyMember.status == "Aktif",
            ).count()
        finally:
            db.close()
        return {
            "status": "ok", "kabupaten": kabupaten, "total_toko_kabupaten": len(toko_ids),
            "toko_program_aktif": n_aktif, "pct_dalam_program": round(n_aktif / len(toko_ids) * 100, 1),
        }

    def get_payment_history(self, cad_id: str) -> dict:
        return {
            "status": "not_tracked",
            "message": "CORE Platform tidak punya modul billing/kredit — riwayat pembayaran toko tidak tersedia.",
        }

    # ── ORACLE Phase 2.5 — sinyal untuk daily monitoring ─────────────────────

    def get_promo_deadlines(self, days_threshold: int = 7) -> dict:
        """Promo Aktif yang periode_selesai-nya dalam N hari ke depan."""
        from datetime import date, timedelta

        from api.routers.promo import _get_promos

        today = date.today()
        cutoff = today + timedelta(days=days_threshold)
        deadlines = []
        for p in _get_promos():
            if p.get("status") != "Aktif":
                continue
            selesai_raw = p.get("periode_selesai")
            if not selesai_raw:
                continue
            selesai = selesai_raw if isinstance(selesai_raw, date) else date.fromisoformat(str(selesai_raw)[:10])
            if today <= selesai <= cutoff:
                deadlines.append({
                    "promo_id": p["id"], "nama_promo": p["nama_promo"],
                    "periode_selesai": str(selesai), "hari_tersisa": (selesai - today).days,
                })
        return {"status": "ok", "deadlines": sorted(deadlines, key=lambda x: x["hari_tersisa"])}

    def get_roi_drops(self, threshold_pct: float = -20.0, period_days: int = 7) -> dict:
        """Promo Aktif dengan ROI kumulatif saat ini di bawah threshold.
        CATATAN: ini snapshot ROI TERKINI, bukan delta dalam period_days —
        sistem tidak menyimpan time-series ROI historis untuk dibandingkan."""
        from api.routers.promo import _get_promos

        drops = []
        for p in _get_promos():
            if p.get("status") != "Aktif":
                continue
            result = self.get_program_roi_analysis(p["id"])
            if result.get("status") != "ok":
                continue
            roi_pct = ((result.get("analytics") or {}).get("roi") or {}).get("roi_pct")
            if roi_pct is not None and roi_pct < threshold_pct:
                drops.append({"promo_id": p["id"], "nama_promo": p["nama_promo"], "roi_pct": roi_pct})
        return {
            "status": "ok",
            "note": "Snapshot ROI saat ini — bukan perubahan dalam period_days (tidak ada time-series ROI historis)",
            "threshold_pct": threshold_pct, "drops": sorted(drops, key=lambda x: x["roi_pct"]),
        }

    def get_unvalidated_cad(self, max_age_hours: int = 24) -> dict:
        """CAD alert dalam N jam terakhir yang belum punya verdict ORACLE."""
        from datetime import datetime, timedelta

        from api.core.cad_storage import get_records as cad_list_records
        from api.models import OracleCadVerdict

        cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
        records, _total = cad_list_records(limit=200)  # sudah sorted terbaru dulu
        db = SessionLocal()
        try:
            verdicted_ids = {row[0] for row in db.query(OracleCadVerdict.cad_id).all()}
        finally:
            db.close()
        unvalidated = []
        for a in records:
            tgl = a.get("tgl_alert") or a.get("tanggal_alert")
            if not tgl:
                continue
            try:
                alert_dt = datetime.fromisoformat(str(tgl)[:19])
            except ValueError:
                continue
            if alert_dt < cutoff:
                break  # records sorted descending — sisanya pasti lebih tua
            if a["id"] in verdicted_ids:
                continue
            unvalidated.append({
                "cad_id": a["id"], "kabupaten": a["kabupaten"], "status_alert": a["status_alert"], "tgl_alert": str(tgl),
            })
        return {"status": "ok", "unvalidated": unvalidated}

    def get_budget_warnings(self, threshold_pct: float = 10.0) -> dict:
        return {
            "status": "not_tracked",
            "message": "ILP adalah optimizer on-demand tanpa budget pool ter-persist — tidak ada sisa budget yang bisa dipantau lintas waktu.",
        }

    def get_ms_movements(self, threshold_pp: float = 2.0) -> dict:
        """Provinsi dengan perubahan market share nasional >= threshold_pp
        antar 2 periode ASPERSSI terbaru yang tersedia."""
        share = load_share_provinsi()
        data = [e for e in share.get("data", []) if e.get("tersedia") and e.get("share_nasional_pct") is not None]
        if not data:
            return {"status": "not_tracked", "message": "Data ASPERSSI share_provinsi tidak tersedia"}
        by_provinsi: dict[str, list[dict]] = {}
        for e in data:
            by_provinsi.setdefault(e["provinsi"], []).append(e)
        movements = []
        for provinsi, entries in by_provinsi.items():
            entries.sort(key=lambda e: e["periode"])
            if len(entries) < 2:
                continue
            latest, prev = entries[-1], entries[-2]
            delta = round(latest["share_nasional_pct"] - prev["share_nasional_pct"], 2)
            if abs(delta) >= threshold_pp:
                movements.append({
                    "provinsi": provinsi, "periode_sebelum": prev["periode"], "periode_terbaru": latest["periode"],
                    "delta_pp": delta, "arah": "naik" if delta > 0 else "turun",
                })
        return {"status": "ok", "threshold_pp": threshold_pp, "movements": sorted(movements, key=lambda m: -abs(m["delta_pp"]))}

    def get_area_momentum(self, area: str, granularity: str = "auto") -> dict:
        """Market Share Momentum dua tier (lihat docstring model
        MarketShareMomentum) — provinsi dapat true market share kalau
        ASPERSSI tersedia, kabupaten cuma internal brand mix.

        Method ini SYNC (bukan async seperti spesifikasi awal) — konsisten
        dengan SELURUH method lain di OracleToolkit (semua sync, paralelisme
        di-handle via asyncio.to_thread oleh caller, bukan oleh tool itu
        sendiri — lihat oracle_agent.py)."""
        from api.database import SessionLocal
        from api.models import MarketShareMomentum

        area_key = area.strip().upper()
        db = SessionLocal()
        try:
            target_granularity = granularity
            if granularity == "auto":
                has_provinsi = db.query(MarketShareMomentum).filter(
                    MarketShareMomentum.granularity == "provinsi", MarketShareMomentum.provinsi == area_key,
                ).first()
                target_granularity = "provinsi" if has_provinsi else "kabupaten"

            q = db.query(MarketShareMomentum).filter(MarketShareMomentum.granularity == target_granularity)
            q = q.filter(MarketShareMomentum.provinsi == area_key) if target_granularity == "provinsi" else q.filter(MarketShareMomentum.kabupaten == area_key)
            rows = q.order_by(MarketShareMomentum.periode).all()

            if not rows:
                return {"status": "not_found", "area": area, "message": f"Tidak ada data momentum untuk '{area}'"}

            # latest = brand-mix paling segar (transaksi internal, update terus).
            # latest_true_ms = baris True MS paling baru YANG PERNAH ADA — BISA
            # periode-nya lebih lama dari `latest` karena ASPERSSI di-upload
            # manual dan lag dari transaksi internal (di-konfirmasi via test
            # nyata: ASPERSSI 2025-12/2026-01, transaksi sampai 2026-04 — kalau
            # cuma pakai "latest row" generik, true MS TIDAK PERNAH kepilih
            # walau datanya ada, karena periode terbarunya selalu yang fallback).
            latest = rows[-1]
            true_ms_rows = [r for r in rows if r.asperssi_available]
            latest_true_ms = true_ms_rows[-1] if true_ms_rows else None
            is_true_ms = latest_true_ms is not None

            metric_type = "true_market_share" if is_true_ms else "internal_brand_mix"
            if is_true_ms:
                metric_caveat = (
                    f"True Market Share tersedia untuk periode {latest_true_ms.periode} (ASPERSSI, upload manual) — "
                    f"BUKAN periode transaksi paling baru ({latest.periode}). Brand mix internal periode {latest.periode} "
                    "disertakan sebagai sinyal paling segar; jangan campur dua periode ini saat membandingkan angka."
                )
            else:
                metric_caveat = (
                    "Angka ini Internal Brand Mix — persentase volume Elang/Badak/Banteng dari volume KAMI SENDIRI saja, "
                    "BUKAN true market share. Tidak ada visibilitas kompetitor eksternal di level ini "
                    + ("(kabupaten tidak punya data ASPERSSI)." if target_granularity == "kabupaten" else "(ASPERSSI tidak tersedia untuk provinsi ini).")
                )

            return {
                "status": "ok", "area": area_key, "granularity": target_granularity,
                "metric_type": metric_type, "metric_caveat": metric_caveat,
                "latest_periode": latest.periode,
                "brand_mix_elang_pct": latest.brand_mix_elang_pct, "brand_mix_badak_pct": latest.brand_mix_badak_pct,
                "brand_mix_banteng_pct": latest.brand_mix_banteng_pct,
                "brandmix_momentum_elang": latest.brandmix_momentum_elang, "brandmix_label": latest.brandmix_label,
                "true_market_share_periode": latest_true_ms.periode if latest_true_ms else None,
                "ms_elang_pct": latest_true_ms.ms_elang_pct if latest_true_ms else None,
                "ms_banteng_pct": latest_true_ms.ms_banteng_pct if latest_true_ms else None,
                "ms_kompetitor_pct": latest_true_ms.ms_kompetitor_pct if latest_true_ms else None,
                "ms_momentum_elang": latest_true_ms.ms_momentum_elang if latest_true_ms else None,
                "ms_label": latest_true_ms.ms_label if latest_true_ms else None,
                "primary_threat_source": latest_true_ms.primary_threat_source if latest_true_ms else None,
                "loss_attribution_internal_pct": latest_true_ms.loss_attribution_internal_pct if latest_true_ms else None,
                "loss_attribution_external_pct": latest_true_ms.loss_attribution_external_pct if latest_true_ms else None,
                "trend_periode_count": len(rows),
            }
        finally:
            db.close()

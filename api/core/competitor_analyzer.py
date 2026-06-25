"""
CompetitorAnalyzer — engine komputasi Competitor Intelligence.

Mencakup: compute_market_share_momentum() (MSM dua tier), compute_cpi_all_stores(),
build_win_loss_records(), check_early_warning_tripwires(),
compute_counter_strategy_results(), run_full_analysis().

CPI menggunakan komponen yang tersedia dari data nyata:
- score_fbsi (35%): FBSI level Banteng per toko dari AEGIS engine
- score_volume_trend (30%): MoM perubahan volume Elang per toko
- score_he (20%): tekanan harga efektif dari AEGIS engine
- score_crs (15%): skor CRS raw dari AEGIS engine
"""
from __future__ import annotations

import uuid
from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from api.core.competitor_engine import load_marketshare_brand
from api.core.data_loader import get_data
from api.models import (
    CompetitivePressureIndex,
    CounterStrategyResult,
    EarlyWarningAlert,
    MarketShareMomentum,
    WinLossRecord,
)

ELANG, BADAK, BANTENG = "SEMEN ELANG", "SEMEN BADAK", "SEMEN BANTENG"


def _classify_momentum(delta: float) -> str:
    if delta < -2.0:
        return "accelerating_loss"
    if delta < -0.5:
        return "slow_erosion"
    if delta <= 0.5:
        return "stable"
    return "gaining"


def _brand_volumes(df: pd.DataFrame, group_cols: list[str]) -> pd.DataFrame:
    """Pivot volume per brand per (group_cols, periode) — satu baris per area+periode
    dengan kolom vol_elang/vol_badak/vol_banteng/vol_total."""
    sub = df[df["Brands"].isin([ELANG, BADAK, BANTENG])].copy()
    sub["_periode"] = sub["Tanggal Transaksi"].dt.strftime("%Y-%m")
    agg = (
        sub.groupby(group_cols + ["_periode", "Brands"])["TON Quantity"]
        .sum()
        .unstack("Brands", fill_value=0.0)
        .reset_index()
    )
    for b in (ELANG, BADAK, BANTENG):
        if b not in agg.columns:
            agg[b] = 0.0
    agg = agg.rename(columns={ELANG: "vol_elang", BADAK: "vol_badak", BANTENG: "vol_banteng"})
    agg["vol_total"] = agg["vol_elang"] + agg["vol_badak"] + agg["vol_banteng"]
    return agg


class CompetitorAnalyzer:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ──────────────────────────────────────────────────────────────────────
    # MARKET SHARE MOMENTUM — dua tier
    # ──────────────────────────────────────────────────────────────────────

    def _load_asperssi_own_pct(self) -> dict[tuple[str, str], float]:
        """Sum semua baris is_own_brand=True per (provinsi, periode) dari
        ASPERSSI — bukan asumsi cuma 1 baris (lihat docstring model),
        robust kalau suatu saat data DIPECAH per brand kami sendiri.

        Pakai load_marketshare_brand() (abstraksi JSON/SQLite yang sudah ada
        di competitor_engine.py) — BUKAN query ORM langsung — supaya tetap
        benar di mode JSON fallback (USE_SQLITE_STORAGE=false), konsisten
        dengan cara modul lain di proyek ini membaca data ASPERSSI."""
        payload = load_marketshare_brand()
        own_pct: dict[tuple[str, str], float] = {}
        for entry in payload.get("data", []):
            if not entry.get("tersedia", True):
                continue
            provinsi, periode = entry["provinsi"], entry["periode"]
            for brand in entry.get("brands", []):
                if brand.get("is_own_brand"):
                    key = (provinsi, periode)
                    own_pct[key] = own_pct.get(key, 0.0) + float(brand["market_share_pct"])
        return own_pct

    def _upsert_msm(self, granularity: str, kabupaten: str | None, provinsi: str, periode: str, fields: dict) -> None:
        q = self.db.query(MarketShareMomentum).filter(
            MarketShareMomentum.granularity == granularity,
            MarketShareMomentum.provinsi == provinsi,
            MarketShareMomentum.periode == periode,
        )
        q = q.filter(MarketShareMomentum.kabupaten.is_(None)) if kabupaten is None else q.filter(MarketShareMomentum.kabupaten == kabupaten)
        row = q.first()
        if row:
            for k, v in fields.items():
                setattr(row, k, v)
            row.computed_at = datetime.utcnow().isoformat()
        else:
            self.db.add(MarketShareMomentum(
                id=str(uuid.uuid4()), granularity=granularity, kabupaten=kabupaten, provinsi=provinsi, periode=periode,
                computed_at=datetime.utcnow().isoformat(), **fields,
            ))

    def _compute_brand_mix_series(self, agg: pd.DataFrame, area_col: str) -> dict[str, list[dict]]:
        """Per area: list of {periode, vol_*, brand_mix_*_pct, momentum_*, label}
        sorted by periode — momentum dihitung vs row sebelumnya DI AREA YANG SAMA."""
        series: dict[str, list[dict]] = {}
        for area, grp in agg.groupby(area_col):
            grp = grp.sort_values("_periode")
            prev_elang_pct: float | None = None
            prev_banteng_pct: float | None = None
            rows: list[dict] = []
            for _, r in grp.iterrows():
                total = float(r["vol_total"])
                elang_pct = round(r["vol_elang"] / total * 100, 2) if total > 0 else 0.0
                badak_pct = round(r["vol_badak"] / total * 100, 2) if total > 0 else 0.0
                banteng_pct = round(r["vol_banteng"] / total * 100, 2) if total > 0 else 0.0

                momentum_elang = round(elang_pct - prev_elang_pct, 2) if prev_elang_pct is not None else 0.0
                momentum_banteng = round(banteng_pct - prev_banteng_pct, 2) if prev_banteng_pct is not None else 0.0

                rows.append({
                    "periode": r["_periode"],
                    "vol_elang": float(r["vol_elang"]), "vol_badak": float(r["vol_badak"]),
                    "vol_banteng": float(r["vol_banteng"]), "vol_total": total,
                    "brand_mix_elang_pct": elang_pct, "brand_mix_badak_pct": badak_pct, "brand_mix_banteng_pct": banteng_pct,
                    "brandmix_momentum_elang": momentum_elang, "brandmix_momentum_banteng": momentum_banteng,
                    "brandmix_label": _classify_momentum(momentum_elang),
                })
                prev_elang_pct, prev_banteng_pct = elang_pct, banteng_pct
            series[str(area)] = rows
        return series

    def compute_market_share_momentum(self) -> dict:
        df = get_data()
        if df is None or df.empty:
            return {"kabupaten_records": 0, "provinsi_records": 0, "provinsi_with_asperssi": 0,
                    "provinsi_fallback_only": 0, "by_label": {}, "insight_available": 0}

        kab_agg = _brand_volumes(df, ["Kabupaten Toko"])
        prov_agg = _brand_volumes(df, ["Provinsi Toko"])
        # Provinsi Toko per kabupaten — dipakai utk simpan provinsi pada baris kabupaten.
        kab_to_prov = df.dropna(subset=["Kabupaten Toko", "Provinsi Toko"]).drop_duplicates("Kabupaten Toko").set_index("Kabupaten Toko")["Provinsi Toko"].to_dict()

        kab_series = self._compute_brand_mix_series(kab_agg, "Kabupaten Toko")
        prov_series = self._compute_brand_mix_series(prov_agg, "Provinsi Toko")
        own_pct_lookup = self._load_asperssi_own_pct()

        by_label: dict[str, int] = {}
        kabupaten_records = 0
        provinsi_records = 0
        provinsi_with_asperssi = 0
        provinsi_fallback_only = 0
        insight_available = 0

        # ── Tier 1: kabupaten — internal brand mix saja ──────────────────────
        for kabupaten, rows in kab_series.items():
            provinsi = kab_to_prov.get(kabupaten, "")
            for r in rows:
                self._upsert_msm("kabupaten", kabupaten, provinsi, r["periode"], {
                    "internal_volume_elang": r["vol_elang"], "internal_volume_badak": r["vol_badak"],
                    "internal_volume_banteng": r["vol_banteng"], "internal_volume_total": r["vol_total"],
                    "brand_mix_elang_pct": r["brand_mix_elang_pct"], "brand_mix_badak_pct": r["brand_mix_badak_pct"],
                    "brand_mix_banteng_pct": r["brand_mix_banteng_pct"],
                    "brandmix_momentum_elang": r["brandmix_momentum_elang"], "brandmix_momentum_banteng": r["brandmix_momentum_banteng"],
                    "brandmix_label": r["brandmix_label"], "asperssi_available": 0,
                })
                kabupaten_records += 1
                by_label[r["brandmix_label"]] = by_label.get(r["brandmix_label"], 0) + 1

        # ── Tier 2: provinsi — true MS kalau ASPERSSI tersedia, fallback kalau tidak ──
        for provinsi, rows in prov_series.items():
            for r in rows:
                periode = r["periode"]
                own_pct = own_pct_lookup.get((provinsi, periode))
                fields = {
                    "internal_volume_elang": r["vol_elang"], "internal_volume_badak": r["vol_badak"],
                    "internal_volume_banteng": r["vol_banteng"], "internal_volume_total": r["vol_total"],
                    "brand_mix_elang_pct": r["brand_mix_elang_pct"], "brand_mix_badak_pct": r["brand_mix_badak_pct"],
                    "brand_mix_banteng_pct": r["brand_mix_banteng_pct"],
                    "brandmix_momentum_elang": r["brandmix_momentum_elang"], "brandmix_momentum_banteng": r["brandmix_momentum_banteng"],
                    "brandmix_label": r["brandmix_label"],
                }

                if own_pct and own_pct > 0 and r["vol_total"] > 0:
                    total_market = r["vol_total"] / (own_pct / 100)
                    ms_elang = round(r["vol_elang"] / total_market * 100, 2)
                    ms_badak = round(r["vol_badak"] / total_market * 100, 2)
                    ms_banteng = round(r["vol_banteng"] / total_market * 100, 2)
                    ms_kompetitor = round(max(0.0, 100 - ms_elang - ms_badak - ms_banteng), 2)
                    fields.update({
                        "asperssi_available": 1,
                        "asperssi_volume_total_kompetitor": round(total_market - r["vol_total"], 2),
                        "total_market_volume": round(total_market, 2),
                        "ms_elang_pct": ms_elang, "ms_badak_pct": ms_badak,
                        "ms_banteng_pct": ms_banteng, "ms_kompetitor_pct": ms_kompetitor,
                    })
                    provinsi_with_asperssi += 1
                else:
                    fields.update({
                        "asperssi_available": 0,
                        "asperssi_volume_total_kompetitor": None, "total_market_volume": None,
                        "ms_elang_pct": None, "ms_badak_pct": None, "ms_banteng_pct": None, "ms_kompetitor_pct": None,
                        "ms_momentum_elang": None, "ms_momentum_banteng": None, "ms_momentum_kompetitor": None,
                        "ms_label": None, "loss_attribution_internal_pct": None,
                        "loss_attribution_external_pct": None, "primary_threat_source": None,
                    })
                    provinsi_fallback_only += 1

                self._upsert_msm("provinsi", None, provinsi, periode, fields)
                provinsi_records += 1
                by_label[r["brandmix_label"]] = by_label.get(r["brandmix_label"], 0) + 1

        # SessionLocal dikonfigurasi autoflush=False (api/database.py) — tanpa
        # flush manual di sini, query di loop berikutnya TIDAK akan melihat
        # baris yang baru di-add() di loop tier-2 di atas (row selalu None,
        # loop di bawah diam-diam skip semua iterasi). Ditemukan via test nyata
        # (momentum tetap None walau asperssi_available=1 dan ms_elang_pct terisi).
        self.db.flush()

        # ── True MS momentum + loss attribution — perlu 2 periode berurutan
        # dengan asperssi_available=1, jadi dihitung SETELAH semua baris ada ──
        for provinsi, rows in prov_series.items():
            prev_row: MarketShareMomentum | None = None
            for r in rows:
                row = self.db.query(MarketShareMomentum).filter(
                    MarketShareMomentum.granularity == "provinsi", MarketShareMomentum.provinsi == provinsi,
                    MarketShareMomentum.periode == r["periode"],
                ).first()
                if row is None or not row.asperssi_available:
                    prev_row = None
                    continue

                if prev_row is not None and prev_row.asperssi_available:
                    row.ms_momentum_elang = round(row.ms_elang_pct - prev_row.ms_elang_pct, 2)
                    row.ms_momentum_banteng = round(row.ms_banteng_pct - prev_row.ms_banteng_pct, 2)
                    row.ms_momentum_kompetitor = round(row.ms_kompetitor_pct - prev_row.ms_kompetitor_pct, 2)
                    row.ms_label = _classify_momentum(row.ms_momentum_elang)

                    if row.ms_label in ("accelerating_loss", "slow_erosion"):
                        internal_component = max(0.0, row.ms_momentum_banteng)
                        external_component = max(0.0, row.ms_momentum_kompetitor)
                        denom = internal_component + external_component
                        if denom > 0:
                            row.loss_attribution_internal_pct = round(internal_component / denom * 100, 1)
                            row.loss_attribution_external_pct = round(external_component / denom * 100, 1)
                            if row.loss_attribution_internal_pct >= 60:
                                row.primary_threat_source = "internal_banteng"
                            elif row.loss_attribution_external_pct >= 60:
                                row.primary_threat_source = "external_competitor"
                            else:
                                row.primary_threat_source = "both"
                            insight_available += 1
                        else:
                            row.loss_attribution_internal_pct = None
                            row.loss_attribution_external_pct = None
                            row.primary_threat_source = "none"
                    else:
                        row.loss_attribution_internal_pct = None
                        row.loss_attribution_external_pct = None
                        row.primary_threat_source = "none"
                else:
                    row.ms_momentum_elang = 0.0
                    row.ms_momentum_banteng = 0.0
                    row.ms_momentum_kompetitor = 0.0
                    row.ms_label = _classify_momentum(0.0)
                    row.primary_threat_source = "none"

                prev_row = row

        self.db.commit()

        return {
            "kabupaten_records": kabupaten_records,
            "provinsi_records": provinsi_records,
            "provinsi_with_asperssi": provinsi_with_asperssi,
            "provinsi_fallback_only": provinsi_fallback_only,
            "by_label": by_label,
            "insight_available": insight_available,
        }

    # ──────────────────────────────────────────────────────────────────────
    # CPI — Competitive Pressure Index per toko per periode
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _score_fbsi(fbsi_latest: float) -> float:
        """FBSI level → score 0-100."""
        if fbsi_latest >= 40: return 100.0
        if fbsi_latest >= 25: return 80.0
        if fbsi_latest >= 15: return 60.0
        if fbsi_latest >= 8:  return 35.0
        return 10.0

    @staticmethod
    def _score_vol_trend(pct_change: float) -> float:
        """MoM Elang volume % change → score 0-100 (makin turun makin tinggi)."""
        if pct_change <= -30: return 100.0
        if pct_change <= -15: return 80.0
        if pct_change <= -5:  return 55.0
        if pct_change <= 0:   return 30.0
        if pct_change <= 15:  return 15.0
        return 5.0

    @staticmethod
    def _score_he(delta_he_pct: float) -> float:
        """HE delta % → score 0-100 (makin negatif makin tinggi)."""
        if delta_he_pct <= -15: return 100.0
        if delta_he_pct <= -8:  return 75.0
        if delta_he_pct <= -3:  return 50.0
        if delta_he_pct <= 0:   return 25.0
        return 5.0

    @staticmethod
    def _cpi_label(score: float) -> str:
        if score >= 75: return "critical"
        if score >= 50: return "high"
        if score >= 25: return "medium"
        return "low"

    def compute_cpi_all_stores(self) -> dict:
        """
        Hitung CPI per toko untuk periode terbaru.
        Membutuhkan compute_store_crs() dari AEGIS engine.
        """
        from api.core.aegis_engine import compute_store_crs

        df = get_data()
        if df is None or df.empty:
            return {"stores_processed": 0, "by_label": {}}

        crs_df = compute_store_crs(df)

        # Volume Elang per toko per periode (2 periode terakhir)
        df_copy = df.copy()
        df_copy["_p"] = df_copy["Tanggal Transaksi"].dt.strftime("%Y-%m")
        elang_vol = (
            df_copy[df_copy["Brands"] == ELANG]
            .groupby(["ID Toko", "_p"])["TON Quantity"].sum()
            .reset_index()
            .sort_values(["ID Toko", "_p"])
        )
        # Two latest periods per store
        elang_vol_latest = (
            elang_vol.groupby("ID Toko").tail(2)
        )
        elang_prev = (
            elang_vol_latest.groupby("ID Toko").nth(0)[["TON Quantity"]]
            .rename(columns={"TON Quantity": "vol_prev"})
        )
        elang_cur = (
            elang_vol_latest.groupby("ID Toko").nth(-1)[["TON Quantity", "_p"]]
            .rename(columns={"TON Quantity": "vol_cur"})
        )
        elang_merged = elang_cur.join(elang_prev, how="left")

        periode_latest = df_copy["_p"].max()
        stores_processed = 0
        by_label: dict[str, int] = {}

        for _, row in crs_df.iterrows():
            id_toko = str(row.get("ID Toko", ""))
            if not id_toko:
                continue

            fbsi_val  = float(row.get("fbsi_latest", row.get("fbsi", 0)) or 0)
            delta_fbsi = float(row.get("delta_fbsi", 0) or 0)
            delta_he   = float(row.get("delta_he_pct", 0) or 0)
            crs_val    = float(row.get("crs", row.get("crs_raw", 0)) or 0)
            alert_lv   = str(row.get("alert", "Hijau") or "Hijau")

            ev = elang_merged.loc[id_toko] if id_toko in elang_merged.index else None
            vol_cur  = float(ev["vol_cur"]) if ev is not None and not pd.isna(ev["vol_cur"]) else 0.0
            vol_prev = float(ev["vol_prev"]) if ev is not None and "vol_prev" in ev and not pd.isna(ev["vol_prev"]) else None
            vol_pct  = round((vol_cur - vol_prev) / vol_prev * 100, 2) if vol_prev and vol_prev > 0 else 0.0

            s_fbsi = self._score_fbsi(fbsi_val)
            s_vol  = self._score_vol_trend(vol_pct)
            s_he   = self._score_he(delta_he)
            s_crs  = min(100.0, float(crs_val))

            cpi = round(s_fbsi * 0.35 + s_vol * 0.30 + s_he * 0.20 + s_crs * 0.15, 2)
            label = self._cpi_label(cpi)

            fields = {
                "nama_toko":    str(row.get("Nama Toko", "") or ""),
                "kabupaten":    str(row.get("Kabupaten Toko", "") or ""),
                "provinsi":     str(row.get("Provinsi Toko", "") or ""),
                "score_fbsi":   s_fbsi, "score_volume_trend": s_vol,
                "score_he":     s_he,   "score_crs": s_crs,
                "cpi_score":    cpi,    "cpi_label": label,
                "fbsi_latest":  fbsi_val, "delta_fbsi": delta_fbsi,
                "delta_he_pct": delta_he, "crs_raw": crs_val,
                "elang_vol_cur": vol_cur, "elang_vol_prev": vol_prev,
                "elang_vol_pct": vol_pct, "alert_level": alert_lv,
            }

            existing = self.db.query(CompetitivePressureIndex).filter(
                CompetitivePressureIndex.id_toko == id_toko,
                CompetitivePressureIndex.periode == periode_latest,
            ).first()
            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.computed_at = datetime.utcnow().isoformat()
            else:
                self.db.add(CompetitivePressureIndex(
                    id=str(uuid.uuid4()), id_toko=id_toko,
                    periode=periode_latest, computed_at=datetime.utcnow().isoformat(),
                    **fields,
                ))

            by_label[label] = by_label.get(label, 0) + 1
            stores_processed += 1

        self.db.commit()
        return {"stores_processed": stores_processed, "by_label": by_label, "periode": periode_latest}

    # ──────────────────────────────────────────────────────────────────────
    # WIN/LOSS per toko
    # ──────────────────────────────────────────────────────────────────────

    def build_win_loss_records(self) -> dict:
        """
        Klasifikasi win/loss per toko untuk periode terbaru.
        Harus dipanggil SETELAH compute_cpi_all_stores() agar CPI tersedia.
        """
        df = get_data()
        if df is None or df.empty:
            return {"stores_processed": 0, "by_outcome": {}}

        df_copy = df.copy()
        df_copy["_p"] = df_copy["Tanggal Transaksi"].dt.strftime("%Y-%m")
        periode_latest = df_copy["_p"].max()

        # CPI rows for current period (vol + fbsi data pre-computed)
        cpi_rows = self.db.query(CompetitivePressureIndex).filter(
            CompetitivePressureIndex.periode == periode_latest,
        ).all()

        by_outcome: dict[str, int] = {}
        stores_processed = 0

        for c in cpi_rows:
            vol_cur   = c.elang_vol_cur  or 0.0
            vol_prev  = c.elang_vol_prev
            vol_pct   = c.elang_vol_pct  or 0.0
            fbsi_cur  = c.fbsi_latest    or 0.0
            fbsi_delta = c.delta_fbsi    or 0.0
            fbsi_prev = fbsi_cur - fbsi_delta

            elang_up   = vol_pct > 5.0
            elang_down = vol_pct < -5.0
            banteng_up   = fbsi_delta > 3.0
            banteng_down = fbsi_delta < -3.0

            if elang_up and banteng_down:
                outcome, detail, factor = "win", "elang_gaining", "elang_growth"
            elif elang_up and banteng_up:
                outcome, detail, factor = "win", "elang_gaining", "mixed"
            elif elang_down and banteng_up:
                outcome, detail, factor = "loss", "banteng_surging", "banteng_pressure"
            elif elang_down and banteng_down:
                outcome, detail, factor = "loss", "elang_losing", "price_pressure"
            elif banteng_down and not elang_down:
                outcome, detail, factor = "win", "banteng_retreating", "banteng_pressure"
            else:
                outcome, detail, factor = "neutral", "mixed", "mixed"

            fields = {
                "nama_toko": c.nama_toko, "kabupaten": c.kabupaten, "provinsi": c.provinsi,
                "outcome": outcome, "outcome_detail": detail, "primary_factor": factor,
                "elang_vol_cur": vol_cur, "elang_vol_prev": vol_prev, "elang_vol_pct": vol_pct,
                "banteng_fbsi_cur": fbsi_cur, "banteng_fbsi_prev": fbsi_prev, "banteng_fbsi_delta": fbsi_delta,
            }

            existing = self.db.query(WinLossRecord).filter(
                WinLossRecord.id_toko == c.id_toko,
                WinLossRecord.periode == periode_latest,
            ).first()
            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.computed_at = datetime.utcnow().isoformat()
            else:
                self.db.add(WinLossRecord(
                    id=str(uuid.uuid4()), id_toko=c.id_toko, periode=periode_latest,
                    computed_at=datetime.utcnow().isoformat(), **fields,
                ))

            by_outcome[outcome] = by_outcome.get(outcome, 0) + 1
            stores_processed += 1

        self.db.commit()
        return {"stores_processed": stores_processed, "by_outcome": by_outcome, "periode": periode_latest}

    # ──────────────────────────────────────────────────────────────────────
    # EARLY WARNING TRIPWIRES
    # ──────────────────────────────────────────────────────────────────────

    def _upsert_ewa(
        self, scope: str, scope_id: str, scope_name: str | None,
        provinsi: str | None, periode: str,
        alert_type: str, severity: str, title: str,
        description: str | None, metric_value: float | None,
        metric_threshold: float | None, metric_label: str | None,
    ) -> None:
        existing = self.db.query(EarlyWarningAlert).filter(
            EarlyWarningAlert.scope == scope,
            EarlyWarningAlert.scope_id == scope_id,
            EarlyWarningAlert.periode == periode,
            EarlyWarningAlert.alert_type == alert_type,
        ).first()
        if existing:
            existing.severity = severity
            existing.title = title
            existing.description = description
            existing.metric_value = metric_value
            existing.metric_threshold = metric_threshold
            existing.metric_label = metric_label
            existing.is_active = 1
            existing.triggered_at = datetime.utcnow().isoformat()
        else:
            self.db.add(EarlyWarningAlert(
                id=str(uuid.uuid4()), scope=scope, scope_id=scope_id,
                scope_name=scope_name, provinsi=provinsi, periode=periode,
                alert_type=alert_type, severity=severity, title=title,
                description=description, metric_value=metric_value,
                metric_threshold=metric_threshold, metric_label=metric_label,
                is_active=1, triggered_at=datetime.utcnow().isoformat(),
            ))

    def check_early_warning_tripwires(self) -> dict:
        """
        Scan CPI + MSM tables untuk threshold crossings → buat EarlyWarningAlert.
        Tripwires:
        - CPI critical (>= 75): alert level toko
        - CPI high (>= 50) + banteng_surge (FBSI delta > 10): alert level toko
        - MSM accelerating_loss: alert level kabupaten/provinsi
        - Elang vol drop > 20%: alert level toko
        """
        # Periode terbaru dari CPI table
        from sqlalchemy import func as sql_func
        latest_periode = self.db.query(sql_func.max(CompetitivePressureIndex.periode)).scalar()
        if not latest_periode:
            return {"alerts_created": 0}

        alerts_created = 0

        # ── Tripwire 1+2: CPI per toko ───────────────────────────────────
        cpi_rows = self.db.query(CompetitivePressureIndex).filter(
            CompetitivePressureIndex.periode == latest_periode,
        ).all()

        for c in cpi_rows:
            if c.cpi_score >= 75:
                self._upsert_ewa(
                    "toko", c.id_toko, c.nama_toko, c.provinsi, latest_periode,
                    "cpi_critical", "critical",
                    f"CPI Kritis: {c.nama_toko or c.id_toko}",
                    f"CPI score {c.cpi_score:.1f} — tekanan kompetitif sangat tinggi di toko ini",
                    c.cpi_score, 75.0, "CPI Score",
                )
                alerts_created += 1

            elif c.cpi_score >= 50 and (c.delta_fbsi or 0) > 10:
                self._upsert_ewa(
                    "toko", c.id_toko, c.nama_toko, c.provinsi, latest_periode,
                    "banteng_surge", "high",
                    f"Banteng Surge: {c.nama_toko or c.id_toko}",
                    f"FBSI melonjak +{c.delta_fbsi:.1f}pp dengan CPI {c.cpi_score:.1f}",
                    c.delta_fbsi, 10.0, "Delta FBSI (pp)",
                )
                alerts_created += 1

            if (c.elang_vol_pct or 0) <= -20:
                self._upsert_ewa(
                    "toko", c.id_toko, c.nama_toko, c.provinsi, latest_periode,
                    "elang_vol_drop", "high",
                    f"Volume Elang Anjlok: {c.nama_toko or c.id_toko}",
                    f"Volume Elang turun {c.elang_vol_pct:.1f}% MoM",
                    c.elang_vol_pct, -20.0, "Vol Elang MoM %",
                )
                alerts_created += 1

        # ── Tripwire 3: MSM accelerating_loss per area ───────────────────
        latest_msm_periode = self.db.query(sql_func.max(MarketShareMomentum.periode)).scalar()
        if latest_msm_periode:
            msm_rows = self.db.query(MarketShareMomentum).filter(
                MarketShareMomentum.periode == latest_msm_periode,
                MarketShareMomentum.brandmix_label == "accelerating_loss",
            ).all()

            for m in msm_rows:
                scope_id = m.kabupaten if m.granularity == "kabupaten" else m.provinsi
                self._upsert_ewa(
                    m.granularity, scope_id or "", scope_id, m.provinsi, latest_msm_periode,
                    "ms_erosion_accelerating", "high",
                    f"Erosi Accelerating: {scope_id}",
                    f"Brand mix Elang turun cepat ({m.brandmix_momentum_elang:.1f}pp) di {scope_id}",
                    m.brandmix_momentum_elang, -2.0, "Brandmix Momentum Elang (pp)",
                )
                alerts_created += 1

        self.db.commit()
        return {"alerts_created": alerts_created, "periode": latest_periode}

    # ──────────────────────────────────────────────────────────────────────
    # COUNTER-STRATEGY
    # ──────────────────────────────────────────────────────────────────────

    def compute_counter_strategy_results(self) -> dict:
        """
        Aggregasi per kabupaten → generate CounterStrategyResult.
        Harus dipanggil setelah compute_cpi_all_stores() + build_win_loss_records().
        """
        from sqlalchemy import func as sql_func

        latest_cpi_periode = self.db.query(sql_func.max(CompetitivePressureIndex.periode)).scalar()
        if not latest_cpi_periode:
            return {"areas_processed": 0}

        # Aggregate CPI per kabupaten
        from sqlalchemy import case
        kab_stats = (
            self.db.query(
                CompetitivePressureIndex.kabupaten,
                CompetitivePressureIndex.provinsi,
                sql_func.avg(CompetitivePressureIndex.cpi_score).label("avg_cpi"),
                sql_func.sum(
                    case((CompetitivePressureIndex.cpi_label == "critical", 1), else_=0)
                ).label("n_critical"),
                sql_func.sum(
                    case((CompetitivePressureIndex.cpi_label == "high", 1), else_=0)
                ).label("n_high"),
            )
            .filter(CompetitivePressureIndex.periode == latest_cpi_periode)
            .group_by(CompetitivePressureIndex.kabupaten, CompetitivePressureIndex.provinsi)
            .all()
        )

        # Win/Loss per kabupaten
        wl_stats = (
            self.db.query(
                WinLossRecord.kabupaten,
                sql_func.sum(case((WinLossRecord.outcome == "win", 1), else_=0)).label("n_win"),
                sql_func.sum(case((WinLossRecord.outcome == "loss", 1), else_=0)).label("n_loss"),
            )
            .filter(WinLossRecord.periode == latest_cpi_periode)
            .group_by(WinLossRecord.kabupaten)
            .all()
        )
        wl_map = {r.kabupaten: {"n_win": r.n_win, "n_loss": r.n_loss} for r in wl_stats}

        # MSM latest per kabupaten
        latest_msm = self.db.query(sql_func.max(MarketShareMomentum.periode)).scalar()
        msm_map: dict[str, MarketShareMomentum] = {}
        if latest_msm:
            for m in self.db.query(MarketShareMomentum).filter(
                MarketShareMomentum.periode == latest_msm,
                MarketShareMomentum.granularity == "kabupaten",
            ).all():
                if m.kabupaten:
                    msm_map[m.kabupaten] = m

        areas_processed = 0

        for stat in kab_stats:
            kab = stat.kabupaten or ""
            if not kab:
                continue
            prov = stat.provinsi or ""
            avg_cpi = float(stat.avg_cpi or 0)
            n_critical = int(stat.n_critical or 0)
            n_high = int(stat.n_high or 0)
            wl = wl_map.get(kab, {"n_win": 0, "n_loss": 0})
            msm = msm_map.get(kab)

            ms_trend = float(msm.brandmix_momentum_elang or 0) if msm else 0.0
            primary_threat = msm.primary_threat_source if msm else None

            # Determine strategy
            if primary_threat == "internal_banteng" or (msm and msm.brandmix_label == "accelerating_loss" and (msm.brand_mix_banteng_pct or 0) > 20):
                strategy, priority_val = "retain_banteng", "urgent" if avg_cpi >= 65 else "high"
                actions = [
                    "Audit toko dengan FBSI > 15% — identifikasi alasan migrasi ke Banteng",
                    "Pertimbangkan insentif loyalty khusus untuk toko dengan CPI critical",
                    "Review harga Banteng vs Elang di kabupaten ini",
                ]
                ilp_hint = f"Tambah budget loyalty 15% untuk {kab} — fokus toko CPI critical"
            elif primary_threat == "external_competitor" or avg_cpi >= 50:
                strategy, priority_val = "defend_market", "high" if avg_cpi >= 65 else "medium"
                actions = [
                    "Monitor brand-brand eksternal yang masuk ke area ini",
                    "Perkuat hubungan toko dengan program promo targeted",
                    "Evaluasi harga efektif Elang vs kompetitor eksternal",
                ]
                ilp_hint = f"Prioritaskan toko CPI high/critical di {kab} dalam alokasi ILP"
            elif ms_trend < -1.0 or wl["n_loss"] > wl["n_win"]:
                strategy, priority_val = "recover_elang", "high" if avg_cpi >= 50 else "medium"
                actions = [
                    f"Recovery program untuk {wl['n_loss']} toko yang mengalami loss",
                    "Identifikasi toko dengan penurunan volume Elang > 10% MoM",
                    "Aktifkan program promo flat_per_batch untuk toko target",
                ]
                ilp_hint = f"Alokasikan budget tambahan untuk recovery {kab}"
            else:
                strategy, priority_val = "expand_territory", "low" if avg_cpi < 25 else "medium"
                actions = [
                    f"Area {kab} relatif stabil — pertahankan dan cari peluang ekspansi",
                    "Identifikasi toko baru yang belum menjadi member loyalty",
                    "Gunakan toko win sebagai referral untuk akuisisi toko baru",
                ]
                ilp_hint = None

            fields = {
                "provinsi": prov, "trigger_cpi_avg": avg_cpi,
                "trigger_ms_elang_trend": ms_trend, "trigger_primary_threat": primary_threat,
                "n_stores_critical": n_critical, "n_stores_high": n_high,
                "n_stores_win": wl["n_win"], "n_stores_loss": wl["n_loss"],
                "recommended_actions": actions, "target_metrics": {"cpi_target": 25.0, "elang_vol_trend_target": 5.0},
                "ilp_suggestion": ilp_hint, "priority": priority_val,
            }

            existing = self.db.query(CounterStrategyResult).filter(
                CounterStrategyResult.scope == "kabupaten",
                CounterStrategyResult.scope_id == kab,
                CounterStrategyResult.periode == latest_cpi_periode,
                CounterStrategyResult.strategy_type == strategy,
            ).first()
            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.computed_at = datetime.utcnow().isoformat()
            else:
                self.db.add(CounterStrategyResult(
                    id=str(uuid.uuid4()), scope="kabupaten", scope_id=kab,
                    periode=latest_cpi_periode, strategy_type=strategy,
                    computed_at=datetime.utcnow().isoformat(), **fields,
                ))

            areas_processed += 1

        self.db.commit()
        return {"areas_processed": areas_processed, "periode": latest_cpi_periode}

    # ──────────────────────────────────────────────────────────────────────
    # ORCHESTRATOR
    # ──────────────────────────────────────────────────────────────────────

    def run_full_analysis(self) -> dict:
        """Jalankan semua analisis secara berurutan: MSM → CPI → Win/Loss → EWA → Strategy."""
        msm   = self.compute_market_share_momentum()
        cpi   = self.compute_cpi_all_stores()
        wl    = self.build_win_loss_records()
        ewa   = self.check_early_warning_tripwires()
        strat = self.compute_counter_strategy_results()
        return {
            "market_share_momentum": msm,
            "competitive_pressure_index": cpi,
            "win_loss": wl,
            "early_warning_alerts": ewa,
            "counter_strategy": strat,
        }

"""
CompetitorAnalyzer — engine komputasi Competitor Intelligence.

Scope turn ini: HANYA compute_market_share_momentum() (dua tier — lihat
docstring MarketShareMomentum di models.py). Method lain dari spesifikasi
awal (CPI, win/loss, early warning tripwire, counter-strategy) BELUM
diimplementasikan — diblok oleh kesenjangan data nyata (tidak ada
geolocation toko, tidak ada histori snapshot cluster GMM, ILP allocation
history tidak tersimpan, dll — lihat audit terpisah) dan menunggu arahan
lebih lanjut sebelum dibangun.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from api.core.competitor_engine import load_marketshare_brand
from api.core.data_loader import get_data
from api.models import MarketShareMomentum

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

from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from api.core.aegis_engine import get_store_crs
from api.core.data_loader import load_data

router = APIRouter(prefix="/api/home", tags=["home"])

FIGHTING_BRAND  = "SEMEN BANTENG"
MAIN_BRAND      = "SEMEN ELANG"
COMPANION_BRAND = "SEMEN BADAK"

_META = lambda: {"generated_at": datetime.now(timezone.utc).isoformat()}


class HomeSummary(BaseModel):
    volume_bulan_ini: float
    growth_mom_pct: float
    growth_yoy_pct: float | None
    toko_aktif: int
    fighting_brand_share_pct: float
    warning_merah: int
    warning_oranye: int
    warning_kuning: int
    cad_alert_count: int
    volume_at_risk: float
    volume_at_risk_pct: float


class HomeSummaryResponse(BaseModel):
    status: str
    data: HomeSummary
    meta: dict[str, str]


class TrendPoint(BaseModel):
    bulan: str
    volume: float


class TrendResponse(BaseModel):
    status: str
    data: list[TrendPoint]
    meta: dict[str, str]


@router.get("/trend", response_model=TrendResponse)
def get_home_trend() -> TrendResponse:
    df = load_data()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()
    months = sorted([latest - i for i in range(12)])

    data = [
        TrendPoint(
            bulan=str(m),
            volume=round(float(df[period_col == m]["TON Quantity"].sum()), 2),
        )
        for m in months
    ]

    return TrendResponse(status="ok", data=data, meta=_META())


@router.get("/summary", response_model=HomeSummaryResponse)
def get_home_summary() -> HomeSummaryResponse:
    df = load_data()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()

    vol_current = float(df[period_col == latest]["TON Quantity"].sum())
    vol_prev    = float(df[period_col == latest - 1]["TON Quantity"].sum())
    vol_yoy     = float(df[period_col == latest - 12]["TON Quantity"].sum())

    growth_mom = (vol_current - vol_prev) / vol_prev * 100 if vol_prev > 0 else 0.0
    growth_yoy = (vol_current - vol_yoy) / vol_yoy * 100 if vol_yoy > 0 else None

    latest_mask = period_col == latest
    fb_mask     = df["Brands"] == FIGHTING_BRAND
    total_ton_latest = df[latest_mask]["TON Quantity"].sum()
    fight_ton_latest = df[latest_mask & fb_mask]["TON Quantity"].sum()
    fb_share    = float(fight_ton_latest / total_ton_latest * 100) if total_ton_latest > 0 else 0.0
    toko_aktif  = int(df[latest_mask]["ID Toko"].nunique())

    stores        = get_store_crs()
    warning_stores = stores[stores["alert"] != "Normal"]
    vol_at_risk   = round(float(warning_stores["ton_latest"].fillna(0).sum()), 1)
    vol_at_risk_pct = round(vol_at_risk / float(total_ton_latest) * 100, 2) if total_ton_latest > 0 else 0.0

    return HomeSummaryResponse(
        status="ok",
        data=HomeSummary(
            volume_bulan_ini=round(vol_current, 2),
            growth_mom_pct=round(growth_mom, 2),
            growth_yoy_pct=round(growth_yoy, 2) if growth_yoy is not None else None,
            toko_aktif=toko_aktif,
            fighting_brand_share_pct=round(fb_share, 2),
            warning_merah=int((stores["alert"] == "Merah").sum()),
            warning_oranye=int((stores["alert"] == "Oranye").sum()),
            warning_kuning=int((stores["alert"] == "Kuning").sum()),
            cad_alert_count=int(stores["cad"].sum()),
            volume_at_risk=vol_at_risk,
            volume_at_risk_pct=vol_at_risk_pct,
        ),
        meta=_META(),
    )


# ── Warning Trend (4 minggu terakhir) ─────────────────────────────────────────

@router.get("/warning-trend")
def get_warning_trend() -> dict:
    df = load_data()
    df["_week"] = df["Tanggal Transaksi"].dt.to_period("W")

    all_weeks = sorted(df["_week"].unique())
    # Take last 4 complete weeks (skip the most recent if data is incomplete)
    target_weeks = all_weeks[-4:]

    result = []
    for week in target_weeks:
        wdf = df[df["_week"] == week]

        # Per-store FBSI proxy (fighting brand share of total ton)
        store_total = wdf.groupby("ID Toko")["TON Quantity"].sum()
        store_fb    = (
            wdf[wdf["Brands"] == FIGHTING_BRAND]
            .groupby("ID Toko")["TON Quantity"]
            .sum()
            .reindex(store_total.index, fill_value=0.0)
        )
        fb_pct = (store_fb / store_total.replace(0, float("nan")) * 100).fillna(0)

        merah  = int((fb_pct >= 15.0).sum())
        oranye = int(((fb_pct >= 7.5) & (fb_pct < 15.0)).sum())
        kuning = int(((fb_pct >= 3.0) & (fb_pct < 7.5)).sum())

        # Label: start date of the week as "DD Mon"
        start_ts = week.start_time
        months_id = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"]
        label = f"{start_ts.day} {months_id[start_ts.month - 1]}"

        result.append({
            "minggu": label,
            "merah": merah,
            "oranye": oranye,
            "kuning": kuning,
            "total": merah + oranye + kuning,
        })

    return {"status": "ok", "data": result, "meta": _META()}


# ── Brand Mix (bulan terakhir) ─────────────────────────────────────────────────

@router.get("/brand-mix")
def get_brand_mix() -> dict:
    df = load_data()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()
    ldf = df[period_col == latest]

    total_ton    = float(ldf["TON Quantity"].sum())
    main_ton     = float(ldf[ldf["Brands"] == MAIN_BRAND]["TON Quantity"].sum())
    companion_ton = float(ldf[ldf["Brands"] == COMPANION_BRAND]["TON Quantity"].sum())
    fighting_ton = float(ldf[ldf["Brands"] == FIGHTING_BRAND]["TON Quantity"].sum())

    def pct(v: float) -> float:
        return round(v / total_ton * 100, 1) if total_ton > 0 else 0.0

    return {
        "status": "ok",
        "data": {
            "main_brand_ton":   round(main_ton, 1),
            "companion_ton":    round(companion_ton, 1),
            "fighting_ton":     round(fighting_ton, 1),
            "total_ton":        round(total_ton, 1),
            "main_pct":         pct(main_ton),
            "companion_pct":    pct(companion_ton),
            "fighting_pct":     pct(fighting_ton),
        },
        "meta": _META(),
    }


# ── Warning Heatmap per Provinsi ───────────────────────────────────────────────

@router.get("/warning-heatmap")
def get_warning_heatmap() -> dict:
    stores = get_store_crs()
    df     = load_data()

    # Build kabupaten → provinsi mapping
    kab_prov = (
        df[["Kabupaten Toko", "Provinsi Toko"]]
        .drop_duplicates()
        .set_index("Kabupaten Toko")["Provinsi Toko"]
        .to_dict()
    )
    stores = stores.copy()
    stores["provinsi"] = stores["Kabupaten Toko"].map(kab_prov).fillna("LAINNYA")

    warning_stores = stores[stores["alert"] != "Normal"]

    result = []
    for prov, grp in warning_stores.groupby("provinsi"):
        total   = len(grp)
        merah   = int((grp["alert"] == "Merah").sum())
        oranye  = int((grp["alert"] == "Oranye").sum())
        kuning  = int((grp["alert"] == "Kuning").sum())
        ton     = round(float(grp["ton_latest"].fillna(0).sum()), 1)
        result.append({
            "provinsi":      str(prov),
            "total_warning": total,
            "merah":         merah,
            "oranye":        oranye,
            "kuning":        kuning,
            "pct_merah":     round(merah / total * 100, 1) if total > 0 else 0.0,
            "total_ton":     ton,
        })

    result.sort(key=lambda x: x["total_warning"], reverse=True)
    return {"status": "ok", "data": result, "meta": _META()}

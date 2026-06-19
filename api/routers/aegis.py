import time
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from api.core.aegis_engine import (
    CRS_KUNING,
    FBSI_THRESHOLD,
    HE_THRESHOLD,
    calculate_shap_values,
    get_store_crs,
)
from api.core.data_loader import load_data
from api.core.insight_engine import generate_cad_talking_points, generate_store_insight
from api.core.limiter import limiter
from api.core.predict_engine import forecast_batch, forecast_store_aegis

router = APIRouter(prefix="/api/aegis", tags=["aegis"])

_STATUS_ORDER = {"KRITIS": 0, "MERAH": 1, "KUNING": 2}


class StoreWarning(BaseModel):
    id_toko: str
    nama_toko: str
    kabupaten: str
    cluster_pareto: str
    tso: str
    aegis_score: float
    crs: float
    if_score: float
    if_label: int
    churn_prob: float
    level: str
    pola: str
    pola_kode: str
    delta_fbsi: float
    delta_he_pct: float
    delta_cv: float
    volume_at_risk: float
    top_risk_factor: str | None = None


class WarningsResponse(BaseModel):
    status: str
    data: list[StoreWarning]
    meta: dict[str, Any]


class KabupatenAlert(BaseModel):
    kabupaten: str
    status: str
    jumlah_toko: int


class CadAlertResponse(BaseModel):
    status: str
    data: list[KabupatenAlert]
    meta: dict[str, Any]


def _row_to_warning(row: pd.Series, top_risk_factor: str | None = None) -> StoreWarning:
    return StoreWarning(
        id_toko=str(row["ID Toko"]),
        nama_toko=str(row.get("Nama Toko") or ""),
        kabupaten=str(row.get("Kabupaten Toko") or ""),
        cluster_pareto=str(row.get("Cluster Pareto") or ""),
        tso=str(row.get("TSO") or ""),
        aegis_score=round(float(row.get("aegis_score") or 0), 2),
        crs=round(float(row.get("crs") or 0), 2),
        if_score=round(float(row.get("if_score_norm") or 0), 2),
        if_label=int(row.get("if_label") or 1),
        churn_prob=round(float(row.get("churn_prob") or 0), 4),
        level=str(row.get("alert") or "Normal"),
        pola=str(row.get("pola") or "Normal"),
        pola_kode=str(row.get("pola_kode") or "N"),
        delta_fbsi=round(float(row.get("delta_fbsi") or 0), 2),
        delta_he_pct=round(float(row.get("delta_he_pct") or 0), 2),
        delta_cv=round(float(row.get("delta_cv") or 0), 4),
        volume_at_risk=round(float(row.get("ton_latest") or 0), 2),
        top_risk_factor=top_risk_factor,
    )


@router.get("/warnings", response_model=WarningsResponse)
@limiter.limit("30/minute")
def get_warnings(
    request: Request,
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    limit: int = Query(default=100, ge=1, le=10000),
    offset: int = Query(0, ge=0),
) -> WarningsResponse:
    stores = get_store_crs()
    filtered = stores[
        (stores["aegis_score"] >= min_score) & (stores["alert"] != "Normal")
    ].sort_values("aegis_score", ascending=False)

    # Total volume at risk for all warning stores
    vol_at_risk_total = float(
        filtered["ton_latest"].fillna(0).sum()
    )

    total = len(filtered)
    page  = filtered.iloc[offset : offset + limit]
    data  = [_row_to_warning(row) for _, row in page.iterrows()]

    total_vol = float(stores["ton_latest"].fillna(0).sum())
    vol_at_risk_pct = round(vol_at_risk_total / total_vol * 100, 2) if total_vol > 0 else 0.0

    return WarningsResponse(
        status="ok",
        data=data,
        meta={
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total": total,
            "offset": offset,
            "limit": limit,
            "volume_at_risk_total": round(vol_at_risk_total, 1),
            "volume_at_risk_pct": vol_at_risk_pct,
        },
    )


@router.get("/cad-alert", response_model=CadAlertResponse)
def get_cad_alert() -> CadAlertResponse:
    stores = get_store_crs()
    warning = stores[stores["alert"] != "Normal"].dropna(subset=["Kabupaten Toko"])

    kab_cad = warning.groupby("Kabupaten Toko")["cad"].any()
    kab_has_merah = (
        warning[warning["alert"] == "Merah"]
        .groupby("Kabupaten Toko")["ID Toko"]
        .count()
        .gt(0)
        .reindex(kab_cad.index, fill_value=False)
    )
    kab_count = warning.groupby("Kabupaten Toko")["ID Toko"].count()

    kab_df = pd.DataFrame(
        {"has_cad": kab_cad, "has_merah": kab_has_merah, "jumlah_toko": kab_count}
    )
    kab_df["status"] = "KUNING"
    kab_df.loc[kab_df["has_merah"], "status"] = "MERAH"
    kab_df.loc[kab_df["has_cad"],   "status"] = "KRITIS"
    kab_df["_order"] = kab_df["status"].map(_STATUS_ORDER)
    kab_df = kab_df.sort_values(["_order", "jumlah_toko"], ascending=[True, False])

    data = [
        KabupatenAlert(
            kabupaten=str(kab),
            status=str(row["status"]),
            jumlah_toko=int(row["jumlah_toko"]),
        )
        for kab, row in kab_df.iterrows()
    ]

    return CadAlertResponse(
        status="ok",
        data=data,
        meta={"generated_at": datetime.now(timezone.utc).isoformat()},
    )


@router.get("/top-stores", response_model=WarningsResponse)
def get_top_stores(
    n: int = Query(5, ge=1, le=100, description="Jumlah toko prioritas TSO by AEGIS score"),
) -> WarningsResponse:
    stores = get_store_crs()
    top    = stores[stores["alert"] != "Normal"].nlargest(n, "aegis_score")
    now    = time.time()

    data: list[StoreWarning] = []
    for _, row in top.iterrows():
        tid = str(row["ID Toko"])
        # Use cached SHAP; compute if missing (fast for single row)
        cached_exp = _explain_cache.get(tid)
        if cached_exp and (now - _explain_cache_time.get(tid, 0)) < CACHE_TTL:
            trf = cached_exp.get("top_risk_factor")
        else:
            result = calculate_shap_values(stores, tid)
            if result["status"] == "ok":
                _explain_cache[tid]      = result
                _explain_cache_time[tid] = now
                trf = result.get("top_risk_factor")
            else:
                trf = None
        data.append(_row_to_warning(row, top_risk_factor=trf))

    return WarningsResponse(
        status="ok",
        data=data,
        meta={
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total": len(data),
            "volume_at_risk_total": round(float(top["ton_latest"].fillna(0).sum()), 1),
        },
    )


# ── Store Detail ──────────────────────────────────────────────────────────────

class InfoToko(BaseModel):
    id_toko: str
    nama_toko: str
    kabupaten: str
    provinsi: str
    cluster_pareto: str
    tso: str
    asm: str
    ssm: str

class CurrentWarning(BaseModel):
    aegis_score: float
    crs: float
    level: str
    pola: str
    pola_kode: str
    churn_prob: float
    if_label: int
    if_score: float

class MetricsCurrent(BaseModel):
    fbsi_latest: float
    fbsi_baseline: float
    he_latest: float
    ors_cv_latest: float
    delta_fbsi: float
    delta_he_pct: float
    delta_cv: float
    fbsi_threshold: float
    he_threshold: float

class TrenBulanan(BaseModel):
    bulan: str
    ton_total: float
    ton_main: float
    ton_fighting: float
    fbsi_pct: float

class TrenFbsiPeriod(BaseModel):
    periode: str
    fbsi_pct: float
    he_value: float
    delta_fbsi: float

class StoreDetail(BaseModel):
    info_toko: InfoToko
    current_warning: CurrentWarning
    metrics_current: MetricsCurrent
    tren_bulanan: list[TrenBulanan]
    tren_fbsi: list[TrenFbsiPeriod]
    avg_ton_bulanan: float
    total_transaksi: int
    bulan_aktif: int

class StoreDetailResponse(BaseModel):
    status: str
    data: StoreDetail
    meta: dict[str, Any]


# ── Map Data ──────────────────────────────────────────────────────────────────

class RegionMapData(BaseModel):
    nama: str
    total_toko: int
    warning_count: int
    merah_count: int
    oranye_count: int
    kuning_count: int
    normal_count: int
    avg_aegis_score: float
    warning_pct: float
    merah_pct: float
    cad_status: str  # KRITIS | MERAH | KUNING | NORMAL
    volume_at_risk: float
    dominant_pola: str

class MapDataResponse(BaseModel):
    status: str
    data: list[RegionMapData]
    summary: dict[str, Any]
    meta: dict[str, Any]


@router.get("/map-data", response_model=MapDataResponse)
def get_map_data(
    level: str = Query("provinsi", pattern="^(provinsi|kabupaten)$"),
) -> MapDataResponse:
    stores = get_store_crs()

    group_col = "Provinsi Toko" if level == "provinsi" else "Kabupaten Toko"
    stores = stores.dropna(subset=[group_col])
    stores = stores[stores[group_col].str.strip() != ""]

    result: list[RegionMapData] = []

    for nama, grp in stores.groupby(group_col):
        total   = len(grp)
        merah   = int((grp["alert"] == "Merah").sum())
        oranye  = int((grp["alert"] == "Oranye").sum())
        kuning  = int((grp["alert"] == "Kuning").sum())
        normal  = int((grp["alert"] == "Normal").sum())
        warning = merah + oranye + kuning

        avg_score   = round(float(grp["aegis_score"].mean()), 2)
        warning_pct = round(warning / total * 100, 1) if total > 0 else 0.0
        merah_pct   = round(merah / total * 100, 1) if total > 0 else 0.0

        # Percentage-based thresholds calibrated to synthetic data range:
        # merah_pct max ~7%, warning_pct range 20-35%
        if merah_pct >= 5.5:
            cad_status = "KRITIS"
        elif merah_pct >= 3.5:
            cad_status = "MERAH"
        elif warning_pct >= 29.0:
            cad_status = "KUNING"
        else:
            cad_status = "NORMAL"

        vol_at_risk = round(
            float(grp[grp["alert"] != "Normal"]["ton_latest"].fillna(0).sum()), 1
        )

        # Dominant pola among warning stores
        warn_grp = grp[grp["alert"] != "Normal"]
        if len(warn_grp) > 0 and "pola_kode" in warn_grp.columns:
            pola_counts = warn_grp["pola_kode"].value_counts()
            dominant_pola = str(pola_counts.index[0]) if len(pola_counts) > 0 else "N"
        else:
            dominant_pola = "N"

        result.append(RegionMapData(
            nama=str(nama),
            total_toko=total,
            warning_count=warning,
            merah_count=merah,
            oranye_count=oranye,
            kuning_count=kuning,
            normal_count=normal,
            avg_aegis_score=avg_score,
            warning_pct=warning_pct,
            merah_pct=merah_pct,
            cad_status=cad_status,
            volume_at_risk=vol_at_risk,
            dominant_pola=dominant_pola,
        ))

    # Sort: KRITIS first, then MERAH, KUNING, NORMAL; tie-break by warning_count
    _cad_order = {"KRITIS": 0, "MERAH": 1, "KUNING": 2, "NORMAL": 3}
    result.sort(key=lambda r: (_cad_order.get(r.cad_status, 9), -r.warning_count))

    kritis = sum(1 for r in result if r.cad_status == "KRITIS")
    merah_w = sum(1 for r in result if r.cad_status == "MERAH")
    kuning_w = sum(1 for r in result if r.cad_status == "KUNING")
    normal_w = sum(1 for r in result if r.cad_status == "NORMAL")

    return MapDataResponse(
        status="ok",
        data=result,
        summary={
            "total_wilayah": len(result),
            "kritis_count": kritis,
            "merah_count": merah_w,
            "kuning_count": kuning_w,
            "normal_count": normal_w,
            "level": level,
        },
        meta={"generated_at": datetime.now(timezone.utc).isoformat()},
    )


# ── AEGIS-PREDICT ─────────────────────────────────────────────────────────────

_predict_cache: dict[str, dict] = {}
_predict_cache_time: dict[str, float] = {}
CACHE_TTL = 3600  # 1 hour

# ── AEGIS-EXPLAIN (SHAP) ──────────────────────────────────────────────────────

_explain_cache: dict[str, dict] = {}
_explain_cache_time: dict[str, float] = {}


class BatchPredictRequest(BaseModel):
    id_toko_list: list[str]
    limit: int = 20


@router.get("/predict/{id_toko}")
def get_store_prediction(id_toko: str) -> dict:
    now = time.time()
    cached = _predict_cache.get(id_toko)
    if cached and (now - _predict_cache_time.get(id_toko, 0)) < CACHE_TTL:
        return {
            "status":    "ok",
            "data":      cached,
            "cached":    True,
            "cached_at": datetime.fromtimestamp(
                _predict_cache_time[id_toko], tz=timezone.utc
            ).isoformat(),
        }

    stores = get_store_crs()
    if not (stores["ID Toko"] == id_toko).any():
        raise HTTPException(status_code=404, detail=f"Store '{id_toko}' not found")

    df = load_data()
    result = forecast_store_aegis(df, id_toko, horizon_weeks=4)

    if result["status"] == "ok":
        _predict_cache[id_toko]      = result
        _predict_cache_time[id_toko] = now

    return {
        "status":    "ok",
        "data":      result,
        "cached":    False,
        "cached_at": None,
    }


@router.post("/predict/batch")
def get_batch_prediction(req: BatchPredictRequest) -> dict:
    limit     = min(req.limit, 20)
    toko_list = req.id_toko_list[:limit]
    df        = load_data()

    # Use cache for any already-computed stores
    now     = time.time()
    to_run  = []
    results = []
    for tid in toko_list:
        cached = _predict_cache.get(tid)
        if cached and (now - _predict_cache_time.get(tid, 0)) < CACHE_TTL:
            results.append({
                "id_toko":            tid,
                "current_score":      cached["current_score"],
                "predicted_score_4w": cached["predicted_score_4w"],
                "predicted_level_4w": cached["predicted_level_4w"],
                "trend":              cached["trend"],
                "trend_delta":        cached["trend_delta"],
                "trend_color":        cached["trend_color"],
                "level_change":       cached["level_change"],
                "level_worse":        cached.get("level_worse", False),
                "cached":             True,
            })
        else:
            to_run.append(tid)

    if to_run:
        fresh = forecast_batch(df, to_run, horizon_weeks=4)
        for r in fresh:
            if "current_score" in r:
                _predict_cache[r["id_toko"]]      = r  # type: ignore[assignment]
                _predict_cache_time[r["id_toko"]] = now
            results.append({**r, "cached": False})

    return {
        "status": "ok",
        "data":   results,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total":        len(results),
            "from_cache":   len(results) - len(to_run),
        },
    }


@router.get("/explain/{id_toko}")
def get_store_explanation(id_toko: str) -> dict:
    now        = time.time()
    cached_exp = _explain_cache.get(id_toko)
    if cached_exp and (now - _explain_cache_time.get(id_toko, 0)) < CACHE_TTL:
        return {
            "status"    : "ok",
            "data"      : cached_exp,
            "cached"    : True,
            "cached_at" : datetime.fromtimestamp(
                _explain_cache_time[id_toko], tz=timezone.utc
            ).isoformat(),
        }

    stores = get_store_crs()
    if not (stores["ID Toko"] == id_toko).any():
        raise HTTPException(status_code=404, detail=f"Store '{id_toko}' not found")

    result = calculate_shap_values(stores, id_toko)

    if result["status"] == "ok":
        _explain_cache[id_toko]      = result
        _explain_cache_time[id_toko] = now

    return {
        "status"    : "ok",
        "data"      : result,
        "cached"    : False,
        "cached_at" : None,
    }


@router.get("/store/{id_toko}/cad-validasi")
def get_store_cad_history(id_toko: str) -> dict:
    """Return all CAD alert validations that include this toko."""
    from api.core import cad_storage as _cad
    history = _cad.get_toko_cad_history(id_toko)
    return {
        "status":   "ok",
        "data":     history,
        "meta":     {"generated_at": datetime.now(timezone.utc).isoformat()},
    }


@router.get("/store/{id_toko}/insight")
def get_store_insight(id_toko: str) -> dict:
    """Generate AI narrative insight for a specific store."""
    stores = get_store_crs()
    row_mask = stores["ID Toko"] == id_toko
    if not row_mask.any():
        raise HTTPException(status_code=404, detail=f"Store '{id_toko}' not found")

    row = stores[row_mask].iloc[0]
    store_data = {
        "id_toko":       id_toko,
        "nama_toko":     str(row.get("Nama Toko") or ""),
        "cluster_pareto":str(row.get("Cluster Pareto") or ""),
        "aegis_score":   round(float(row.get("aegis_score") or 0), 2),
        "level":         str(row.get("alert") or "Normal"),
        "pola_kode":     str(row.get("pola_kode") or "N"),
        "churn_prob":    round(float(row.get("churn_prob") or 0), 4),
    }

    # Try to enrich with cached SHAP data
    now = time.time()
    shap_data: dict | None = None
    cached_exp = _explain_cache.get(id_toko)
    if cached_exp and (now - _explain_cache_time.get(id_toko, 0)) < CACHE_TTL:
        shap_data = cached_exp
    else:
        result = calculate_shap_values(stores, id_toko)
        if result["status"] == "ok":
            _explain_cache[id_toko]      = result
            _explain_cache_time[id_toko] = now
            shap_data = result

    insight = generate_store_insight(store_data, shap_data)
    return {"status": "ok", "data": insight, "meta": {"generated_at": datetime.now(timezone.utc).isoformat()}}


@router.get("/cad-alert/talking-points")
def get_cad_talking_points(kabupaten: str = Query(..., min_length=1)) -> dict:
    """Generate TSO talking points for a CAD alert kabupaten."""
    stores = get_store_crs()
    kab_stores = stores[
        (stores["Kabupaten Toko"].str.upper() == kabupaten.upper()) &
        (stores["alert"] != "Normal")
    ]

    stores_list = [
        {
            "id_toko":   str(r["ID Toko"]),
            "nama_toko": str(r.get("Nama Toko") or ""),
            "pola_kode": str(r.get("pola_kode") or "N"),
            "level":     str(r.get("alert") or "Normal"),
        }
        for _, r in kab_stores.iterrows()
    ]

    result = generate_cad_talking_points(kabupaten, stores_list)
    return {"status": "ok", "data": result, "meta": {"generated_at": datetime.now(timezone.utc).isoformat()}}


@router.get("/store/{id_toko}", response_model=StoreDetailResponse)
def get_store_detail(id_toko: str) -> StoreDetailResponse:
    stores = get_store_crs()
    df = load_data()

    row_mask = stores["ID Toko"] == id_toko
    if not row_mask.any():
        raise HTTPException(status_code=404, detail=f"Store '{id_toko}' not found")

    row = stores[row_mask].iloc[0]

    # Filter raw data for this store
    sdf = df[df["ID Toko"] == id_toko].copy()
    sdf["_p"] = sdf["Tanggal Transaksi"].dt.to_period("M")
    latest_p = sdf["_p"].max()

    MAIN_BRAND     = "SEMEN ELANG"
    FIGHTING_BRAND = "SEMEN BANTENG"

    # ── Monthly trends (12 months, oldest → newest) ───────────────────────────
    months_12 = [latest_p - i for i in range(11, -1, -1)]
    tren_bulanan: list[TrenBulanan] = []
    for p in months_12:
        p_df = sdf[sdf["_p"] == p]
        tot   = float(p_df["TON Quantity"].sum())
        main  = float(p_df[p_df["Brands"] == MAIN_BRAND]["TON Quantity"].sum())
        fight = float(p_df[p_df["Brands"] == FIGHTING_BRAND]["TON Quantity"].sum())
        fbsi  = fight / tot * 100 if tot > 0 else 0.0
        tren_bulanan.append(TrenBulanan(
            bulan=str(p),
            ton_total=round(tot, 2),
            ton_main=round(main, 2),
            ton_fighting=round(fight, 2),
            fbsi_pct=round(fbsi, 2),
        ))

    # ── FBSI / HE 8-period trend ──────────────────────────────────────────────
    months_8 = [latest_p - i for i in range(7, -1, -1)]
    prev_fbsi: float | None = None
    tren_fbsi: list[TrenFbsiPeriod] = []
    for p in months_8:
        p_df  = sdf[sdf["_p"] == p]
        tot   = float(p_df["TON Quantity"].sum())
        fight = float(p_df[p_df["Brands"] == FIGHTING_BRAND]["TON Quantity"].sum())
        fbsi  = fight / tot * 100 if tot > 0 else 0.0
        # HE = Harga Efektif = revenue per ton
        rev   = float((p_df["Harga"] * p_df["Zak Quantity"].fillna(0)).sum())
        he    = round(rev / tot) if tot > 0 else 0
        d_fbsi = round(fbsi - prev_fbsi, 2) if prev_fbsi is not None else 0.0
        prev_fbsi = fbsi
        tren_fbsi.append(TrenFbsiPeriod(
            periode=str(p),
            fbsi_pct=round(fbsi, 2),
            he_value=float(he),
            delta_fbsi=d_fbsi,
        ))

    # ── Statistics ────────────────────────────────────────────────────────────
    avg_ton    = float(sdf.groupby("_p")["TON Quantity"].sum().mean())
    total_trx  = int(sdf["No Transaksi"].nunique())
    bulan_aktif = int(sdf["_p"].nunique())

    return StoreDetailResponse(
        status="ok",
        data=StoreDetail(
            info_toko=InfoToko(
                id_toko=str(row["ID Toko"]),
                nama_toko=str(row.get("Nama Toko") or ""),
                kabupaten=str(row.get("Kabupaten Toko") or ""),
                provinsi=str(row.get("Provinsi Toko") or ""),
                cluster_pareto=str(row.get("Cluster Pareto") or ""),
                tso=str(row.get("TSO") or ""),
                asm=str(row.get("ASM") or ""),
                ssm=str(row.get("SSM") or ""),
            ),
            current_warning=CurrentWarning(
                aegis_score=round(float(row.get("aegis_score") or 0), 2),
                crs=round(float(row.get("crs") or 0), 2),
                level=str(row.get("alert") or "Normal"),
                pola=str(row.get("pola") or "Normal"),
                pola_kode=str(row.get("pola_kode") or "N"),
                churn_prob=round(float(row.get("churn_prob") or 0), 4),
                if_label=int(row.get("if_label") or 1),
                if_score=round(float(row.get("if_score_norm") or 0), 2),
            ),
            metrics_current=MetricsCurrent(
                fbsi_latest=round(float(row.get("fbsi_latest") or 0), 2),
                fbsi_baseline=round(float(row.get("fbsi_baseline") or 0), 2),
                he_latest=round(float(row.get("he_latest") or 0), 0),
                ors_cv_latest=round(float(row.get("delta_cv") or 0), 4),
                delta_fbsi=round(float(row.get("delta_fbsi") or 0), 2),
                delta_he_pct=round(float(row.get("delta_he_pct") or 0), 2),
                delta_cv=round(float(row.get("delta_cv") or 0), 4),
                fbsi_threshold=float(FBSI_THRESHOLD),
                he_threshold=float(HE_THRESHOLD),
            ),
            tren_bulanan=tren_bulanan,
            tren_fbsi=tren_fbsi,
            avg_ton_bulanan=round(avg_ton, 2),
            total_transaksi=total_trx,
            bulan_aktif=bulan_aktif,
        ),
        meta={"generated_at": datetime.now(timezone.utc).isoformat()},
    )

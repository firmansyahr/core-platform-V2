"""Competitor Intelligence API routes."""
from __future__ import annotations

import io
import json
import time
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from api.core import competitor_engine as ce
from api.core import cad_storage
from api.core import insight_engine as ie
from api.core.aegis_engine import compute_store_crs
from api.core.auth import get_current_admin_user
from api.core.competitor_analyzer import CompetitorAnalyzer
from api.core.data_loader import get_data
from api.database import SessionLocal
from api.models import (
    CompetitivePressureIndex,
    CounterStrategyResult,
    EarlyWarningAlert,
    MarketShareMomentum,
    WinLossRecord,
)

router = APIRouter(prefix="/api/competitor", tags=["competitor"])


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ok(data: Any, **extra: Any) -> dict:
    return {"status": "ok", "data": data, "meta": {"generated_at": _ts(), **extra}}


# ── ASPERSSI file loaders (cached per request is fine given small size) ──────

def _get_crs_by_provinsi() -> pd.DataFrame:
    df = get_data()
    if df is None or df.empty:
        return pd.DataFrame()
    try:
        return compute_store_crs(df)
    except Exception:
        return pd.DataFrame()


# ── CRUD helpers for ASPERSSI data ───────────────────────────────────────────

def _ensure_ms_row_ids(payload: dict) -> tuple[dict, bool]:
    changed = False
    ts  = int(time.time() * 1000)
    idx = 0
    for entry in payload.get("data", []):
        for brand in entry.get("brands", []):
            if "row_id" not in brand:
                brand["row_id"] = f"MS-{ts}-{idx}"
                idx += 1
                changed = True
    return payload, changed


def _ensure_sp_row_ids(payload: dict) -> tuple[dict, bool]:
    changed = False
    ts = int(time.time() * 1000)
    for idx, entry in enumerate(payload.get("data", [])):
        if "row_id" not in entry:
            entry["row_id"] = f"SP-{ts}-{idx}"
            changed = True
    return payload, changed


def _load_ms_with_ids() -> dict:
    payload = ce.load_marketshare_brand()
    payload, changed = _ensure_ms_row_ids(payload)
    if changed:
        ce.save_marketshare_brand(payload)
    return payload


def _load_sp_with_ids() -> dict:
    payload = ce.load_share_provinsi()
    payload, changed = _ensure_sp_row_ids(payload)
    if changed:
        ce.save_share_provinsi(payload)
    return payload


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class AddMsRowBody(BaseModel):
    provinsi:             str
    periode:              str
    nama_brand:           str
    market_share_pct:     float
    is_own_brand:         bool = False
    is_aggregate_others:  bool | None = None  # None = auto-detect from name


class UpdateMsRowBody(BaseModel):
    market_share_pct:    float
    is_own_brand:        bool
    is_aggregate_others: bool | None = None  # None = keep existing value


class ToggleAggregateBody(BaseModel):
    is_aggregate_others: bool


class AddSpRowBody(BaseModel):
    provinsi:          str
    periode:           str
    share_nasional_pct: float


class UpdateSpRowBody(BaseModel):
    share_nasional_pct: float


# ── AI Insight ────────────────────────────────────────────────────────────────

@router.get("/insight")
def competitor_insight() -> dict:
    store_crs = _get_crs_by_provinsi()
    sp        = ce.load_share_provinsi()
    ms        = ce.load_marketshare_brand()

    tri: list[dict] = []
    if not store_crs.empty:
        tri = ce.triangulate_aegis_with_asperssi(store_crs, sp, ms)

    ranking = ce.get_competitor_ranking(ms)
    result  = ie.generate_competitor_insight(tri, ranking["rankings"])
    return _ok(result)


# ── Coverage ──────────────────────────────────────────────────────────────────

@router.get("/coverage")
def coverage() -> dict:
    return _ok(ce.get_asperssi_coverage())


# ── Triangulation ─────────────────────────────────────────────────────────────

@router.get("/triangulation")
def triangulation() -> dict:
    from api.core.cannibalization_engine import load_cached_result

    store_crs = _get_crs_by_provinsi()
    if store_crs.empty:
        raise HTTPException(503, "Data AEGIS tidak tersedia")
    sp  = ce.load_share_provinsi()
    ms  = ce.load_marketshare_brand()
    res = ce.triangulate_aegis_with_asperssi(store_crs, sp, ms)

    gmm_result = load_cached_result()
    if gmm_result:
        res = ce.cross_check_gmm_with_triangulation(res, gmm_result, store_crs)

    return _ok(res)


# ── Competitor ranking ────────────────────────────────────────────────────────

@router.get("/ranking")
def ranking() -> dict:
    ms = ce.load_marketshare_brand()
    return _ok(ce.get_competitor_ranking(ms))


# ── CAD Intelligence ──────────────────────────────────────────────────────────

@router.get("/cad-intelligence")
def cad_intelligence() -> dict:
    records = cad_storage.get_records(status="all", kabupaten="", limit=9999, offset=0)
    intel   = ce.get_cad_intelligence(records)
    return _ok(intel)


# ── Overview (combined) ───────────────────────────────────────────────────────
# Lightweight: coverage + CAD intel only.
# Triangulation summary is derived on the frontend from /triangulation.
# Ranking is fetched independently from /ranking.

@router.get("/overview")
def overview() -> dict:
    cov     = ce.get_asperssi_coverage()
    records = cad_storage.get_records(status="all", kabupaten="", limit=9999, offset=0)
    cad_intel = ce.get_cad_intelligence(records)

    return _ok({
        "coverage":              cov,
        "competitor_ranking_cad": cad_intel["kompetitor_list"][:5],
        "data_disclaimer": [
            "Semua data ASPERSSI dalam persen — tidak tersedia volume absolut",
            "Share provinsi dan market share brand dari periode berbeda",
            "Triangulasi berdasarkan arah tren, bukan magnitude absolut",
        ],
    })


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/asperssi/template/share-provinsi")
def template_share_provinsi() -> StreamingResponse:
    df = pd.DataFrame({
        "Provinsi":            ["JAWA TIMUR", "JAWA TENGAH"],
        "Periode (YYYY-MM)":   ["2026-03",    "2026-03"],
        "Share Nasional (%)":  [18.5,          14.2],
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False, sheet_name="Share Provinsi")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=template_share_provinsi.xlsx"},
    )


@router.get("/asperssi/template/marketshare")
def template_marketshare() -> StreamingResponse:
    df = pd.DataFrame({
        "Provinsi":           ["JAWA TIMUR", "JAWA TIMUR", "JAWA TIMUR"],
        "Periode (YYYY-MM)":  ["2025-12",    "2025-12",    "2025-12"],
        "Nama Brand":         ["Semen Elang", "Brand Kompetitor A", "Lainnya"],
        "Market Share (%)":   [28.5,           22.3,               49.2],
        "Brand Sendiri (Y/N)": ["Y",           "N",                "N"],
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False, sheet_name="Market Share Brand")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=template_marketshare_brand.xlsx"},
    )


# ── Upload share provinsi ─────────────────────────────────────────────────────

@router.post("/asperssi/upload-share-provinsi")
async def upload_share_provinsi(
    file: UploadFile = File(...),
    _user: dict      = Depends(get_current_admin_user),
) -> dict:
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "File harus berformat Excel (.xlsx / .xls)")

    contents = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Gagal membaca Excel: {e}")

    required = {"Provinsi", "Periode (YYYY-MM)", "Share Nasional (%)"}
    missing  = required - set(df.columns)
    if missing:
        raise HTTPException(400, f"Kolom tidak ditemukan: {missing}")

    existing = ce.load_share_provinsi()
    old_data = existing.get("data", [])
    old_set  = {(d["provinsi"], d["periode"]) for d in old_data}

    new_rows: list[dict] = []
    periode_baru: set[str] = set()
    errors: list[str]      = []

    for i, row in df.iterrows():
        prov    = str(row["Provinsi"]).strip().upper()
        periode = str(row["Periode (YYYY-MM)"]).strip()
        try:
            share = float(row["Share Nasional (%)"])
        except (ValueError, TypeError):
            errors.append(f"Baris {i+2}: nilai Share Nasional bukan angka")
            continue

        if not (0 <= share <= 100):
            errors.append(f"Baris {i+2}: nilai {share}% di luar rentang 0–100")
            continue

        if (prov, periode) in old_set:
            # Update existing entry
            for d in old_data:
                if d["provinsi"] == prov and d["periode"] == periode:
                    d["share_nasional_pct"] = share
            continue

        new_rows.append({"provinsi": prov, "periode": periode, "share_nasional_pct": share, "tersedia": True})
        periode_baru.add(periode)
        old_set.add((prov, periode))

    all_data   = old_data + new_rows
    all_periodes = sorted({d["periode"] for d in all_data})
    today      = datetime.now(timezone.utc).date().isoformat()

    payload = {
        "metadata": {
            **existing.get("metadata", {}),
            "periode_tersedia": all_periodes,
            "last_updated":     today,
        },
        "data": all_data,
    }
    ce.save_share_provinsi(payload)

    preview = new_rows[:5]
    return _ok({
        "berhasil":       True,
        "baris_diproses": len(df),
        "baris_baru":     len(new_rows),
        "baris_diupdate": len(df) - len(new_rows) - len(errors),
        "periode_baru":   sorted(periode_baru),
        "preview_5_baris": preview,
        "errors":          errors[:10],
    })


# ── Upload market share brand ─────────────────────────────────────────────────

@router.post("/asperssi/upload-marketshare")
async def upload_marketshare(
    file: UploadFile = File(...),
    _user: dict      = Depends(get_current_admin_user),
) -> dict:
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "File harus berformat Excel (.xlsx / .xls)")

    contents = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Gagal membaca Excel: {e}")

    required = {"Provinsi", "Periode (YYYY-MM)", "Nama Brand", "Market Share (%)", "Brand Sendiri (Y/N)"}
    missing  = required - set(df.columns)
    if missing:
        raise HTTPException(400, f"Kolom tidak ditemukan: {missing}")

    existing = ce.load_marketshare_brand()
    old_data = existing.get("data", [])

    # Build a lookup dict keyed by (provinsi, periode)
    lookup: dict[tuple, dict] = {(d["provinsi"], d["periode"]): d for d in old_data}
    periode_baru: set[str] = set()
    errors: list[str]      = []
    processed              = 0

    for i, row in df.iterrows():
        prov    = str(row["Provinsi"]).strip().upper()
        periode = str(row["Periode (YYYY-MM)"]).strip()
        brand   = str(row["Nama Brand"]).strip()
        yn      = str(row["Brand Sendiri (Y/N)"]).strip().upper()
        is_own  = yn == "Y"

        try:
            ms = float(row["Market Share (%)"])
        except (ValueError, TypeError):
            errors.append(f"Baris {i+2}: Market Share bukan angka")
            continue

        if not (0 <= ms <= 100):
            errors.append(f"Baris {i+2}: nilai {ms}% di luar rentang 0–100")
            continue

        key = (prov, periode)
        if key not in lookup:
            lookup[key] = {"provinsi": prov, "periode": periode, "brands": [], "tersedia": True}
            periode_baru.add(periode)

        # Update or append brand in entry
        entry = lookup[key]
        existing_brand = next((b for b in entry["brands"] if b["nama"] == brand), None)
        if existing_brand:
            existing_brand["market_share_pct"] = ms
            existing_brand["is_own_brand"]      = is_own
            # preserve existing is_aggregate_others; auto-detect only if missing
            if "is_aggregate_others" not in existing_brand:
                existing_brand["is_aggregate_others"] = ce.detect_is_aggregate(brand)
        else:
            entry["brands"].append({
                "nama":               brand,
                "market_share_pct":   ms,
                "is_own_brand":       is_own,
                "is_aggregate_others": ce.detect_is_aggregate(brand),
            })
        processed += 1

    all_data    = list(lookup.values())
    all_periodes = sorted({d["periode"] for d in all_data})
    today       = datetime.now(timezone.utc).date().isoformat()

    payload = {
        "metadata": {
            **existing.get("metadata", {}),
            "periode_tersedia": all_periodes,
            "last_updated":     today,
        },
        "data": all_data,
    }
    ce.save_marketshare_brand(payload)

    preview = [
        {"provinsi": d["provinsi"], "periode": d["periode"], "brands_count": len(d["brands"])}
        for d in all_data
        if d["periode"] in periode_baru
    ][:5]

    return _ok({
        "berhasil":        True,
        "baris_diproses":  len(df),
        "baris_berhasil":  processed,
        "periode_baru":    sorted(periode_baru),
        "preview_5_baris": preview,
        "errors":          errors[:10],
    })


# ── Market Share Brand CRUD ───────────────────────────────────────────────────

@router.get("/asperssi/marketshare/list")
def ms_list(provinsi: str = "", periode: str = "") -> dict:
    payload = _load_ms_with_ids()
    rows: list[dict] = []
    for entry in payload.get("data", []):
        if provinsi and entry["provinsi"] != provinsi.strip().upper():
            continue
        if periode and entry["periode"] != periode.strip():
            continue
        for brand in entry.get("brands", []):
            rows.append({
                "row_id":               brand["row_id"],
                "provinsi":             entry["provinsi"],
                "periode":              entry["periode"],
                "nama_brand":           brand["nama"],
                "market_share_pct":     brand["market_share_pct"],
                "is_own_brand":         brand.get("is_own_brand", False),
                "is_aggregate_others":  brand.get("is_aggregate_others", False),
            })
    return _ok(rows)


@router.post("/asperssi/marketshare/add-row")
def ms_add_row(
    body: AddMsRowBody,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    if not (0 <= body.market_share_pct <= 100):
        raise HTTPException(400, "market_share_pct harus antara 0–100")
    payload = _load_ms_with_ids()
    prov  = body.provinsi.strip().upper()
    per   = body.periode.strip()
    brand = body.nama_brand.strip()
    for entry in payload.get("data", []):
        if entry["provinsi"] == prov and entry["periode"] == per:
            if any(b["nama"] == brand for b in entry.get("brands", [])):
                raise HTTPException(400, f"Data {brand} – {prov} – {per} sudah ada")
    is_aggregate = (
        body.is_aggregate_others if body.is_aggregate_others is not None
        else ce.detect_is_aggregate(brand)
    )
    row_id    = f"MS-{int(time.time() * 1000)}-0"
    new_brand = {
        "row_id": row_id, "nama": brand,
        "market_share_pct": body.market_share_pct,
        "is_own_brand": body.is_own_brand,
        "is_aggregate_others": is_aggregate,
    }
    existing_entry = next((e for e in payload.get("data", []) if e["provinsi"] == prov and e["periode"] == per), None)
    if existing_entry:
        existing_entry["brands"].append(new_brand)
    else:
        payload.setdefault("data", []).append({"provinsi": prov, "periode": per, "brands": [new_brand], "tersedia": True})
    payload.setdefault("metadata", {}).update({"periode_tersedia": sorted({e["periode"] for e in payload["data"]}), "last_updated": _today()})
    ce.save_marketshare_brand(payload)
    return _ok({
        "row_id": row_id, "provinsi": prov, "periode": per, "nama_brand": brand,
        "market_share_pct": body.market_share_pct, "is_own_brand": body.is_own_brand,
        "is_aggregate_others": is_aggregate,
    })


@router.put("/asperssi/marketshare/{row_id}")
def ms_update_row(
    row_id: str,
    body: UpdateMsRowBody,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    if not (0 <= body.market_share_pct <= 100):
        raise HTTPException(400, "market_share_pct harus antara 0–100")
    payload = _load_ms_with_ids()
    for entry in payload.get("data", []):
        for brand in entry.get("brands", []):
            if brand.get("row_id") == row_id:
                brand["market_share_pct"] = body.market_share_pct
                brand["is_own_brand"]     = body.is_own_brand
                if body.is_aggregate_others is not None:
                    brand["is_aggregate_others"] = body.is_aggregate_others
                elif "is_aggregate_others" not in brand:
                    brand["is_aggregate_others"] = ce.detect_is_aggregate(brand["nama"])
                payload.setdefault("metadata", {})["last_updated"] = _today()
                ce.save_marketshare_brand(payload)
                return _ok({
                    "row_id": row_id, "provinsi": entry["provinsi"],
                    "periode": entry["periode"], "nama_brand": brand["nama"],
                    "market_share_pct": body.market_share_pct,
                    "is_own_brand": body.is_own_brand,
                    "is_aggregate_others": brand["is_aggregate_others"],
                })
    raise HTTPException(404, f"Row {row_id} tidak ditemukan")


@router.delete("/asperssi/marketshare/{row_id}")
def ms_delete_row(
    row_id: str,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    payload = _load_ms_with_ids()
    for entry in payload.get("data", []):
        brands = entry.get("brands", [])
        for i, brand in enumerate(brands):
            if brand.get("row_id") == row_id:
                brands.pop(i)
                if not brands:
                    payload["data"].remove(entry)
                payload.setdefault("metadata", {})["last_updated"] = _today()
                ce.save_marketshare_brand(payload)
                return _ok({"deleted_row_id": row_id})
    raise HTTPException(404, f"Row {row_id} tidak ditemukan")


@router.put("/asperssi/marketshare/{row_id}/toggle-aggregate")
def ms_toggle_aggregate(
    row_id: str,
    body: ToggleAggregateBody,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    payload = _load_ms_with_ids()
    for entry in payload.get("data", []):
        for brand in entry.get("brands", []):
            if brand.get("row_id") == row_id:
                brand["is_aggregate_others"] = body.is_aggregate_others
                payload.setdefault("metadata", {})["last_updated"] = _today()
                ce.save_marketshare_brand(payload)
                return _ok({
                    "row_id":              row_id,
                    "nama_brand":          brand["nama"],
                    "is_aggregate_others": brand["is_aggregate_others"],
                })
    raise HTTPException(404, f"Row {row_id} tidak ditemukan")


# ── Share Provinsi CRUD ───────────────────────────────────────────────────────

@router.get("/asperssi/share-provinsi/list")
def sp_list(provinsi: str = "", periode: str = "") -> dict:
    payload = _load_sp_with_ids()
    rows: list[dict] = []
    for entry in payload.get("data", []):
        if provinsi and entry["provinsi"] != provinsi.strip().upper():
            continue
        if periode and entry["periode"] != periode.strip():
            continue
        rows.append({
            "row_id":             entry["row_id"],
            "provinsi":           entry["provinsi"],
            "periode":            entry["periode"],
            "share_nasional_pct": entry["share_nasional_pct"],
        })
    return _ok(rows)


@router.post("/asperssi/share-provinsi/add-row")
def sp_add_row(
    body: AddSpRowBody,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    if not (0 <= body.share_nasional_pct <= 100):
        raise HTTPException(400, "share_nasional_pct harus antara 0–100")
    payload = _load_sp_with_ids()
    prov = body.provinsi.strip().upper()
    per  = body.periode.strip()
    if any(e["provinsi"] == prov and e["periode"] == per for e in payload.get("data", [])):
        raise HTTPException(400, f"Data {prov} – {per} sudah ada")
    row_id = f"SP-{int(time.time() * 1000)}-0"
    payload.setdefault("data", []).append({"row_id": row_id, "provinsi": prov, "periode": per, "share_nasional_pct": body.share_nasional_pct, "tersedia": True})
    payload.setdefault("metadata", {}).update({"periode_tersedia": sorted({e["periode"] for e in payload["data"]}), "last_updated": _today()})
    ce.save_share_provinsi(payload)
    return _ok({"row_id": row_id, "provinsi": prov, "periode": per, "share_nasional_pct": body.share_nasional_pct})


@router.put("/asperssi/share-provinsi/{row_id}")
def sp_update_row(
    row_id: str,
    body: UpdateSpRowBody,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    if not (0 <= body.share_nasional_pct <= 100):
        raise HTTPException(400, "share_nasional_pct harus antara 0–100")
    payload = _load_sp_with_ids()
    for entry in payload.get("data", []):
        if entry.get("row_id") == row_id:
            entry["share_nasional_pct"] = body.share_nasional_pct
            payload.setdefault("metadata", {})["last_updated"] = _today()
            ce.save_share_provinsi(payload)
            return _ok({"row_id": row_id, "provinsi": entry["provinsi"], "periode": entry["periode"], "share_nasional_pct": body.share_nasional_pct})
    raise HTTPException(404, f"Row {row_id} tidak ditemukan")


@router.delete("/asperssi/share-provinsi/{row_id}")
def sp_delete_row(
    row_id: str,
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    payload = _load_sp_with_ids()
    data = payload.get("data", [])
    for i, entry in enumerate(data):
        if entry.get("row_id") == row_id:
            data.pop(i)
            payload.setdefault("metadata", {})["last_updated"] = _today()
            ce.save_share_provinsi(payload)
            return _ok({"deleted_row_id": row_id})
    raise HTTPException(404, f"Row {row_id} tidak ditemukan")


# ── Market Share Momentum (dua tier — lihat docstring MarketShareMomentum
# di models.py: kabupaten = internal brand mix, provinsi = true market share
# kalau ASPERSSI tersedia, fallback ke brand mix kalau tidak) ────────────────

def _msm_to_dict(row: MarketShareMomentum) -> dict:
    is_true_ms = bool(row.asperssi_available)
    return {
        "id": row.id, "kabupaten": row.kabupaten, "provinsi": row.provinsi,
        "granularity": row.granularity, "periode": row.periode,
        "internal_volume_elang": row.internal_volume_elang, "internal_volume_badak": row.internal_volume_badak,
        "internal_volume_banteng": row.internal_volume_banteng, "internal_volume_total": row.internal_volume_total,
        "brand_mix_elang_pct": row.brand_mix_elang_pct, "brand_mix_badak_pct": row.brand_mix_badak_pct,
        "brand_mix_banteng_pct": row.brand_mix_banteng_pct,
        "brandmix_momentum_elang": row.brandmix_momentum_elang, "brandmix_momentum_banteng": row.brandmix_momentum_banteng,
        "brandmix_label": row.brandmix_label,
        "asperssi_available": is_true_ms,
        "total_market_volume": row.total_market_volume,
        "ms_elang_pct": row.ms_elang_pct, "ms_badak_pct": row.ms_badak_pct,
        "ms_banteng_pct": row.ms_banteng_pct, "ms_kompetitor_pct": row.ms_kompetitor_pct,
        "ms_momentum_elang": row.ms_momentum_elang, "ms_momentum_banteng": row.ms_momentum_banteng,
        "ms_momentum_kompetitor": row.ms_momentum_kompetitor, "ms_label": row.ms_label,
        "loss_attribution_internal_pct": row.loss_attribution_internal_pct,
        "loss_attribution_external_pct": row.loss_attribution_external_pct,
        "primary_threat_source": row.primary_threat_source,
        "metric_type": "true_market_share" if is_true_ms else "internal_brand_mix",
        "metric_label": "Market Share" if is_true_ms else "Brand Mix Internal",
        "computed_at": row.computed_at,
    }


def _effective_momentum_elang(row: MarketShareMomentum) -> float:
    """Pilih sinyal terbaik yang tersedia untuk ranking — true MS kalau ada,
    fallback brand mix kalau tidak (dipakai HANYA utk sorting worst/best,
    bukan ditampilkan sebagai field baru)."""
    if row.asperssi_available and row.ms_momentum_elang is not None:
        return row.ms_momentum_elang
    return row.brandmix_momentum_elang or 0.0


def _insight_text(row: MarketShareMomentum) -> str:
    if not row.asperssi_available or row.primary_threat_source in (None, "none"):
        return f"{row.provinsi} ({row.periode}): True market share Elang {row.ms_elang_pct}%, momentum {row.ms_momentum_elang:+.1f}pp — tidak ada penurunan signifikan untuk diatribusi."
    arah = "kanibalisasi Banteng internal" if row.primary_threat_source == "internal_banteng" else (
        "tekanan kompetitor eksternal" if row.primary_threat_source == "external_competitor" else "kombinasi Banteng internal dan kompetitor eksternal"
    )
    return (
        f"Di {row.provinsi} ({row.periode}), penurunan Elang {abs(row.ms_momentum_elang):.1f}pp didominasi {arah} "
        f"(internal {row.loss_attribution_internal_pct}% vs eksternal {row.loss_attribution_external_pct}%)."
    )


@router.post("/momentum/refresh")
def momentum_refresh() -> dict:
    """Trigger manual compute_market_share_momentum() — belum ada scheduler/
    startup hook di scope turn ini, jadi endpoint ini SATU-SATUNYA cara
    mengisi tabel selain memanggil analyzer langsung dari skrip/shell."""
    db = SessionLocal()
    try:
        analyzer = CompetitorAnalyzer(db)
        result = analyzer.compute_market_share_momentum()
        return _ok(result)
    finally:
        db.close()


@router.get("/momentum")
def momentum_list(
    granularity: str = "all", provinsi: str = "", kabupaten: str = "",
    periode: str = "", label: str = "", asperssi_only: bool = False,
) -> dict:
    db = SessionLocal()
    try:
        q = db.query(MarketShareMomentum)
        if granularity in ("kabupaten", "provinsi"):
            q = q.filter(MarketShareMomentum.granularity == granularity)
        if provinsi:
            q = q.filter(MarketShareMomentum.provinsi == provinsi.strip().upper())
        if kabupaten:
            q = q.filter(MarketShareMomentum.kabupaten == kabupaten.strip().upper())
        if periode:
            q = q.filter(MarketShareMomentum.periode == periode.strip())
        if asperssi_only:
            q = q.filter(MarketShareMomentum.asperssi_available == 1)
        rows = q.all()
        if label:
            rows = [r for r in rows if (r.ms_label or r.brandmix_label) == label]
        rows.sort(key=lambda r: (r.periode, -_effective_momentum_elang(r)), reverse=True)
        return _ok([_msm_to_dict(r) for r in rows])
    finally:
        db.close()


@router.get("/momentum/summary")
def momentum_summary() -> dict:
    db = SessionLocal()
    try:
        all_rows = db.query(MarketShareMomentum).all()
        kab_rows = [r for r in all_rows if r.granularity == "kabupaten"]
        prov_rows = [r for r in all_rows if r.granularity == "provinsi"]

        def _latest_per_area(rows: list[MarketShareMomentum], area_attr: str) -> list[MarketShareMomentum]:
            latest: dict[str, MarketShareMomentum] = {}
            for r in rows:
                key = getattr(r, area_attr)
                if key not in latest or r.periode > latest[key].periode:
                    latest[key] = r
            return list(latest.values())

        kab_latest = _latest_per_area(kab_rows, "kabupaten")
        prov_latest = _latest_per_area(prov_rows, "provinsi")

        def _by_label(rows: list[MarketShareMomentum], label_attr: str = "brandmix_label") -> dict:
            d: dict[str, int] = {}
            for r in rows:
                lbl = getattr(r, label_attr) or "stable"
                d[lbl] = d.get(lbl, 0) + 1
            return d

        kab_sorted_worst = sorted(kab_latest, key=lambda r: r.brandmix_momentum_elang or 0)
        prov_sorted_worst = sorted(prov_latest, key=_effective_momentum_elang)

        # PENTING: ASPERSSI lag dari transaksi internal (periode terbaru
        # transaksi SERING tidak punya ASPERSSI yang sepadan — upload manual,
        # bukan real-time) — "latest periode per provinsi" (prov_latest) BISA
        # JADI bulan yang asperssi_available=0 walau provinsi itu PUNYA data
        # true MS di bulan lebih lama. Dihitung terpisah: latest periode
        # ASPERSSI-available PER provinsi, bukan dari prov_latest.
        true_ms_candidates = [r for r in prov_rows if r.asperssi_available]
        true_ms_latest = _latest_per_area(true_ms_candidates, "provinsi")
        provinces_with_true_ms = {r.provinsi for r in true_ms_candidates}

        return _ok({
            "kabupaten_summary": {
                "total_areas": len(kab_latest),
                "metric_type": "internal_brand_mix",
                "by_label": _by_label(kab_latest),
                "worst_kabupaten": [_msm_to_dict(r) for r in kab_sorted_worst[:5]],
                "best_kabupaten": [_msm_to_dict(r) for r in list(reversed(kab_sorted_worst))[:5]],
            },
            "provinsi_summary": {
                "total_provinsi": len(prov_latest),
                "with_true_market_share": len(provinces_with_true_ms),
                "fallback_brand_mix_only": len(prov_latest) - len(provinces_with_true_ms),
                "by_label": _by_label(prov_latest),
                "worst_provinsi": [_msm_to_dict(r) for r in prov_sorted_worst[:5]],
                "best_provinsi": [_msm_to_dict(r) for r in list(reversed(prov_sorted_worst))[:5]],
            },
            "true_ms_insights": [
                {
                    "provinsi": r.provinsi, "periode": r.periode,
                    "ms_elang_pct": r.ms_elang_pct, "ms_momentum_elang": r.ms_momentum_elang,
                    "primary_threat_source": r.primary_threat_source,
                    "loss_attribution_internal_pct": r.loss_attribution_internal_pct,
                    "loss_attribution_external_pct": r.loss_attribution_external_pct,
                    "insight_text": _insight_text(r),
                }
                for r in true_ms_latest
            ],
        })
    finally:
        db.close()


@router.get("/momentum/provinsi/{provinsi}")
def momentum_provinsi_detail(provinsi: str) -> dict:
    db = SessionLocal()
    try:
        prov = provinsi.strip().upper()
        prov_rows = db.query(MarketShareMomentum).filter(
            MarketShareMomentum.granularity == "provinsi", MarketShareMomentum.provinsi == prov,
        ).order_by(MarketShareMomentum.periode).all()
        if not prov_rows:
            raise HTTPException(404, f"Tidak ada data momentum untuk provinsi '{provinsi}'")

        latest_periode = prov_rows[-1].periode
        kab_rows = db.query(MarketShareMomentum).filter(
            MarketShareMomentum.granularity == "kabupaten", MarketShareMomentum.provinsi == prov,
            MarketShareMomentum.periode == latest_periode,
        ).order_by(MarketShareMomentum.kabupaten).all()

        true_ms_rows = [r for r in prov_rows if r.asperssi_available]

        return _ok({
            "provinsi": prov,
            "brand_mix_trend": [
                {"periode": r.periode, "elang_pct": r.brand_mix_elang_pct, "badak_pct": r.brand_mix_badak_pct,
                 "banteng_pct": r.brand_mix_banteng_pct, "momentum_elang": r.brandmix_momentum_elang}
                for r in prov_rows
            ],
            "true_market_share_trend": [
                {"periode": r.periode, "ms_elang_pct": r.ms_elang_pct, "ms_badak_pct": r.ms_badak_pct,
                 "ms_banteng_pct": r.ms_banteng_pct, "ms_kompetitor_pct": r.ms_kompetitor_pct,
                 "momentum_elang": r.ms_momentum_elang, "primary_threat_source": r.primary_threat_source}
                for r in true_ms_rows
            ],
            "loss_attribution_history": [
                {"periode": r.periode, "internal_pct": r.loss_attribution_internal_pct,
                 "external_pct": r.loss_attribution_external_pct, "primary_threat_source": r.primary_threat_source}
                for r in true_ms_rows if r.primary_threat_source not in (None, "none")
            ],
            "kabupaten_breakdown": [_msm_to_dict(r) for r in kab_rows],
            "latest_periode": latest_periode,
        })
    finally:
        db.close()


# ── CPI — Competitive Pressure Index ─────────────────────────────────────────

def _cpi_to_dict(r: CompetitivePressureIndex) -> dict:
    return {
        "id_toko": r.id_toko, "nama_toko": r.nama_toko,
        "kabupaten": r.kabupaten, "provinsi": r.provinsi, "periode": r.periode,
        "cpi_score": r.cpi_score, "cpi_label": r.cpi_label,
        "score_fbsi": r.score_fbsi, "score_volume_trend": r.score_volume_trend,
        "score_he": r.score_he, "score_crs": r.score_crs,
        "fbsi_latest": r.fbsi_latest, "delta_fbsi": r.delta_fbsi,
        "delta_he_pct": r.delta_he_pct, "crs_raw": r.crs_raw,
        "elang_vol_cur": r.elang_vol_cur, "elang_vol_prev": r.elang_vol_prev,
        "elang_vol_pct": r.elang_vol_pct, "alert_level": r.alert_level,
        "computed_at": r.computed_at,
    }


@router.get("/cpi/summary")
def cpi_summary() -> dict:
    db = SessionLocal()
    try:
        from sqlalchemy import func as sql_func
        latest = db.query(sql_func.max(CompetitivePressureIndex.periode)).scalar()
        if not latest:
            return _ok({"periode": None, "total_stores": 0, "by_label": {}, "critical_stores": [], "high_stores": []})

        rows = db.query(CompetitivePressureIndex).filter(
            CompetitivePressureIndex.periode == latest,
        ).order_by(CompetitivePressureIndex.cpi_score.desc()).all()

        by_label: dict[str, int] = {}
        for r in rows:
            by_label[r.cpi_label or "low"] = by_label.get(r.cpi_label or "low", 0) + 1

        critical = [r for r in rows if r.cpi_label == "critical"]
        high     = [r for r in rows if r.cpi_label == "high"]

        return _ok({
            "periode": latest,
            "total_stores": len(rows),
            "by_label": by_label,
            "avg_cpi": round(sum(r.cpi_score or 0 for r in rows) / len(rows), 2) if rows else 0,
            "critical_stores": [_cpi_to_dict(r) for r in critical[:10]],
            "high_stores": [_cpi_to_dict(r) for r in high[:10]],
        })
    finally:
        db.close()


@router.get("/cpi/kabupaten/{kabupaten}")
def cpi_kabupaten(kabupaten: str) -> dict:
    db = SessionLocal()
    try:
        from sqlalchemy import func as sql_func
        latest = db.query(sql_func.max(CompetitivePressureIndex.periode)).scalar()
        kab = kabupaten.strip().upper()
        rows = db.query(CompetitivePressureIndex).filter(
            CompetitivePressureIndex.kabupaten == kab,
            CompetitivePressureIndex.periode == latest,
        ).order_by(CompetitivePressureIndex.cpi_score.desc()).all()

        if not rows:
            raise HTTPException(404, f"Tidak ada data CPI untuk kabupaten '{kabupaten}'")

        return _ok({
            "kabupaten": kab, "periode": latest,
            "stores": [_cpi_to_dict(r) for r in rows],
            "avg_cpi": round(sum(r.cpi_score or 0 for r in rows) / len(rows), 2),
            "by_label": {lbl: sum(1 for r in rows if r.cpi_label == lbl) for lbl in ("critical","high","medium","low")},
        })
    finally:
        db.close()


@router.get("/cpi/toko/{id_toko}")
def cpi_toko(id_toko: str) -> dict:
    db = SessionLocal()
    try:
        rows = db.query(CompetitivePressureIndex).filter(
            CompetitivePressureIndex.id_toko == id_toko,
        ).order_by(CompetitivePressureIndex.periode.desc()).limit(12).all()

        if not rows:
            raise HTTPException(404, f"Tidak ada data CPI untuk toko '{id_toko}'")

        return _ok({
            "id_toko": id_toko,
            "nama_toko": rows[0].nama_toko,
            "history": [_cpi_to_dict(r) for r in reversed(rows)],
        })
    finally:
        db.close()


# ── Win/Loss ──────────────────────────────────────────────────────────────────

def _wl_to_dict(r: WinLossRecord) -> dict:
    return {
        "id_toko": r.id_toko, "nama_toko": r.nama_toko,
        "kabupaten": r.kabupaten, "provinsi": r.provinsi, "periode": r.periode,
        "outcome": r.outcome, "outcome_detail": r.outcome_detail, "primary_factor": r.primary_factor,
        "elang_vol_cur": r.elang_vol_cur, "elang_vol_prev": r.elang_vol_prev,
        "elang_vol_pct": r.elang_vol_pct,
        "banteng_fbsi_cur": r.banteng_fbsi_cur, "banteng_fbsi_delta": r.banteng_fbsi_delta,
        "computed_at": r.computed_at,
    }


@router.get("/win-loss/summary")
def win_loss_summary() -> dict:
    db = SessionLocal()
    try:
        from sqlalchemy import func as sql_func
        latest = db.query(sql_func.max(WinLossRecord.periode)).scalar()
        if not latest:
            return _ok({"periode": None, "total": 0, "by_outcome": {}})

        rows = db.query(WinLossRecord).filter(WinLossRecord.periode == latest).all()
        by_outcome: dict[str, int] = {}
        for r in rows:
            by_outcome[r.outcome] = by_outcome.get(r.outcome, 0) + 1

        wins  = [r for r in rows if r.outcome == "win"]
        losses = [r for r in rows if r.outcome == "loss"]

        return _ok({
            "periode": latest, "total": len(rows), "by_outcome": by_outcome,
            "win_rate_pct": round(len(wins) / len(rows) * 100, 1) if rows else 0,
            "top_wins": [_wl_to_dict(r) for r in sorted(wins, key=lambda x: x.elang_vol_pct or 0, reverse=True)[:10]],
            "top_losses": [_wl_to_dict(r) for r in sorted(losses, key=lambda x: x.elang_vol_pct or 0)[:10]],
        })
    finally:
        db.close()


@router.get("/win-loss/kabupaten/{kabupaten}")
def win_loss_kabupaten(kabupaten: str) -> dict:
    db = SessionLocal()
    try:
        from sqlalchemy import func as sql_func
        latest = db.query(sql_func.max(WinLossRecord.periode)).scalar()
        kab = kabupaten.strip().upper()
        rows = db.query(WinLossRecord).filter(
            WinLossRecord.kabupaten == kab, WinLossRecord.periode == latest,
        ).order_by(WinLossRecord.elang_vol_pct).all()

        if not rows:
            raise HTTPException(404, f"Tidak ada data Win/Loss untuk kabupaten '{kabupaten}'")

        by_outcome = {}
        for r in rows:
            by_outcome[r.outcome] = by_outcome.get(r.outcome, 0) + 1

        return _ok({
            "kabupaten": kab, "periode": latest,
            "by_outcome": by_outcome,
            "stores": [_wl_to_dict(r) for r in rows],
        })
    finally:
        db.close()


# ── Early Warning ─────────────────────────────────────────────────────────────

def _ewa_to_dict(r: EarlyWarningAlert) -> dict:
    return {
        "id": r.id, "scope": r.scope, "scope_id": r.scope_id, "scope_name": r.scope_name,
        "provinsi": r.provinsi, "periode": r.periode,
        "alert_type": r.alert_type, "severity": r.severity,
        "title": r.title, "description": r.description,
        "metric_value": r.metric_value, "metric_threshold": r.metric_threshold,
        "metric_label": r.metric_label, "is_active": r.is_active,
        "triggered_at": r.triggered_at,
    }


@router.get("/early-warning/active")
def early_warning_active(provinsi: str | None = None, scope: str | None = None) -> dict:
    db = SessionLocal()
    try:
        q = db.query(EarlyWarningAlert).filter(EarlyWarningAlert.is_active == 1)
        if provinsi:
            q = q.filter(EarlyWarningAlert.provinsi == provinsi.strip().upper())
        if scope:
            q = q.filter(EarlyWarningAlert.scope == scope)
        rows = q.order_by(EarlyWarningAlert.triggered_at.desc()).all()

        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        rows.sort(key=lambda r: (severity_order.get(r.severity, 9), r.triggered_at or ""))

        by_severity: dict[str, int] = {}
        for r in rows:
            by_severity[r.severity] = by_severity.get(r.severity, 0) + 1

        return _ok({
            "total_active": len(rows),
            "by_severity": by_severity,
            "alerts": [_ewa_to_dict(r) for r in rows],
        })
    finally:
        db.close()


@router.get("/early-warning/history")
def early_warning_history(provinsi: str | None = None, limit: int = 50) -> dict:
    db = SessionLocal()
    try:
        q = db.query(EarlyWarningAlert)
        if provinsi:
            q = q.filter(EarlyWarningAlert.provinsi == provinsi.strip().upper())
        rows = q.order_by(EarlyWarningAlert.triggered_at.desc()).limit(min(limit, 200)).all()
        return _ok({"total": len(rows), "alerts": [_ewa_to_dict(r) for r in rows]})
    finally:
        db.close()


# ── Counter-Strategy ──────────────────────────────────────────────────────────

def _csr_to_dict(r: CounterStrategyResult) -> dict:
    return {
        "id": r.id, "scope": r.scope, "scope_id": r.scope_id,
        "provinsi": r.provinsi, "periode": r.periode,
        "strategy_type": r.strategy_type, "priority": r.priority,
        "trigger_cpi_avg": r.trigger_cpi_avg,
        "trigger_ms_elang_trend": r.trigger_ms_elang_trend,
        "trigger_primary_threat": r.trigger_primary_threat,
        "n_stores_critical": r.n_stores_critical, "n_stores_high": r.n_stores_high,
        "n_stores_win": r.n_stores_win, "n_stores_loss": r.n_stores_loss,
        "recommended_actions": r.recommended_actions,
        "target_metrics": r.target_metrics,
        "ilp_suggestion": r.ilp_suggestion,
        "computed_at": r.computed_at,
    }


@router.get("/counter-strategy/summary")
def counter_strategy_summary() -> dict:
    db = SessionLocal()
    try:
        from sqlalchemy import func as sql_func
        latest = db.query(sql_func.max(CounterStrategyResult.periode)).scalar()
        if not latest:
            return _ok({"periode": None, "total_areas": 0, "by_strategy": {}, "urgent_areas": []})

        rows = db.query(CounterStrategyResult).filter(
            CounterStrategyResult.periode == latest,
            CounterStrategyResult.scope == "kabupaten",
        ).all()

        by_strategy: dict[str, int] = {}
        by_priority: dict[str, int] = {}
        for r in rows:
            by_strategy[r.strategy_type] = by_strategy.get(r.strategy_type, 0) + 1
            by_priority[r.priority] = by_priority.get(r.priority, 0) + 1

        priority_order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
        urgent = sorted(
            [r for r in rows if r.priority in ("urgent", "high")],
            key=lambda r: (priority_order.get(r.priority, 9), -(r.trigger_cpi_avg or 0)),
        )

        return _ok({
            "periode": latest, "total_areas": len(rows),
            "by_strategy": by_strategy, "by_priority": by_priority,
            "urgent_areas": [_csr_to_dict(r) for r in urgent[:10]],
        })
    finally:
        db.close()


@router.get("/counter-strategy/kabupaten/{kabupaten}")
def counter_strategy_kabupaten(kabupaten: str) -> dict:
    db = SessionLocal()
    try:
        kab = kabupaten.strip().upper()
        rows = db.query(CounterStrategyResult).filter(
            CounterStrategyResult.scope == "kabupaten",
            CounterStrategyResult.scope_id == kab,
        ).order_by(CounterStrategyResult.periode.desc()).limit(6).all()

        if not rows:
            raise HTTPException(404, f"Tidak ada strategi untuk kabupaten '{kabupaten}'")

        return _ok({"kabupaten": kab, "strategies": [_csr_to_dict(r) for r in rows]})
    finally:
        db.close()


# ── Manual Refresh ────────────────────────────────────────────────────────────

@router.post("/refresh")
def manual_refresh(current_user: dict = Depends(get_current_admin_user)) -> dict:
    """Trigger full competitor analysis — admin only."""
    db = SessionLocal()
    try:
        analyzer = CompetitorAnalyzer(db)
        result = analyzer.run_full_analysis()
        return _ok(result)
    finally:
        db.close()


# ── Forecast endpoints ────────────────────────────────────────────────────────

@router.get("/forecast/threat")
def forecast_threat() -> dict:
    """Provinsi dengan tren elang yang memburuk — dari cache forecast."""
    from api.core.competitor_forecast_loader import CompetitorForecastLoader
    cache = CompetitorForecastLoader.load()
    if not cache["meta"].get("available"):
        return _ok({"available": False, "threats": [], "message": "Jalankan scripts/competitor_forecast.py untuk generate cache"})
    return _ok({
        "available": True,
        "meta": cache["meta"],
        "threats": cache.get("threat_summary", []),
    })


@router.get("/forecast/threat/summary")
def forecast_threat_summary() -> dict:
    """Overview forecast — total areas, by_trend_label."""
    from api.core.competitor_forecast_loader import CompetitorForecastLoader
    cache = CompetitorForecastLoader.load()
    if not cache["meta"].get("available"):
        return _ok({"available": False})

    kab = cache.get("kabupaten_forecasts", [])
    prov = cache.get("provinsi_forecasts", [])

    by_trend: dict[str, int] = {}
    for item in kab + prov:
        t = item.get("trend_elang", "stable")
        by_trend[t] = by_trend.get(t, 0) + 1

    return _ok({
        "available": True,
        "meta": cache["meta"],
        "total_kabupaten": len(kab),
        "total_provinsi": len(prov),
        "by_trend_label": by_trend,
        "threat_count": len(cache.get("threat_summary", [])),
        "at_risk_count": len(cache.get("at_risk_areas", [])),
        "expansion_count": len(cache.get("expansion_candidates", [])),
    })


@router.get("/forecast/expansion")
def forecast_expansion() -> dict:
    """Kabupaten/provinsi dengan potensi pertumbuhan Elang."""
    from api.core.competitor_forecast_loader import CompetitorForecastLoader
    cache = CompetitorForecastLoader.load()
    if not cache["meta"].get("available"):
        return _ok({"available": False, "candidates": []})
    return _ok({
        "available": True,
        "meta": cache["meta"],
        "candidates": cache.get("expansion_candidates", []),
    })


@router.get("/predict/marketshare/provinsi")
def predict_marketshare_provinsi(
    provinsi: str,
    n_months_ahead: int = 3,
) -> dict:
    """
    Prediksi market share internal brand (Elang + Badak) per bulan
    untuk provinsi tertentu, diturunkan dari data transaksi parquet.
    """
    from api.core.prediction_engine import predict_series

    df = get_data().copy()
    prov_upper = provinsi.strip().upper()
    prov_col = next((c for c in df.columns if "provinsi" in c.lower()), None)
    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if prov_col is None or brand_col is None:
        return _ok({"available": False, "message": "Kolom tidak ditemukan"})

    df_prov = df[df[prov_col].str.upper() == prov_upper].copy()
    if df_prov.empty:
        return _ok({"available": False, "message": f"Tidak ada data untuk {provinsi}"})

    INTERNAL = {"SEMEN ELANG", "SEMEN BADAK"}
    df_prov["_p"] = df_prov["Tanggal Transaksi"].dt.to_period("M").astype(str)
    df_prov["_is_internal"] = df_prov[brand_col].str.upper().isin(INTERNAL)

    grp = (
        df_prov.groupby("_p")
        .agg(
            total_ton=("TON Quantity", "sum"),
            internal_ton=("TON Quantity", lambda x: x[df_prov.loc[x.index, "_is_internal"]].sum()),
        )
        .reset_index()
    )
    grp["value"] = (grp["internal_ton"] / grp["total_ton"].clip(lower=0.001) * 100).round(2)
    historical = grp[["_p", "value"]].rename(columns={"_p": "periode"}).sort_values("periode").to_dict("records")

    key_safe = prov_upper.replace(" ", "_").replace("/", "_")
    result = predict_series(
        historical      = historical,
        n_ahead         = n_months_ahead,
        cache_key       = f"comp_ms_prov_{key_safe}",
        cache_ttl_hours = 6,
    )

    current_ms = float(grp["value"].iloc[-1]) if not grp.empty else 0.0
    last_pred  = result["predictions"][-1]["value"] if result.get("predictions") else current_ms

    return _ok({
        "provinsi":          provinsi,
        "available":         True,
        "current_ms_pct":    round(current_ms, 2),
        "projected_ms_pct":  round(last_pred, 2),
        "trend_direction":   result.get("trend_direction"),
        "trend_pct":         result.get("trend_pct"),
        "method":            result.get("method"),
        "n_historical":      result.get("n_historical"),
        "historical":        historical,
        "predictions":       result.get("predictions", []),
    })


@router.get("/forecast/at-risk")
def forecast_at_risk(provinsi: str | None = None) -> dict:
    """Area yang diprediksi mengalami penurunan share Elang."""
    from api.core.competitor_forecast_loader import CompetitorForecastLoader
    cache = CompetitorForecastLoader.load()
    if not cache["meta"].get("available"):
        return _ok({"available": False, "areas": []})

    areas = cache.get("at_risk_areas", [])
    if provinsi:
        prov_upper = provinsi.strip().upper()
        areas = [a for a in areas if (a.get("provinsi") or "").upper() == prov_upper]

    return _ok({
        "available": True,
        "meta": cache["meta"],
        "total": len(areas),
        "areas": areas,
    })

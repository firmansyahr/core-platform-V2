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
from api.core.data_loader import get_data

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
    provinsi:         str
    periode:          str
    nama_brand:       str
    market_share_pct: float
    is_own_brand:     bool = False


class UpdateMsRowBody(BaseModel):
    market_share_pct: float
    is_own_brand:     bool


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
    result  = ie.generate_competitor_insight(tri, ranking)
    return _ok(result)


# ── Coverage ──────────────────────────────────────────────────────────────────

@router.get("/coverage")
def coverage() -> dict:
    return _ok(ce.get_asperssi_coverage())


# ── Triangulation ─────────────────────────────────────────────────────────────

@router.get("/triangulation")
def triangulation() -> dict:
    store_crs = _get_crs_by_provinsi()
    if store_crs.empty:
        raise HTTPException(503, "Data AEGIS tidak tersedia")
    sp  = ce.load_share_provinsi()
    ms  = ce.load_marketshare_brand()
    res = ce.triangulate_aegis_with_asperssi(store_crs, sp, ms)
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
        else:
            entry["brands"].append({
                "nama":             brand,
                "market_share_pct": ms,
                "is_own_brand":     is_own,
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
                "row_id":           brand["row_id"],
                "provinsi":         entry["provinsi"],
                "periode":          entry["periode"],
                "nama_brand":       brand["nama"],
                "market_share_pct": brand["market_share_pct"],
                "is_own_brand":     brand.get("is_own_brand", False),
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
    row_id    = f"MS-{int(time.time() * 1000)}-0"
    new_brand = {"row_id": row_id, "nama": brand, "market_share_pct": body.market_share_pct, "is_own_brand": body.is_own_brand}
    existing_entry = next((e for e in payload.get("data", []) if e["provinsi"] == prov and e["periode"] == per), None)
    if existing_entry:
        existing_entry["brands"].append(new_brand)
    else:
        payload.setdefault("data", []).append({"provinsi": prov, "periode": per, "brands": [new_brand], "tersedia": True})
    payload.setdefault("metadata", {}).update({"periode_tersedia": sorted({e["periode"] for e in payload["data"]}), "last_updated": _today()})
    ce.save_marketshare_brand(payload)
    return _ok({"row_id": row_id, "provinsi": prov, "periode": per, "nama_brand": brand, "market_share_pct": body.market_share_pct, "is_own_brand": body.is_own_brand})


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
                payload.setdefault("metadata", {})["last_updated"] = _today()
                ce.save_marketshare_brand(payload)
                return _ok({"row_id": row_id, "provinsi": entry["provinsi"], "periode": entry["periode"], "nama_brand": brand["nama"], "market_share_pct": body.market_share_pct, "is_own_brand": body.is_own_brand})
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

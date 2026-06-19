"""Competitor Intelligence API routes."""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from api.core import competitor_engine as ce
from api.core import cad_storage
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

@router.get("/overview")
def overview() -> dict:
    store_crs = _get_crs_by_provinsi()
    sp        = ce.load_share_provinsi()
    ms        = ce.load_marketshare_brand()
    cov       = ce.get_asperssi_coverage()

    tri: list[dict] = []
    if not store_crs.empty:
        tri = ce.triangulate_aegis_with_asperssi(store_crs, sp, ms)

    # Summary counts
    tri_summary = {
        "konfirmasi_kompetitor": sum(1 for t in tri if t["verdict"] == "KONFIRMASI_KOMPETITOR"),
        "waspada_awal":          sum(1 for t in tri if t["verdict"] == "WASPADA_AWAL"),
        "internal_seasonal":     sum(1 for t in tri if t["verdict"] == "INTERNAL_ATAU_SEASONAL"),
        "tidak_cukup_data":      sum(1 for t in tri if t["verdict"] == "TIDAK_CUKUP_DATA"),
        "normal":                sum(1 for t in tri if t["verdict"] == "NORMAL"),
    }

    top_threats = [
        t for t in tri
        if t["verdict"] in ("KONFIRMASI_KOMPETITOR", "WASPADA_AWAL")
    ][:3]

    ms_ranking  = ce.get_competitor_ranking(ms)
    records     = cad_storage.get_records(status="all", kabupaten="", limit=9999, offset=0)
    cad_intel   = ce.get_cad_intelligence(records)

    return _ok({
        "coverage":                   cov,
        "triangulation_summary":      tri_summary,
        "top_threats":                top_threats,
        "competitor_ranking_asperssi": ms_ranking[:5],
        "competitor_ranking_cad":      cad_intel["kompetitor_list"][:5],
        "data_disclaimer": [
            "Semua data ASPERSSI dalam persen — tidak tersedia volume absolut",
            "Share provinsi (Mar–Apr 2026) dan market share brand (Des 2025–Jan 2026) dari periode berbeda",
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

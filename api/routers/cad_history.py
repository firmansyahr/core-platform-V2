from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.core import cad_storage
from api.core.auth import get_current_admin_user, UserInfo
from api.core.aegis_engine import get_store_crs

router = APIRouter(prefix="/api/aegis", tags=["cad-history"])

_HASIL_ENUM  = {"KOMPETITOR_EKSTERNAL", "MASALAH_LOGISTIK", "MASALAH_STOK",
                "TIDAK_ADA_MASALAH", "LAINNYA"}
_STATUS_ENUM = {"OPEN", "IN_PROGRESS", "RESOLVED"}


class CADUpdateBody(BaseModel):
    tso_assigned:      Optional[str] = None
    tanggal_kunjungan: Optional[str] = None
    hasil_validasi:    Optional[str] = None
    catatan:           Optional[str] = None
    status_resolusi:   Optional[str] = None


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── GET endpoints (no auth — consistent with existing AEGIS endpoints) ─────────

@router.get("/cad-history")
def list_cad_history(
    status:    str = Query(default="all"),
    kabupaten: str = Query(default=""),
    limit:  int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0,  ge=0),
) -> dict[str, Any]:
    records, total = cad_storage.get_records(
        status=status if status != "all" else None,
        kabupaten=kabupaten or None,
        limit=limit,
        offset=offset,
    )
    return {
        "status": "ok",
        "data": records,
        "meta": {
            "generated_at": _ts(),
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    }


@router.get("/cad-history/summary")
def cad_history_summary() -> dict[str, Any]:
    return {
        "status": "ok",
        "data": cad_storage.get_summary(),
        "meta": {"generated_at": _ts()},
    }


@router.get("/tso-list")
def get_tso_list() -> dict[str, Any]:
    stores = get_store_crs()
    tsos   = sorted(stores["TSO"].dropna().unique().tolist())
    return {"status": "ok", "data": tsos}


# ── POST endpoints (admin only) ────────────────────────────────────────────────

@router.post("/cad-history/generate")
def generate_cad_history(
    _user: UserInfo = Depends(get_current_admin_user),
) -> dict[str, Any]:
    created, skipped = cad_storage.generate_from_cad_alerts()
    return {
        "status": "ok",
        "data": {"created": created, "skipped": skipped},
        "meta": {"generated_at": _ts()},
    }


@router.post("/cad-history/{rec_id}/update")
def update_cad_record(
    rec_id: str,
    body: CADUpdateBody,
    _user: UserInfo = Depends(get_current_admin_user),
) -> dict[str, Any]:
    if body.hasil_validasi and body.hasil_validasi not in _HASIL_ENUM:
        raise HTTPException(422, f"hasil_validasi tidak valid: {body.hasil_validasi}")
    if body.status_resolusi and body.status_resolusi not in _STATUS_ENUM:
        raise HTTPException(422, f"status_resolusi tidak valid: {body.status_resolusi}")

    record = cad_storage.update_record(rec_id, body.model_dump(exclude_none=True))
    if record is None:
        raise HTTPException(404, f"Record '{rec_id}' tidak ditemukan")

    return {"status": "ok", "data": record, "meta": {"generated_at": _ts()}}

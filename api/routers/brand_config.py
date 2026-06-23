"""Brand Configuration per wilayah (provinsi/kabupaten) untuk Loyalty Program."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.core.auth import UserInfo, get_current_admin_user
from api.core.brand_config_engine import DEFAULT_CONFIG, get_brand_config_for_toko
from api.core.data_loader import get_data
from api.database import SessionLocal
from api.models import BrandConfig

router = APIRouter(prefix="/api/brand-config", tags=["brand-config"])

# BrandConfig adalah tabel baru tanpa padanan JSON sebelumnya — mode non-SQLite
# tidak punya tempat untuk menyimpan apa pun, jadi GET cukup return default,
# dan endpoint tulis (POST/PUT/DELETE) ditolak dengan jelas (bukan no-op diam).
USE_SQLITE = os.getenv("USE_SQLITE_STORAGE", "false").lower() == "true"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ok(data: Any, **extra: Any) -> dict:
    return {"status": "ok", "data": data, "meta": {"generated_at": _now(), **extra}}


def _require_sqlite() -> None:
    if not USE_SQLITE:
        raise HTTPException(
            503,
            "Brand Configuration memerlukan USE_SQLITE_STORAGE=true — tidak ada "
            "mode fallback JSON untuk fitur ini.",
        )


def _row_to_dict(row: BrandConfig) -> dict:
    return {
        "id": row.id,
        "provinsi": row.provinsi,
        "kabupaten": row.kabupaten,
        "mb_brands": row.mb_brands,
        "cb_brands": row.cb_brands,
        "fb_brands": row.fb_brands,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _validate_brands(mb_brands: list[str], cb_brands: list[str]) -> None:
    # fb_brands tidak divalidasi minimalnya — boleh kosong, artinya FB tidak diikutkan.
    if len(mb_brands) != 1:
        raise HTTPException(400, "mb_brands harus berisi tepat SATU brand (Main Brand).")
    if len(cb_brands) < 1:
        raise HTTPException(400, "cb_brands harus berisi minimal SATU brand (Companion Brand).")


class BrandConfigCreateBody(BaseModel):
    provinsi: str | None = None
    kabupaten: str | None = None
    mb_brands: list[str]
    cb_brands: list[str]
    fb_brands: list[str] = []


class BrandConfigUpdateBody(BaseModel):
    mb_brands: list[str]
    cb_brands: list[str]
    fb_brands: list[str] = []


@router.get("")
def list_brand_configs(
    provinsi: str | None = Query(default=None),
    kabupaten: str | None = Query(default=None),
) -> dict:
    if not USE_SQLITE:
        return _ok([{**DEFAULT_CONFIG, "id": None, "provinsi": None, "kabupaten": None}], total=1)

    db = SessionLocal()
    try:
        q = db.query(BrandConfig)
        if provinsi is not None:
            q = q.filter(BrandConfig.provinsi == provinsi)
        if kabupaten is not None:
            q = q.filter(BrandConfig.kabupaten == kabupaten)
        rows = q.order_by(
            BrandConfig.provinsi.is_(None),
            BrandConfig.provinsi,
            BrandConfig.kabupaten.is_(None),
            BrandConfig.kabupaten,
        ).all()
        data = [_row_to_dict(r) for r in rows]
        return _ok(data, total=len(data))
    finally:
        db.close()


@router.get("/resolve")
def resolve_brand_config(
    provinsi: str = Query(...),
    kabupaten: str = Query(...),
) -> dict:
    if not USE_SQLITE:
        return _ok({**DEFAULT_CONFIG, "provinsi": provinsi, "kabupaten": kabupaten})

    db = SessionLocal()
    try:
        config = get_brand_config_for_toko(provinsi, kabupaten, db)
        return _ok(config)
    finally:
        db.close()


@router.get("/available-brands")
def get_available_brands() -> dict:
    df = get_data()
    if df is None or df.empty or "Brands" not in df.columns:
        return _ok({"brands": []})
    brands = sorted(df["Brands"].dropna().unique().tolist())
    return _ok({"brands": brands})


@router.post("", status_code=201)
def create_brand_config(
    body: BrandConfigCreateBody,
    _user: UserInfo = Depends(get_current_admin_user),
) -> dict:
    _require_sqlite()

    if body.kabupaten is not None and body.provinsi is None:
        raise HTTPException(400, "kabupaten tidak boleh diisi tanpa provinsi.")
    _validate_brands(body.mb_brands, body.cb_brands)

    db = SessionLocal()
    try:
        exists = db.query(BrandConfig).filter(
            BrandConfig.provinsi == body.provinsi,
            BrandConfig.kabupaten == body.kabupaten,
        ).first()
        if exists:
            raise HTTPException(
                409, f"Config untuk provinsi={body.provinsi!r} kabupaten={body.kabupaten!r} sudah ada."
            )

        row = BrandConfig(
            provinsi=body.provinsi,
            kabupaten=body.kabupaten,
            mb_brands=body.mb_brands,
            cb_brands=body.cb_brands,
            fb_brands=body.fb_brands,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _ok(_row_to_dict(row))
    finally:
        db.close()


@router.put("/{config_id}")
def update_brand_config(
    config_id: str,
    body: BrandConfigUpdateBody,
    _user: UserInfo = Depends(get_current_admin_user),
) -> dict:
    _require_sqlite()
    _validate_brands(body.mb_brands, body.cb_brands)

    db = SessionLocal()
    try:
        row = db.query(BrandConfig).filter(BrandConfig.id == config_id).first()
        if not row:
            raise HTTPException(404, f"Brand config {config_id!r} tidak ditemukan.")

        row.mb_brands = body.mb_brands
        row.cb_brands = body.cb_brands
        row.fb_brands = body.fb_brands
        db.commit()
        db.refresh(row)
        return _ok(_row_to_dict(row))
    finally:
        db.close()


@router.delete("/{config_id}")
def delete_brand_config(
    config_id: str,
    _user: UserInfo = Depends(get_current_admin_user),
) -> dict:
    _require_sqlite()

    db = SessionLocal()
    try:
        row = db.query(BrandConfig).filter(BrandConfig.id == config_id).first()
        if not row:
            raise HTTPException(404, f"Brand config {config_id!r} tidak ditemukan.")
        if row.provinsi is None and row.kabupaten is None:
            raise HTTPException(400, "Default global tidak bisa dihapus.")

        db.delete(row)
        db.commit()
        return _ok({"deleted_id": config_id})
    finally:
        db.close()

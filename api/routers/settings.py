import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.core.auth import UserInfo, get_current_admin_user
from api.core.data_loader import load_data, DATA_PATH
from api.core.aegis_engine import (
    FBSI_THRESHOLD,
    HE_THRESHOLD,
    FBSI_WINDOW,
    HE_WINDOW,
    CRS_KUNING,
    CRS_ORANYE,
    CRS_MERAH,
    get_store_crs,
)
from api.core.ilp_engine import get_ilp_features, get_ilp_hierarchy
from api.database import SessionLocal
from api.models import LoyaltyConfig

router = APIRouter(prefix="/api/settings", tags=["settings"])

_CONFIG_PATH = Path("api/data/loyalty_config.json")
_USE_SQLITE  = os.getenv("USE_SQLITE_STORAGE", "false").lower() == "true"


def _load_config() -> dict:
    if _USE_SQLITE:
        db = SessionLocal()
        try:
            row = db.query(LoyaltyConfig).filter_by(id="default").first()
            if row:
                return {
                    "default_point_value": row.default_point_value,
                    "brand_point_values":  row.brand_point_values or {},
                }
            return {"default_point_value": 5000, "brand_point_values": {}}
        finally:
            db.close()
    if not _CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_config(cfg: dict) -> None:
    if _USE_SQLITE:
        db = SessionLocal()
        try:
            row = db.query(LoyaltyConfig).filter_by(id="default").first()
            if row:
                row.default_point_value = cfg.get("default_point_value", 5000)
                row.brand_point_values  = cfg.get("brand_point_values", {})
                row.updated_at          = datetime.now(timezone.utc)
            else:
                row = LoyaltyConfig(
                    id                  = "default",
                    default_point_value = cfg.get("default_point_value", 5000),
                    brand_point_values  = cfg.get("brand_point_values", {}),
                )
                db.add(row)
            db.commit()
        finally:
            db.close()
        return
    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


class BrandPointValuesBody(BaseModel):
    brand_point_values: dict[str, int]


@router.get("")
def get_settings() -> dict[str, Any]:
    cache_info = load_data.cache_info()
    is_loaded = cache_info.currsize > 0

    data_source: dict[str, Any] = {
        "path": str(DATA_PATH),
        "file_exists": DATA_PATH.exists(),
        "is_loaded": is_loaded,
    }

    if is_loaded:
        df = load_data()
        date_col = df["Tanggal Transaksi"]
        data_source["rows"] = len(df)
        data_source["columns"] = len(df.columns)
        data_source["date_min"] = date_col.min().strftime("%b %Y")
        data_source["date_max"] = date_col.max().strftime("%b %Y")

    return {
        "status": "ok",
        "data": {
            "aegis": {
                "fbsi_threshold": FBSI_THRESHOLD,
                "he_threshold": HE_THRESHOLD,
                "fbsi_window": FBSI_WINDOW,
                "he_window": HE_WINDOW,
                "crs_kuning": CRS_KUNING,
                "crs_oranye": CRS_ORANYE,
                "crs_merah": CRS_MERAH,
            },
            "data_source": data_source,
        },
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
    }


@router.get("/brand-point-values")
def get_brand_point_values() -> dict[str, Any]:
    cfg = _load_config()
    bpv = cfg.get("brand_point_values", {"Semen Elang": 5000, "Semen Badak": 4000, "Semen Banteng": 0})
    return {
        "status": "ok",
        "data": {
            "brand_point_values": bpv,
            "default_point_value": cfg.get("default_point_value", 5000),
        },
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
    }


@router.put("/brand-point-values")
def update_brand_point_values(
    body: BrandPointValuesBody,
    _user: UserInfo = Depends(get_current_admin_user),
) -> dict[str, Any]:
    for brand, val in body.brand_point_values.items():
        if val < 0:
            raise HTTPException(400, f"Nilai poin untuk '{brand}' tidak boleh negatif")

    cfg = _load_config()
    cfg["brand_point_values"] = body.brand_point_values
    _save_config(cfg)

    return {
        "status": "ok",
        "data": {"brand_point_values": body.brand_point_values},
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
    }


@router.post("/reload")
def reload_data(_user: UserInfo = Depends(get_current_admin_user)) -> dict[str, Any]:
    load_data.cache_clear()
    get_store_crs.cache_clear()
    get_ilp_features.cache_clear()
    get_ilp_hierarchy.cache_clear()

    return {
        "status": "ok",
        "message": "Semua cache dibersihkan. Data akan dimuat ulang pada request berikutnya.",
        "meta": {"reloaded_at": datetime.now(timezone.utc).isoformat()},
    }

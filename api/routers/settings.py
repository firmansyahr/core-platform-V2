from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

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

router = APIRouter(prefix="/api/settings", tags=["settings"])


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

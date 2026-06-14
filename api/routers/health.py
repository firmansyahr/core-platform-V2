import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from api.core.aegis_engine import _XGB_CACHE
from api.core.data_loader import load_data

_START = time.time()
VERSION = "2.0.0"

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def get_health() -> dict[str, Any]:
    cache_info  = load_data.cache_info()
    data_loaded = cache_info.currsize > 0

    row_count   = 0
    periode     = ""
    if data_loaded:
        df        = load_data()
        row_count = len(df)
        d_min     = df["Tanggal Transaksi"].min().strftime("%Y-%m-%d")
        d_max     = df["Tanggal Transaksi"].max().strftime("%Y-%m-%d")
        periode   = f"{d_min} to {d_max}"

    return {
        "status":         "ok",
        "data_loaded":    data_loaded,
        "row_count":      row_count,
        "model_trained":  Path(_XGB_CACHE).exists(),
        "periode":        periode,
        "uptime_seconds": round(time.time() - _START, 1),
        "version":        VERSION,
        "meta":           {"generated_at": datetime.now(timezone.utc).isoformat()},
    }

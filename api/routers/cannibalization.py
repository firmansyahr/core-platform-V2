"""
Cannibalization detection endpoints (GMM-based).

  GET /api/cannibalization/train          — admin only; triggers GMM training
  GET /api/cannibalization/summary        — load cached result or auto-train
  GET /api/cannibalization/store/{id}     — per-store cluster status
"""
from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from api.core import cannibalization_engine as ce
from api.core.auth import get_current_admin_user
from api.core.data_loader import get_data

router = APIRouter(prefix="/api/cannibalization", tags=["cannibalization"])


def _ok(data: dict | list) -> dict:
    from datetime import datetime, timezone
    return {
        "status": "ok",
        "data": data,
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
    }


def _default_periode(df: pd.DataFrame) -> str:
    """Last day of latest month in dataset."""
    last = df["Tanggal Transaksi"].max()
    return last.strftime("%Y-%m-%d")


def _require_cached_or_train(df: pd.DataFrame) -> dict:
    """Return cached result, or auto-train if cache is missing."""
    result = ce.load_cached_result()
    if result is None:
        result = ce.train_cannibalization_gmm(df, _default_periode(df))
    if result.get("status") == "error":
        raise HTTPException(500, result.get("message", "Training failed"))
    return result


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/train")
def train(
    periode_akhir: str | None = Query(
        default=None,
        description="Format YYYY-MM-DD, default: last date in dataset",
    ),
    _user: dict = Depends(get_current_admin_user),
) -> dict:
    """Trigger (re)training of the GMM cannibalization model. Admin only."""
    df = get_data()
    if df is None or df.empty:
        raise HTTPException(503, "Data belum dimuat")

    p = periode_akhir or _default_periode(df)
    result = ce.train_cannibalization_gmm(df, p)

    if result.get("status") == "error":
        raise HTTPException(500, result.get("message", "Training failed"))

    # Return training metadata without the large store_assignments list
    summary = {k: v for k, v in result.items() if k != "store_assignments"}
    summary["total_toko_dianalisis"] = result["total_toko_dianalisis"]
    return _ok(summary)


@router.get("/summary")
def summary() -> dict:
    """Cluster distribution summary. Auto-trains on first call if cache absent."""
    df = get_data()
    if df is None or df.empty:
        raise HTTPException(503, "Data belum dimuat")

    result = _require_cached_or_train(df)
    return _ok(ce.get_all_stores_cannibalization_summary(result))


@router.get("/store/{id_toko}")
def store_status(id_toko: str) -> dict:
    """Per-store cannibalization cluster and probabilities."""
    df = get_data()
    if df is None or df.empty:
        raise HTTPException(503, "Data belum dimuat")

    result = _require_cached_or_train(df)
    status = ce.get_store_cannibalization_status(id_toko, result)

    if status.get("status") == "not_found":
        raise HTTPException(404, f"Toko '{id_toko}' tidak ditemukan dalam hasil GMM")

    return _ok(status)

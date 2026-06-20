"""
Causal ML endpoints.

  POST /api/causal/train           — train & cache (admin only, LOKAL SAJA — lihat Training Policy)
  GET  /api/causal/summary         — ATE + refutation + distribusi CATE
  GET  /api/causal/store/{id_toko} — CATE toko spesifik

── Training Policy ─────────────────────────────────────────────────────────────

Training (POST /train) HANYA dijalankan secara lokal/CLI dengan dataset penuh
(21.014 toko, data/transaksi_aegis_synthetic.parquet) untuk menghasilkan
estimasi yang robust. Production (Railway) menggunakan sample dataset
(5.248 toko, transaksi_sample_deploy.parquet) untuk efisiensi memory, yang
TIDAK CUKUP untuk causal training yang valid — hanya ~72 dari 300 toko
treated yang punya data lengkap di sample (vs 290/300 di dataset penuh).
Sample dataset TIDAK diselaraskan ke dataset penuh demi menjaga optimasi
memory Railway yang sudah dibangun untuk engine lain (AEGIS, ILP, dll).

Alur kerja:
  1. Jalankan training lokal: python api/scripts/train_causal_model.py
  2. Hasil tersimpan di api/data/models/causal_training_result.json
  3. Commit file cache ini ke git (di-exception dari .gitignore khusus
     untuk file ini — lihat .gitignore baris terkait api/data/models/)
  4. Production hanya READ dari cache via GET /summary dan GET /store/{id}
  5. Re-training dilakukan manual secara berkala (misal saat ada data
     transaksi baru atau loyalty_members baru), bukan otomatis dan bukan
     dari endpoint POST /train saat berjalan di Railway — endpoint itu
     diblokir (403) jika RAILWAY_ENVIRONMENT terdeteksi, persis pola yang
     dipakai GMM (training berat = offline, production = read-only cache).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from api.core import causal_engine as ce
from api.core.auth import get_current_admin_user
from api.core.data_loader import get_data

router = APIRouter(prefix="/api/causal", tags=["causal"])

_MEMBERS_PATH = Path("api/data/loyalty_members.json")


def _ok(data: dict | list) -> dict:
    return {
        "status": "ok",
        "data": data,
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
    }


def _load_members() -> list[dict]:
    if not _MEMBERS_PATH.exists():
        return []
    try:
        return json.loads(_MEMBERS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/train")
def train(
    _user: dict = Depends(get_current_admin_user),
):
    """
    Trigger training Causal ML model (DoWhy + EconML).
    Admin only. DIBLOKIR di Railway production — lihat Training Policy
    di docstring modul. Jalankan lokal via api/scripts/train_causal_model.py
    dengan dataset penuh, lalu commit hasil cache-nya.
    """
    if os.getenv("RAILWAY_ENVIRONMENT"):
        return JSONResponse(
            status_code=403,
            content={
                "status": "error",
                "message": (
                    "Training Causal ML tidak diizinkan di production "
                    "karena sample dataset (5.248 toko) menghasilkan "
                    "training yang tidak robust (~72 toko valid). "
                    "Training harus dilakukan secara lokal dengan dataset "
                    "penuh (21.014 toko), hasilnya di-cache dan di-deploy "
                    "sebagai file statis."
                ),
            },
        )

    df = get_data()
    if df is None or df.empty:
        raise HTTPException(503, "Data transaksi belum dimuat")

    members = _load_members()
    if not members:
        raise HTTPException(400, "Loyalty members tidak tersedia")

    result = ce.train_and_cache_causal_model(df, members)

    if result.get("status") == "error":
        raise HTTPException(422, result.get("message", "Training gagal"))

    # Kembalikan summary (tanpa per-toko detail yang besar)
    return _ok(ce.get_summary(result))


@router.get("/summary")
def summary() -> dict:
    """
    ATE keseluruhan, refutation test, distribusi CATE.
    Load dari cache; 404 jika belum ditraining.
    """
    result = ce.load_causal_results()
    if result is None:
        raise HTTPException(
            404,
            "Model belum ditraining. Jalankan POST /api/causal/train terlebih dahulu.",
        )
    return _ok(ce.get_summary(result))


@router.get("/store/{id_toko}")
def store_effect(id_toko: str) -> dict:
    """
    CATE (Conditional Average Treatment Effect) untuk satu toko.
    Load dari cache.
    """
    result = ce.load_causal_results()
    if result is None:
        raise HTTPException(
            404,
            "Model belum ditraining. Jalankan POST /api/causal/train terlebih dahulu.",
        )

    status = ce.get_store_causal_effect(id_toko, result)

    if status.get("status") == "not_found":
        raise HTTPException(
            404,
            f"Toko '{id_toko}' tidak ditemukan dalam hasil causal model. "
            "Toko mungkin tidak aktif pada periode analisis.",
        )
    if status.get("status") == "not_available":
        raise HTTPException(503, "Cache causal model tidak tersedia")

    return _ok(status)

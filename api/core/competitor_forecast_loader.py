"""
Loader untuk competitor_forecast_cache.json yang dihasilkan oleh
scripts/competitor_forecast.py (dijalankan di Google Colab / offline).

File cache berisi prediksi tren brand mix + market share 3-6 bulan ke depan
menggunakan Prophet (fallback LinearRegression) per area.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_CACHE_PATH = Path("api/data/competitor_forecast_cache.json")

_EMPTY: dict = {
    "meta": {
        "generated_at": None,
        "model": None,
        "horizon_months": 0,
        "areas_forecast": 0,
        "available": False,
    },
    "kabupaten_forecasts": [],
    "provinsi_forecasts": [],
    "threat_summary": [],
    "expansion_candidates": [],
    "at_risk_areas": [],
}


class CompetitorForecastLoader:
    _cache: dict | None = None

    @classmethod
    def load(cls) -> dict:
        if cls._cache is not None:
            return cls._cache

        if not _CACHE_PATH.exists():
            logger.info("[forecast_loader] Cache tidak ditemukan di %s — kembalikan empty", _CACHE_PATH)
            return _EMPTY

        try:
            raw = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
            raw.setdefault("meta", {})
            raw["meta"]["available"] = True
            cls._cache = raw
            logger.info(
                "[forecast_loader] Loaded forecast cache — %d kabupaten, %d provinsi, generated_at=%s",
                len(raw.get("kabupaten_forecasts", [])),
                len(raw.get("provinsi_forecasts", [])),
                raw["meta"].get("generated_at", "unknown"),
            )
            return cls._cache
        except Exception:
            logger.exception("[forecast_loader] Gagal baca cache forecast")
            return _EMPTY

    @classmethod
    def invalidate(cls) -> None:
        cls._cache = None

    @classmethod
    def is_available(cls) -> bool:
        return _CACHE_PATH.exists()

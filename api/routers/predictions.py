"""Prediction endpoints — AEGIS trend, volume at risk, home executive."""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Query

from api.core.aegis_engine import FBSI_THRESHOLD, CRS_KUNING
from api.core.data_loader import load_data
from api.core.prediction_engine import predict_series

router = APIRouter(tags=["predictions"])

_META = lambda: {"generated_at": datetime.now(timezone.utc).isoformat()}


# ── helpers ──────────────────────────────────────────────────────────────────


def _monthly_warning_series(df: pd.DataFrame) -> list[dict]:
    """
    Hitung jumlah toko dengan fighting brand ratio > FBSI_THRESHOLD per bulan.
    Proxy sederhana untuk AEGIS warning trend tanpa sliding-window penuh.
    """
    df = df.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M").astype(str)

    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if brand_col is None:
        return []

    df["_is_fight"] = df[brand_col].str.upper().str.contains("BANTENG", na=False)

    grp = (
        df.groupby(["_p", "ID Toko"])
        .agg(
            total_ton=("TON Quantity", "sum"),
            fight_ton=("TON Quantity", lambda x: x[df.loc[x.index, "_is_fight"]].sum()),
        )
        .reset_index()
    )
    grp["fbsi"] = grp["fight_ton"] / grp["total_ton"].clip(lower=0.001) * 100
    grp["warning"] = grp["fbsi"] >= FBSI_THRESHOLD

    monthly = grp.groupby("_p")["warning"].sum().reset_index()
    monthly.columns = ["periode", "value"]
    return monthly.sort_values("periode").to_dict("records")


def _monthly_volume_at_risk(df: pd.DataFrame) -> list[dict]:
    """Volume (ton) dari toko yang bulan itu masuk kategori warning."""
    df = df.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M").astype(str)

    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if brand_col is None:
        return []

    df["_is_fight"] = df[brand_col].str.upper().str.contains("BANTENG", na=False)

    grp = (
        df.groupby(["_p", "ID Toko"])
        .agg(
            total_ton=("TON Quantity", "sum"),
            fight_ton=("TON Quantity", lambda x: x[df.loc[x.index, "_is_fight"]].sum()),
        )
        .reset_index()
    )
    grp["fbsi"] = grp["fight_ton"] / grp["total_ton"].clip(lower=0.001) * 100
    warning_toko = grp[grp["fbsi"] >= FBSI_THRESHOLD][["_p", "ID Toko"]].copy()

    merged = warning_toko.merge(
        df[["_p", "ID Toko", "TON Quantity"]], on=["_p", "ID Toko"]
    )
    monthly = merged.groupby("_p")["TON Quantity"].sum().reset_index()
    monthly.columns = ["periode", "value"]
    monthly["value"] = monthly["value"].round(2)
    return monthly.sort_values("periode").to_dict("records")


def _monthly_internal_ms(df: pd.DataFrame) -> list[dict]:
    """Internal brand market share % per bulan dari data transaksi."""
    df = df.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M").astype(str)

    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if brand_col is None:
        return []

    INTERNAL = {"SEMEN ELANG", "SEMEN BADAK"}
    df["_is_internal"] = df[brand_col].str.upper().isin(INTERNAL)

    grp = (
        df.groupby("_p")
        .agg(
            total_ton=("TON Quantity", "sum"),
            internal_ton=("TON Quantity", lambda x: x[df.loc[x.index, "_is_internal"]].sum()),
        )
        .reset_index()
    )
    grp["value"] = (grp["internal_ton"] / grp["total_ton"].clip(lower=0.001) * 100).round(2)
    return grp[["_p", "value"]].rename(columns={"_p": "periode"}).sort_values("periode").to_dict("records")


def _monthly_store_fbsi(df: pd.DataFrame, id_toko: str) -> list[dict]:
    """Monthly fighting brand share index untuk satu toko."""
    df = df[df["ID Toko"] == id_toko].copy()
    if df.empty:
        return []

    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M").astype(str)
    brand_col = next((c for c in df.columns if "brand" in c.lower()), None)
    if brand_col is None:
        return []

    df["_is_fight"] = df[brand_col].str.upper().str.contains("BANTENG", na=False)

    grp = (
        df.groupby("_p")
        .agg(
            total_ton=("TON Quantity", "sum"),
            fight_ton=("TON Quantity", lambda x: x[df.loc[x.index, "_is_fight"]].sum()),
        )
        .reset_index()
    )
    grp["value"] = (grp["fight_ton"] / grp["total_ton"].clip(lower=0.001) * 100).round(2)
    return grp[["_p", "value"]].rename(columns={"_p": "periode"}).sort_values("periode").to_dict("records")


# ── endpoints ────────────────────────────────────────────────────────────────


@router.get("/aegis-warning-trend")
def aegis_warning_trend(n_ahead: int = Query(3, ge=1, le=12)) -> dict:
    """Prediksi jumlah toko AEGIS warning n_ahead bulan ke depan."""
    df = load_data()
    historical = _monthly_warning_series(df)
    result = predict_series(
        historical      = historical,
        n_ahead         = n_ahead,
        cache_key       = "aegis_warning_trend",
        cache_ttl_hours = 6,
    )
    return {
        "status": "ok",
        "data":   result,
        "meta":   _META(),
    }


@router.get("/aegis-store/{id_toko}")
def aegis_store_prediction(
    id_toko: str,
    n_ahead: int = Query(3, ge=1, le=12),
) -> dict:
    """Prediksi Fighting Brand Share Index toko tertentu n_ahead bulan ke depan."""
    df = load_data()
    historical = _monthly_store_fbsi(df, id_toko)
    if not historical:
        return {
            "status": "ok",
            "data":   {"status": "no_data", "predictions": [], "message": f"Toko {id_toko} tidak ditemukan"},
            "meta":   _META(),
        }
    result = predict_series(
        historical      = historical,
        n_ahead         = n_ahead,
        cache_key       = f"aegis_store_{id_toko}",
        cache_ttl_hours = 6,
    )
    return {
        "status": "ok",
        "data":   result,
        "meta":   _META(),
    }


@router.get("/volume-at-risk")
def volume_at_risk(n_ahead: int = Query(2, ge=1, le=6)) -> dict:
    """Prediksi volume (ton) berisiko dari toko warning n_ahead bulan ke depan."""
    df = load_data()
    historical = _monthly_volume_at_risk(df)
    result = predict_series(
        historical      = historical,
        n_ahead         = n_ahead,
        cache_key       = "volume_at_risk",
        cache_ttl_hours = 6,
    )
    return {
        "status": "ok",
        "data":   result,
        "meta":   _META(),
    }


@router.get("/home-executive")
def home_executive() -> dict:
    """
    Aggregasi 3 prediksi utama untuk Home Dashboard (1 bulan ke depan).
    TTL cache 6 jam.
    """
    df = load_data()

    warn_result = predict_series(
        historical      = _monthly_warning_series(df),
        n_ahead         = 1,
        cache_key       = "home_exec_warning",
        cache_ttl_hours = 6,
    )
    var_result = predict_series(
        historical      = _monthly_volume_at_risk(df),
        n_ahead         = 1,
        cache_key       = "home_exec_var",
        cache_ttl_hours = 6,
    )
    ms_result = predict_series(
        historical      = _monthly_internal_ms(df),
        n_ahead         = 1,
        cache_key       = "home_exec_ms",
        cache_ttl_hours = 6,
    )

    def _first_pred(r: dict) -> dict | None:
        preds = r.get("predictions", [])
        return preds[0] if preds else None

    return {
        "status": "ok",
        "data": {
            "warning_trend": {
                "prediction":      _first_pred(warn_result),
                "trend_direction": warn_result.get("trend_direction"),
                "trend_pct":       warn_result.get("trend_pct"),
                "method":          warn_result.get("method"),
            },
            "volume_at_risk": {
                "prediction":      _first_pred(var_result),
                "trend_direction": var_result.get("trend_direction"),
                "trend_pct":       var_result.get("trend_pct"),
                "method":          var_result.get("method"),
            },
            "market_share_internal": {
                "prediction":      _first_pred(ms_result),
                "trend_direction": ms_result.get("trend_direction"),
                "trend_pct":       ms_result.get("trend_pct"),
                "method":          ms_result.get("method"),
            },
        },
        "meta": _META(),
    }

"""Terpusat adaptive prediction engine — dipakai AEGIS, Competitor, Home."""
from __future__ import annotations

import json
import os
from datetime import datetime

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta

PREDICTION_CACHE_DIR = "api/data/models/predictions"
os.makedirs(PREDICTION_CACHE_DIR, exist_ok=True)


def determine_method(n_periods: int) -> str:
    if n_periods >= 6:
        return "prophet"
    elif n_periods >= 3:
        return "linear"
    return "delta"


def predict_series(
    historical: list[dict],
    n_ahead: int = 3,
    cache_key: str | None = None,
    cache_ttl_hours: int = 6,
) -> dict:
    """
    Predict n_ahead periode ke depan dari historical time series.
    historical: [{"periode": "2024-01", "value": 52.3}, ...]
    """
    if cache_key:
        cache_path = os.path.join(PREDICTION_CACHE_DIR, f"{cache_key}.json")
        if os.path.exists(cache_path):
            try:
                with open(cache_path) as f:
                    cached = json.load(f)
                age_h = (
                    datetime.now() - datetime.fromisoformat(cached["generated_at"])
                ).total_seconds() / 3600
                if age_h < cache_ttl_hours:
                    return {**cached, "cached": True}
            except Exception:
                pass
    else:
        cache_path = None

    if not historical or len(historical) < 2:
        return {"status": "insufficient_data", "predictions": []}

    df = pd.DataFrame(historical).sort_values("periode").reset_index(drop=True)
    n = len(df)
    method = determine_method(n)

    try:
        if method == "prophet":
            result = _predict_prophet(df, n_ahead)
        elif method == "linear":
            result = _predict_linear(df, n_ahead)
        else:
            result = _predict_delta(df, n_ahead)

        output = {
            "status":          "ok",
            "method":          method,
            "n_historical":    n,
            "historical":      historical,
            "predictions":     result["predictions"],
            "trend_direction": _calc_trend(df),
            "trend_pct":       _calc_trend_pct(df),
            "generated_at":    datetime.now().isoformat(),
            "cached":          False,
        }

        if cache_path:
            try:
                with open(cache_path, "w") as f:
                    json.dump(output, f)
            except Exception:
                pass

        return output

    except Exception as exc:
        return {"status": "error", "message": str(exc), "predictions": []}


def _predict_prophet(df: pd.DataFrame, n_ahead: int) -> dict:
    import warnings
    from prophet import Prophet

    prophet_df = pd.DataFrame({
        "ds": pd.to_datetime(df["periode"] + "-01"),
        "y":  df["value"].astype(float),
    })
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = Prophet(
            yearly_seasonality=False,
            weekly_seasonality=False,
            daily_seasonality=False,
            interval_width=0.80,
        )
        model.fit(prophet_df)
        future   = model.make_future_dataframe(periods=n_ahead, freq="MS")
        forecast = model.predict(future)

    future_rows = forecast.tail(n_ahead)
    predictions = []
    for _, row in future_rows.iterrows():
        predictions.append({
            "periode": row["ds"].strftime("%Y-%m"),
            "value":   round(float(row["yhat"]), 2),
            "lower":   round(float(row["yhat_lower"]), 2),
            "upper":   round(float(row["yhat_upper"]), 2),
        })
    return {"predictions": predictions}


def _predict_linear(df: pd.DataFrame, n_ahead: int) -> dict:
    from sklearn.linear_model import LinearRegression

    X = np.arange(len(df)).reshape(-1, 1)
    y = df["value"].astype(float).values
    model = LinearRegression().fit(X, y)
    residuals = y - model.predict(X)
    std = float(np.std(residuals)) if len(residuals) > 2 else 0.0

    last_periode = datetime.strptime(df["periode"].iloc[-1], "%Y-%m")
    margin = std * 1.28
    predictions = []
    for i in range(1, n_ahead + 1):
        x_new = len(df) - 1 + i
        pred  = float(model.predict([[x_new]])[0])
        future = last_periode + relativedelta(months=i)
        predictions.append({
            "periode": future.strftime("%Y-%m"),
            "value":   round(pred, 2),
            "lower":   round(pred - margin, 2),
            "upper":   round(pred + margin, 2),
        })
    return {"predictions": predictions}


def _predict_delta(df: pd.DataFrame, n_ahead: int) -> dict:
    last  = float(df["value"].iloc[-1])
    prev  = float(df["value"].iloc[-2])
    delta = last - prev
    last_periode = datetime.strptime(df["periode"].iloc[-1], "%Y-%m")
    predictions = []
    for i in range(1, n_ahead + 1):
        future = last_periode + relativedelta(months=i)
        predictions.append({
            "periode": future.strftime("%Y-%m"),
            "value":   round(last + delta * i, 2),
            "lower":   None,
            "upper":   None,
        })
    return {"predictions": predictions}


def _calc_trend(df: pd.DataFrame) -> str:
    if len(df) < 2:
        return "stabil"
    recent = df["value"].tail(3).astype(float).values
    slope  = float(np.polyfit(range(len(recent)), recent, 1)[0])
    if slope > 0.5:
        return "naik"
    if slope < -0.5:
        return "turun"
    return "stabil"


def _calc_trend_pct(df: pd.DataFrame) -> float:
    if len(df) < 2:
        return 0.0
    old = float(df["value"].iloc[-min(3, len(df))])
    new = float(df["value"].iloc[-1])
    if old == 0:
        return 0.0
    return round((new - old) / old * 100, 1)

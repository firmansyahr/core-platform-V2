import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from prophet import Prophet


def prepare_weekly_series(df_transaksi: pd.DataFrame, id_toko: str) -> pd.DataFrame:
    toko_df = df_transaksi[df_transaksi["ID Toko"] == id_toko].copy()
    if len(toko_df) < 8:
        return pd.DataFrame()

    toko_df["week"] = toko_df["Tanggal Transaksi"].dt.to_period("W").dt.start_time
    toko_df["is_fighting"] = toko_df["Brands"].str.contains("BANTENG", na=False)
    toko_df["ton_f_"] = toko_df["TON Quantity"] * toko_df["is_fighting"].astype(int)

    weekly = toko_df.groupby("week").agg(
        ton_total=("TON Quantity", "sum"),
        ton_fighting=("ton_f_", "sum"),
        harga_avg=("Harga", "mean"),
        trx_count=("TON Quantity", "count"),
    ).reset_index()

    weekly["fbsi"] = (
        weekly["ton_fighting"] / weekly["ton_total"].replace(0, np.nan) * 100
    ).fillna(0)
    weekly["fbsi_delta"] = weekly["fbsi"].diff().fillna(0)
    weekly["he_delta"]   = weekly["harga_avg"].pct_change().fillna(0) * 100
    weekly["ors_cv"] = (
        weekly["trx_count"].rolling(4).std()
        / weekly["trx_count"].rolling(4).mean()
    ).fillna(0)

    fbsi_score = (weekly["fbsi_delta"].clip(0, 30) / 30 * 100).clip(0, 100)
    he_score   = (weekly["he_delta"].clip(-20, 0).abs() / 20 * 100).clip(0, 100)
    ors_score  = (weekly["ors_cv"].clip(0, 1) * 100).clip(0, 100)
    weekly["crs_approx"] = (
        fbsi_score * 0.6 + he_score * 0.3 + ors_score * 0.1
    ).clip(0, 100)

    return weekly[["week", "crs_approx", "fbsi", "he_delta", "ors_cv"]].dropna()


def _score_to_level(score: float) -> str:
    if score >= 85:
        return "Merah"
    if score >= 65:
        return "Oranye"
    if score >= 40:
        return "Kuning"
    return "Normal"


def forecast_store_aegis(
    df_transaksi: pd.DataFrame,
    id_toko: str,
    horizon_weeks: int = 4,
) -> dict:
    weekly = prepare_weekly_series(df_transaksi, id_toko)

    if len(weekly) < 12:
        return {
            "status": "insufficient_data",
            "message": (
                f"Data tidak cukup untuk forecasting "
                f"(butuh minimal 12 minggu, ada {len(weekly)})"
            ),
            "forecast": [],
        }

    df_prophet = pd.DataFrame({"ds": weekly["week"], "y": weekly["crs_approx"]})

    try:
        model = Prophet(
            yearly_seasonality=False,
            weekly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode="additive",
            changepoint_prior_scale=0.05,
            interval_width=0.80,
        )
        model.fit(df_prophet)

        future   = model.make_future_dataframe(periods=horizon_weeks, freq="W")
        forecast = model.predict(future)

        hist_len      = len(df_prophet)
        forecast_rows = forecast.tail(horizon_weeks)

        def clip_row(row: pd.Series) -> dict:
            return {
                "ds":         str(row["ds"].date()),
                "yhat":       round(float(np.clip(row["yhat"],       0, 100)), 1),
                "yhat_lower": round(float(np.clip(row["yhat_lower"], 0, 100)), 1),
                "yhat_upper": round(float(np.clip(row["yhat_upper"], 0, 100)), 1),
            }

        last_actual = float(df_prophet["y"].iloc[-1])
        pred_4w     = float(np.clip(forecast_rows["yhat"].iloc[-1], 0, 100))
        trend_delta = pred_4w - last_actual

        if trend_delta > 10:
            trend       = "memburuk"
            trend_color = "red"
        elif trend_delta > 3:
            trend       = "sedikit memburuk"
            trend_color = "orange"
        elif trend_delta < -10:
            trend       = "membaik"
            trend_color = "green"
        elif trend_delta < -3:
            trend       = "sedikit membaik"
            trend_color = "blue"
        else:
            trend       = "stabil"
            trend_color = "gray"

        current_level   = _score_to_level(last_actual)
        predicted_level = _score_to_level(pred_4w)

        # Level order for worsening check
        _order = {"Normal": 0, "Kuning": 1, "Oranye": 2, "Merah": 3}
        level_worse = _order.get(predicted_level, 0) > _order.get(current_level, 0)

        return {
            "status":               "ok",
            "id_toko":              id_toko,
            "current_score":        round(last_actual, 1),
            "current_level":        current_level,
            "predicted_score_4w":   round(pred_4w, 1),
            "predicted_level_4w":   predicted_level,
            "trend":                trend,
            "trend_delta":          round(trend_delta, 1),
            "trend_color":          trend_color,
            "level_change":         current_level != predicted_level,
            "level_worse":          level_worse,
            "historical": [
                clip_row(r)
                for _, r in forecast.head(hist_len).tail(12).iterrows()
            ],
            "forecast": [
                clip_row(r) for _, r in forecast_rows.iterrows()
            ],
            "horizon_weeks": horizon_weeks,
        }

    except Exception as exc:
        return {"status": "error", "message": str(exc), "forecast": []}


def forecast_batch(
    df_transaksi: pd.DataFrame,
    id_toko_list: list[str],
    horizon_weeks: int = 4,
) -> list[dict]:
    results = []
    for id_toko in id_toko_list:
        r = forecast_store_aegis(df_transaksi, id_toko, horizon_weeks)
        if r["status"] == "ok":
            results.append({
                "id_toko":            id_toko,
                "current_score":      r["current_score"],
                "predicted_score_4w": r["predicted_score_4w"],
                "predicted_level_4w": r["predicted_level_4w"],
                "trend":              r["trend"],
                "trend_delta":        r["trend_delta"],
                "trend_color":        r["trend_color"],
                "level_change":       r["level_change"],
                "level_worse":        r["level_worse"],
            })
        else:
            results.append({
                "id_toko": id_toko,
                "status":  r["status"],
            })
    return results

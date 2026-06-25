"""
Competitor Forecast Generator — dijalankan di Google Colab atau lokal.

Output: api/data/competitor_forecast_cache.json
Isi   : prediksi tren brand mix + market share 3 bulan ke depan per area
Model : Prophet (jika tersedia) dengan fallback LinearRegression per sklearn

Cara pakai:
  1. Di Colab: upload file ini + file parquet data transaksi
  2. Jalankan: python competitor_forecast.py --parquet data/transaksi_aegis_synthetic.parquet
  3. Download output: competitor_forecast_cache.json → upload ke api/data/
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ELANG, BADAK, BANTENG = "SEMEN ELANG", "SEMEN BADAK", "SEMEN BANTENG"
HORIZON_MONTHS = 3


def _load_parquet(path: str) -> pd.DataFrame:
    df = pd.read_parquet(path)
    df["Tanggal Transaksi"] = pd.to_datetime(df["Tanggal Transaksi"], errors="coerce")
    for col in ["TON Quantity"]:
        df[col] = pd.to_numeric(df.get(col, 0), errors="coerce").fillna(0)
    return df


def _brand_mix_series(df: pd.DataFrame, group_col: str) -> pd.DataFrame:
    sub = df[df["Brands"].isin([ELANG, BADAK, BANTENG])].copy()
    sub["periode"] = sub["Tanggal Transaksi"].dt.strftime("%Y-%m")
    agg = (
        sub.groupby([group_col, "periode", "Brands"])["TON Quantity"]
        .sum().unstack("Brands", fill_value=0).reset_index()
    )
    for b in (ELANG, BADAK, BANTENG):
        if b not in agg.columns:
            agg[b] = 0.0
    agg["vol_total"] = agg[ELANG] + agg[BADAK] + agg[BANTENG]
    agg["elang_pct"] = (agg[ELANG] / agg["vol_total"].clip(lower=1) * 100).round(2)
    agg["banteng_pct"] = (agg[BANTENG] / agg["vol_total"].clip(lower=1) * 100).round(2)
    return agg


def _forecast_series(values: list[float], horizon: int) -> list[float]:
    """LinearRegression fallback — Prophet dipakai kalau tersedia."""
    try:
        from prophet import Prophet  # type: ignore[import]
        import warnings
        dates = pd.date_range(end=datetime.now(), periods=len(values), freq="MS")
        df_p = pd.DataFrame({"ds": dates, "y": values})
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            m = Prophet(yearly_seasonality=True, weekly_seasonality=False, daily_seasonality=False)
            m.fit(df_p)
        future = m.make_future_dataframe(periods=horizon, freq="MS")
        forecast = m.predict(future)
        return forecast["yhat"].tail(horizon).clip(0, 100).round(2).tolist()
    except Exception:
        pass

    # Fallback: Linear trend
    from sklearn.linear_model import LinearRegression  # type: ignore[import]
    x = np.arange(len(values)).reshape(-1, 1)
    y = np.array(values)
    model = LinearRegression().fit(x, y)
    future_x = np.arange(len(values), len(values) + horizon).reshape(-1, 1)
    preds = model.predict(future_x).clip(0, 100).round(2).tolist()
    return preds


def _label_trend(preds: list[float], current: float) -> str:
    if not preds:
        return "stable"
    end_val = preds[-1]
    delta = end_val - current
    if delta < -3:
        return "accelerating_loss" if delta < -7 else "slow_erosion"
    if delta > 3:
        return "gaining"
    return "stable"


def generate_forecast(df: pd.DataFrame) -> dict:
    kabupaten_forecasts = []
    provinsi_forecasts = []
    threat_summary = []
    expansion_candidates = []
    at_risk_areas = []

    kab_series = _brand_mix_series(df, "Kabupaten Toko")
    prov_series = _brand_mix_series(df, "Provinsi Toko")

    kab_to_prov = (
        df.dropna(subset=["Kabupaten Toko", "Provinsi Toko"])
        .drop_duplicates("Kabupaten Toko")
        .set_index("Kabupaten Toko")["Provinsi Toko"]
        .to_dict()
    )

    for area, grp in kab_series.groupby("Kabupaten Toko"):
        grp = grp.sort_values("periode")
        if len(grp) < 4:
            continue
        elang_vals = grp["elang_pct"].tolist()
        banteng_vals = grp["banteng_pct"].tolist()
        current_elang = elang_vals[-1]
        current_banteng = banteng_vals[-1]
        prov = kab_to_prov.get(str(area), "")

        preds_elang = _forecast_series(elang_vals, HORIZON_MONTHS)
        preds_banteng = _forecast_series(banteng_vals, HORIZON_MONTHS)
        trend_elang = _label_trend(preds_elang, current_elang)
        trend_banteng = _label_trend(preds_banteng, current_banteng)

        entry = {
            "area": str(area), "provinsi": prov,
            "current_elang_pct": current_elang, "current_banteng_pct": current_banteng,
            "forecast_elang_pct": preds_elang, "forecast_banteng_pct": preds_banteng,
            "trend_elang": trend_elang, "trend_banteng": trend_banteng,
            "horizon_months": HORIZON_MONTHS,
            "history_elang_pct": elang_vals[-6:], "history_banteng_pct": banteng_vals[-6:],
            "history_periodes": grp["periode"].tolist()[-6:],
        }
        kabupaten_forecasts.append(entry)

        if trend_elang in ("accelerating_loss", "slow_erosion"):
            at_risk_areas.append({"area": str(area), "provinsi": prov, "scope": "kabupaten",
                                   "trend_elang": trend_elang, "current_elang_pct": current_elang,
                                   "forecast_end_elang_pct": preds_elang[-1] if preds_elang else current_elang})
        elif trend_elang == "gaining" and current_elang < 40:
            expansion_candidates.append({"area": str(area), "provinsi": prov, "scope": "kabupaten",
                                          "current_elang_pct": current_elang,
                                          "forecast_end_elang_pct": preds_elang[-1] if preds_elang else current_elang})

    for area, grp in prov_series.groupby("Provinsi Toko"):
        grp = grp.sort_values("periode")
        if len(grp) < 4:
            continue
        elang_vals = grp["elang_pct"].tolist()
        banteng_vals = grp["banteng_pct"].tolist()
        current_elang = elang_vals[-1]
        preds_elang = _forecast_series(elang_vals, HORIZON_MONTHS)
        preds_banteng = _forecast_series(banteng_vals, HORIZON_MONTHS)
        trend_elang = _label_trend(preds_elang, current_elang)

        provinsi_forecasts.append({
            "area": str(area), "provinsi": str(area),
            "current_elang_pct": current_elang,
            "forecast_elang_pct": preds_elang, "forecast_banteng_pct": preds_banteng,
            "trend_elang": trend_elang, "horizon_months": HORIZON_MONTHS,
            "history_elang_pct": elang_vals[-6:], "history_periodes": grp["periode"].tolist()[-6:],
        })

        if trend_elang in ("accelerating_loss", "slow_erosion") and current_elang < 35:
            threat_summary.append({
                "provinsi": str(area), "scope": "provinsi",
                "threat_level": "critical" if trend_elang == "accelerating_loss" else "high",
                "current_elang_pct": current_elang,
                "forecast_end_elang_pct": preds_elang[-1] if preds_elang else current_elang,
            })

    threat_summary.sort(key=lambda x: x.get("current_elang_pct", 100))
    at_risk_areas.sort(key=lambda x: x.get("current_elang_pct", 100))
    expansion_candidates.sort(
        key=lambda x: (x.get("forecast_end_elang_pct", 0) - x.get("current_elang_pct", 0)), reverse=True
    )

    try:
        model_name = "prophet"
        from prophet import Prophet  # type: ignore[import]  # noqa: F401
    except Exception:
        model_name = "linear_regression"

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": model_name,
            "horizon_months": HORIZON_MONTHS,
            "areas_forecast": len(kabupaten_forecasts) + len(provinsi_forecasts),
            "available": True,
        },
        "kabupaten_forecasts": kabupaten_forecasts,
        "provinsi_forecasts": provinsi_forecasts,
        "threat_summary": threat_summary,
        "expansion_candidates": expansion_candidates,
        "at_risk_areas": at_risk_areas,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parquet", default="data/transaksi_aegis_synthetic.parquet")
    parser.add_argument("--output", default="api/data/competitor_forecast_cache.json")
    args = parser.parse_args()

    print(f"Loading data dari {args.parquet}...")
    df = _load_parquet(args.parquet)
    print(f"Data loaded: {len(df):,} baris")

    print("Menghitung forecast...")
    result = generate_forecast(df)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Forecast selesai → {out}")
    print(f"  Kabupaten: {len(result['kabupaten_forecasts'])}")
    print(f"  Provinsi : {len(result['provinsi_forecasts'])}")
    print(f"  Threats  : {len(result['threat_summary'])}")
    print(f"  At-risk  : {len(result['at_risk_areas'])}")
    print(f"  Model    : {result['meta']['model']}")


if __name__ == "__main__":
    main()

import pandas as pd
import streamlit as st

CONFIG = {
    "fighting_brand_values": ["SEMEN BANTENG"],
    "main_brand_values":     ["SEMEN ELANG"],
    "companion_brand_values": ["SEMEN BADAK"],
    "fbsi_window":    8,
    "fbsi_threshold": 15.0,
    "he_window":      8,
    "he_threshold":   -8.0,
    "ors_window":     12,
    "ors_threshold":  8.0,
    "crs_kuning":     40,
    "crs_oranye":     65,
    "crs_merah":      85,
}


@st.cache_data
def compute_store_crs(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute per-store FBSI, HE, CRS, alert level, CAD flag, and pattern.

    CRS = fighting brand share % over last fbsi_window months (0–100).
    Alert thresholds: Kuning >= 40, Oranye >= 65, Merah >= 85.
    CAD (Critical Account Defense): Merah + volume declining (HE triggered).
    """
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()

    # ── FBSI: fighting brand share over last fbsi_window months ──────────────
    fbsi_periods = [latest - i for i in range(CONFIG["fbsi_window"])]
    fbsi_mask    = period_col.isin(fbsi_periods)
    fb_mask      = df["Brands"].isin(CONFIG["fighting_brand_values"])

    total_ton = (df[fbsi_mask]
                 .groupby("ID Toko")["TON Quantity"].sum()
                 .rename("total_ton"))
    fight_ton = (df[fbsi_mask & fb_mask]
                 .groupby("ID Toko")["TON Quantity"].sum()
                 .rename("fight_ton"))

    stores = pd.concat([total_ton, fight_ton], axis=1).fillna(0)
    stores["fbsi"] = stores["fight_ton"] / stores["total_ton"].clip(lower=1) * 100
    stores["fbsi_triggered"] = stores["fbsi"] > CONFIG["fbsi_threshold"]

    # ── HE: volume trend — recent half vs early half of he_window ────────────
    half           = CONFIG["he_window"] // 2
    early_periods  = [latest - i for i in range(half, CONFIG["he_window"])]
    recent_periods = [latest - i for i in range(half)]

    early_vol  = (df[period_col.isin(early_periods)]
                  .groupby("ID Toko")["TON Quantity"].sum())
    recent_vol = (df[period_col.isin(recent_periods)]
                  .groupby("ID Toko")["TON Quantity"].sum())

    all_ids    = early_vol.index.union(recent_vol.index)
    early_vol  = early_vol.reindex(all_ids, fill_value=0)
    recent_vol = recent_vol.reindex(all_ids, fill_value=0)

    he = ((recent_vol - early_vol) / early_vol.clip(lower=1) * 100).rename("he")
    stores = stores.join(he, how="left").fillna({"he": 0.0})
    stores["he_triggered"] = stores["he"] < CONFIG["he_threshold"]

    # ── CRS & alert levels ───────────────────────────────────────────────────
    stores["crs"] = stores["fbsi"].clip(0, 100)
    stores["alert"] = "Normal"
    stores.loc[stores["crs"] >= CONFIG["crs_kuning"], "alert"] = "Kuning"
    stores.loc[stores["crs"] >= CONFIG["crs_oranye"], "alert"] = "Oranye"
    stores.loc[stores["crs"] >= CONFIG["crs_merah"],  "alert"] = "Merah"

    stores["cad"] = (stores["alert"] == "Merah") & stores["he_triggered"]

    # ── Pattern ──────────────────────────────────────────────────────────────
    stores["pattern"] = "Stabil"
    stores.loc[stores["fbsi_triggered"],                            "pattern"] = "FBSI↑"
    stores.loc[stores["he_triggered"],                              "pattern"] = "HE↓"
    stores.loc[stores["fbsi_triggered"] & stores["he_triggered"],   "pattern"] = "FBSI↑ HE↓"

    return stores.reset_index()


def get_warning_counts(store_crs: pd.DataFrame) -> dict:
    return {
        "merah":  int((store_crs["alert"] == "Merah").sum()),
        "oranye": int((store_crs["alert"] == "Oranye").sum()),
        "kuning": int((store_crs["alert"] == "Kuning").sum()),
        "cad":    int(store_crs["cad"].sum()),
    }


def get_top_tso_stores(df: pd.DataFrame, store_crs: pd.DataFrame, n: int = 5) -> pd.DataFrame:
    store_info = (df.sort_values("Tanggal Transaksi", ascending=False)
                  [["ID Toko", "Nama Toko", "TSO"]]
                  .drop_duplicates("ID Toko")
                  .set_index("ID Toko"))

    top = (store_crs.set_index("ID Toko")
           .join(store_info, how="left")
           .sort_values("crs", ascending=False)
           .head(n)
           [["Nama Toko", "TSO", "crs", "pattern"]]
           .rename(columns={"crs": "AEGIS Score"}))

    return top.reset_index(drop=True)

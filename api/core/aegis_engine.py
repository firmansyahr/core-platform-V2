import functools
import warnings as _warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler
from imblearn.over_sampling import SMOTE
import xgboost as xgb

from api.core.data_loader import load_data

# ── Constants ─────────────────────────────────────────────────────────────────
FIGHTING_BRAND = "SEMEN BANTENG"
FBSI_WINDOW    = 8
FBSI_THRESHOLD = 15.0
HE_WINDOW      = 8
HE_THRESHOLD   = -8.0
ORS_WINDOW     = 12
CRS_KUNING     = 40
CRS_ORANYE     = 65
CRS_MERAH      = 85

CONTAMINATION_MAP: dict[str, float] = {
    "Super Platinum": 0.03,
    "Platinum":       0.04,
    "Gold":           0.05,
    "Silver":         0.06,
    "Bronze":         0.08,
}
PRIORITY_BONUS: dict[str, int] = {
    "Super Platinum": 12,
    "Platinum":        8,
    "Gold":            4,
    "Silver":          0,
    "Bronze":         -5,
}

# Walk-forward boundaries (Cell 35)
TRAIN_END  = pd.Timestamp("2025-12-31")
BUFFER_END = pd.Timestamp("2026-01-31")

# AEGIS ensemble weights (Cell 35)
W_CRS = 0.50
W_IF  = 0.20
W_XGB = 0.30

# XGBoost feature set (Cell 34) — n_weeks_high per POC naming
XGB_FEATURES = [
    "n_weeks_high", "delta_fbsi", "s_fbsi_adjusted",
    "s_he", "delta_he_pct", "s_ors", "delta_cv", "if_score_norm",
]

# Isolation Forest feature sets (Cell 17)
_IF_FEAT_FULL  = ["s_fbsi_adjusted", "delta_fbsi", "s_he", "delta_he_pct", "s_ors", "delta_cv"]
_IF_FEAT_SHORT = ["s_fbsi_adjusted", "delta_fbsi", "s_he", "delta_he_pct"]

# Joblib XGBoost cache — survives server restarts
_XGB_CACHE = Path(__file__).parent / "_xgb_cache.pkl"


# ── Feature helpers ───────────────────────────────────────────────────────────

def _col(df: pd.DataFrame, name: str, fill: float = 0.0) -> pd.Series:
    return df[name].fillna(fill) if name in df.columns else pd.Series(fill, index=df.index)


def _fbsi_features(df: pd.DataFrame, latest: pd.Period) -> pd.DataFrame:
    """Per-store FBSI features: delta_fbsi, s_fbsi_adjusted, n_weeks_high."""
    df = df.copy()
    months = {latest - i for i in range(FBSI_WINDOW)}
    fdf = df[df["_p"].isin(months)]

    total_m = fdf.groupby(["ID Toko", "_p"])["TON Quantity"].sum().rename("total")
    fight_m = (
        fdf[fdf["Brands"] == FIGHTING_BRAND]
        .groupby(["ID Toko", "_p"])["TON Quantity"].sum()
        .rename("fight")
    )
    monthly = pd.concat([total_m, fight_m], axis=1).fillna(0).reset_index()
    monthly["fbsi_m"] = monthly["fight"] / monthly["total"].clip(lower=1) * 100

    lat_fbsi  = monthly[monthly["_p"] == latest].set_index("ID Toko")["fbsi_m"]
    baseline  = monthly[monthly["_p"] != latest].groupby("ID Toko")["fbsi_m"].mean()

    # n_weeks_high: periods in window where FBSI exceeded threshold (Cell 34 feature name)
    n_weeks_high = (
        monthly[monthly["fbsi_m"] > FBSI_THRESHOLD]
        .groupby("ID Toko")
        .size()
        .rename("n_weeks_high")
    )

    stats = pd.DataFrame(index=baseline.index.union(lat_fbsi.index))
    stats["fbsi"]            = monthly.groupby("ID Toko")["fbsi_m"].mean()
    stats["fbsi_latest"]     = lat_fbsi
    stats["fbsi_baseline"]   = baseline
    stats["delta_fbsi"]      = (lat_fbsi - baseline).fillna(0)
    stats["s_fbsi_adjusted"] = (stats["delta_fbsi"].clip(0, 30) / 30 * 100).fillna(0)
    stats["n_weeks_high"]    = n_weeks_high.reindex(stats.index).fillna(0)

    return stats.fillna(0)


def _he_features(df: pd.DataFrame, latest: pd.Period) -> pd.DataFrame:
    """Per-store Harga Efektif features: delta_he_pct, s_he."""
    df = df.copy()
    months = {latest - i for i in range(HE_WINDOW)}
    hdf = df[df["_p"].isin(months)].copy()
    hdf["revenue"] = hdf["Harga"] * hdf["Zak Quantity"].fillna(0)

    rev_m = hdf.groupby(["ID Toko", "_p"])["revenue"].sum().rename("rev")
    ton_m = hdf.groupby(["ID Toko", "_p"])["TON Quantity"].sum().rename("ton")
    monthly = pd.concat([rev_m, ton_m], axis=1).reset_index()
    monthly["he_m"] = monthly["rev"] / monthly["ton"].clip(lower=1)

    lat_he   = monthly[monthly["_p"] == latest].set_index("ID Toko")["he_m"]
    baseline = monthly[monthly["_p"] != latest].groupby("ID Toko")["he_m"].mean()

    stats = pd.DataFrame(index=baseline.index.union(lat_he.index))
    stats["he"]           = baseline
    stats["he_latest"]    = lat_he
    stats["delta_he_pct"] = (
        (lat_he - baseline) / baseline.clip(lower=1) * 100
    ).clip(-100, 100).fillna(0)
    # s_he: price drop → higher score (0–20% drop → 0–100)
    stats["s_he"] = stats["delta_he_pct"].clip(upper=0, lower=-20).abs() / 20 * 100

    return stats.fillna(0)


def _cv_stat(s: pd.Series) -> float:
    m = float(s.mean())
    if m < 1e-9 or len(s) < 2:
        return 0.0
    return float(s.std(ddof=1) / m)


def _ors_features(df: pd.DataFrame, latest: pd.Period) -> pd.DataFrame:
    """Per-store Order Regularity Score via transaction-count CV."""
    df = df.copy()
    months = {latest - i for i in range(ORS_WINDOW)}
    trx_m = (
        df[df["_p"].isin(months)]
        .groupby(["ID Toko", "_p"])["No Transaksi"].nunique()
        .rename("n_trx")
        .reset_index()
    )

    n_active = trx_m.groupby("ID Toko")["n_trx"].count().rename("n_active_months")

    half         = ORS_WINDOW // 2
    early_months = {latest - i for i in range(half, ORS_WINDOW)}
    late_months  = {latest - i for i in range(half)}

    early_cv = (
        trx_m[trx_m["_p"].isin(early_months)]
        .groupby("ID Toko")["n_trx"].agg(_cv_stat)
        .rename("cv_early")
    )
    late_cv = (
        trx_m[trx_m["_p"].isin(late_months)]
        .groupby("ID Toko")["n_trx"].agg(_cv_stat)
        .rename("cv_late")
    )

    delta_cv = (late_cv - early_cv).rename("delta_cv").fillna(0)

    stats = pd.concat([n_active, delta_cv], axis=1)
    stats["s_ors"]     = (stats["delta_cv"].clip(0, 0.5) / 0.5 * 100).fillna(0)
    stats["_low_freq"] = stats["n_active_months"] < 5

    return stats.fillna({"delta_cv": 0.0, "s_ors": 0.0, "_low_freq": True})


# ── Isolation Forest (Cell 17) ────────────────────────────────────────────────

def _run_isolation_forest(stores: pd.DataFrame) -> pd.DataFrame:
    """
    Per-tier Isolation Forest.  ORS-valid stores get IF scored; low-freq stores
    receive neutral scores (if_label=1, if_score_norm=0) per Cell 17 POC logic.
    """
    stores = stores.copy()
    stores["if_label"]      = 1
    stores["if_score_norm"] = 0.0

    scaler       = StandardScaler()
    pareto_order = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"]

    for tier in pareto_order:
        cont    = CONTAMINATION_MAP.get(tier, 0.05)
        t_mask  = stores["Cluster Pareto"] == tier
        df_tier = stores[t_mask]
        if len(df_tier) < 10:
            continue

        low_mask = df_tier["_low_freq"].fillna(True).astype(bool)
        df_full  = df_tier[~low_mask]   # ORS-valid → run IF
        # df_low (low_mask) keeps default if_label=1, if_score_norm=0.0

        if len(df_full) < 5:
            # Too few ORS-valid stores → run on all with FBSI+HE features only
            feat_use = _IF_FEAT_SHORT
            df_use   = df_tier
        else:
            feat_use = _IF_FEAT_FULL
            df_use   = df_full

        feat = [f for f in feat_use if f in df_use.columns]
        X    = df_use[feat].fillna(0).values
        X_sc = scaler.fit_transform(X)

        iso = IsolationForest(
            n_estimators=200, contamination=cont, random_state=42, n_jobs=-1
        )
        iso.fit(X_sc)

        labels = iso.predict(X_sc)
        scores = iso.score_samples(X_sc)   # more negative → more anomalous

        # Normalise to 0–100 (100 = most anomalous), matching Cell 17 formula
        s_min, s_max = float(scores.min()), float(scores.max())
        norm = ((scores - s_max) / (s_min - s_max + 1e-9) * 100).clip(0, 100)

        stores.loc[df_use.index, "if_label"]      = labels
        stores.loc[df_use.index, "if_score_norm"] = norm

    return stores


# ── CRS (Cell 19) ─────────────────────────────────────────────────────────────

def _compute_crs(stores: pd.DataFrame) -> pd.DataFrame:
    """
    CRS = s_fbsi * w_fbsi + s_he * w_he [+ s_ors * w_ors] + priority_bonus + if_boost.
    Dynamic weights: full (0.35/0.30/0.35) when ORS valid, else (0.55/0.45).
    IF boost: anomaly stores += if_score_norm * 0.15, capped at +10.
    """
    stores = stores.copy()

    # Prevent TypeError if any of these were stored as category dtype
    for col in ["crs_raw", "priority_bonus", "if_boost", "aegis_score", "churn_prob"]:
        if col in stores.columns and hasattr(stores[col], "cat"):
            stores[col] = stores[col].astype(float)

    W_FBSI_FULL, W_HE_FULL, W_ORS_FULL = 0.35, 0.30, 0.35
    W_FBSI_LOW,  W_HE_LOW               = 0.55, 0.45

    s_fbsi   = _col(stores, "s_fbsi_adjusted")
    s_he     = _col(stores, "s_he")
    s_ors    = _col(stores, "s_ors")
    low_freq = _col(stores, "_low_freq", fill=True).astype(bool)

    crs_full = s_fbsi * W_FBSI_FULL + s_he * W_HE_FULL + s_ors * W_ORS_FULL
    crs_low  = s_fbsi * W_FBSI_LOW  + s_he * W_HE_LOW

    stores["crs_raw"]        = np.where(low_freq | (s_ors == 0), crs_low, crs_full)
    stores["priority_bonus"] = stores["Cluster Pareto"].map(PRIORITY_BONUS).fillna(0)
    stores["if_boost"] = np.where(
        stores["if_label"] == -1,
        (_col(stores, "if_score_norm") * 0.15).clip(0, 10),
        0.0,
    )
    stores["crs"] = (
        stores["crs_raw"] + stores["priority_bonus"] + stores["if_boost"]
    ).clip(0, 100)

    return stores


# ── Joblib cache helpers ──────────────────────────────────────────────────────

def _try_load_cache(data_end: pd.Timestamp, feat_cols: list[str]):
    """Return cached XGBoost model if data_end and features match; else None."""
    if not _XGB_CACHE.exists():
        return None
    try:
        cached = joblib.load(str(_XGB_CACHE))
        if (cached.get("data_end") == data_end and
                cached.get("feat_cols") == list(feat_cols)):
            return cached["model"]
    except Exception:
        pass
    return None


def _save_cache(model, data_end: pd.Timestamp, feat_cols: list[str]) -> None:
    try:
        joblib.dump(
            {"model": model, "data_end": data_end, "feat_cols": list(feat_cols)},
            str(_XGB_CACHE),
        )
    except Exception:
        pass


# ── XGBoost walk-forward classifier (Cell 34) ─────────────────────────────────

def _train_and_predict(df_raw: pd.DataFrame, stores: pd.DataFrame) -> pd.Series:
    """
    5-fold StratifiedKFold cross-validation + final model on full SMOTE-augmented
    data.  Ground-truth label uses weekly periods (n_weeks ≥ 2).
    Trained model is persisted to _XGB_CACHE for fast server restarts.
    """
    default = pd.Series(0.0, index=stores.index, name="churn_prob")

    data_end = df_raw["Tanggal Transaksi"].max()
    if data_end <= BUFFER_END:
        return default

    try:
        feat_cols = [f for f in XGB_FEATURES if f in stores.columns]
        if not feat_cols:
            return default

        # ── Try joblib cache ───────────────────────────────────────────────
        cached_model = _try_load_cache(data_end, feat_cols)
        if cached_model is not None:
            X_all = stores[feat_cols].fillna(0).values.astype(float)
            proba = cached_model.predict_proba(X_all)[:, 1].clip(0, 1)
            return pd.Series(proba, index=stores.index, name="churn_prob")

        # ── Build ground-truth labels with weekly periods (Cell 34) ───────
        raw = df_raw.copy()
        raw["_is_fb"] = (raw["Brands"] == FIGHTING_BRAND).astype(float)
        raw["_fight"] = raw["TON Quantity"] * raw["_is_fb"]
        raw["_pw"]    = raw["Tanggal Transaksi"].dt.to_period("W")

        def _fbsi_weekly(subset: pd.DataFrame) -> pd.DataFrame:
            return (
                subset.groupby("ID Toko")
                .agg(
                    ton_fight=("_fight",        "sum"),
                    ton_total=("TON Quantity",  "sum"),
                    n_weeks  =("_pw",           "nunique"),
                )
                .assign(
                    fbsi_avg=lambda x: x["ton_fight"] / x["ton_total"].clip(lower=1) * 100
                )
            )

        tr_stats  = _fbsi_weekly(raw[raw["Tanggal Transaksi"] <= TRAIN_END])
        val_stats = _fbsi_weekly(raw[raw["Tanggal Transaksi"] >  BUFFER_END])

        df_label = (
            tr_stats[["fbsi_avg"]].rename(columns={"fbsi_avg": "fbsi_train"})
            .join(
                val_stats[["fbsi_avg", "n_weeks"]].rename(
                    columns={"fbsi_avg": "fbsi_val"}
                ),
                how="inner",
            )
            .reset_index()
        )
        df_label["delta_yoy"] = df_label["fbsi_val"] - df_label["fbsi_train"]
        # Cell 34 label: FBSI naik >15pp AND fbsi_val >30% AND n_weeks ≥ 2
        df_label["label"] = (
            (df_label["delta_yoy"] > 15) &
            (df_label["fbsi_val"]  > 30) &
            (df_label["n_weeks"]   >= 2)
        ).astype(int)

        df_ml = (
            stores.reset_index()[["ID Toko"] + feat_cols]
            .merge(df_label[["ID Toko", "label"]], on="ID Toko", how="inner")
            .dropna(subset=feat_cols)
        )

        if len(df_ml) < 50 or int(df_ml["label"].sum()) < 5:
            return default

        X = df_ml[feat_cols].values.astype(float)
        y = df_ml["label"].values

        # Global SMOTE for final model
        _warnings.filterwarnings("ignore")
        k_n = min(5, int(y.sum()) - 1)
        X_res, y_res = SMOTE(random_state=42, k_neighbors=k_n).fit_resample(X, y)

        scale_pos = max(1.0, float((1.0 - y.mean()) / max(y.mean(), 1e-9)))

        xgb_params: dict = dict(
            n_estimators=300,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=scale_pos,
            random_state=42,
            n_jobs=-1,
            eval_metric="aucpr",
            verbosity=0,
        )

        # ── 5-fold StratifiedKFold CV (Cell 34) ───────────────────────────
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        for tr_idx, vl_idx in skf.split(X, y):
            X_tr, X_vl = X[tr_idx], X[vl_idx]
            y_tr, y_vl = y[tr_idx], y[vl_idx]
            k_fold = min(5, int(y_tr.sum()) - 1)
            if k_fold < 1:
                continue
            X_tr_res, y_tr_res = SMOTE(
                random_state=42, k_neighbors=k_fold
            ).fit_resample(X_tr, y_tr)
            fold_model = xgb.XGBClassifier(**xgb_params)
            fold_model.fit(
                X_tr_res, y_tr_res,
                eval_set=[(X_vl, y_vl)],
                verbose=False,
            )

        # ── Final model on full SMOTE-augmented data ───────────────────────
        final_model = xgb.XGBClassifier(**xgb_params)
        final_model.fit(X_res, y_res, verbose=False)

        _save_cache(final_model, data_end, feat_cols)

        # Predict churn_prob for ALL stores
        X_all = stores[feat_cols].fillna(0).values.astype(float)
        proba = final_model.predict_proba(X_all)[:, 1].clip(0, 1)
        return pd.Series(proba, index=stores.index, name="churn_prob")

    except Exception:
        return default


# ── Pattern classification (Cell 21) ─────────────────────────────────────────

def _pola_vectorized(stores: pd.DataFrame) -> pd.Series:
    """
    Signal flags: fb_up = FBSI↑ beyond threshold, he_dn = HE↓ beyond threshold,
    or_up = ORS/CV↑ (order variability increasing).

    B: fb_up AND  he_dn AND  or_up  — tiga sinyal aktif (auto Merah)
    A: fb_up AND  he_dn AND ~or_up  — pergeseran produk, pola order stabil
    C: ~fb_up AND ~he_dn AND  or_up — pre-warning, hanya ORS tidak stabil
    D: ~fb_up AND ~he_dn AND ~or_up — semua sinyal stabil / pemulihan

    Check order (highest priority last → overwrites lower): D → C → A → B
    """
    d_fbsi = _col(stores, "delta_fbsi")
    d_he   = _col(stores, "delta_he_pct")
    d_cv   = _col(stores, "delta_cv")

    fb_up = d_fbsi > FBSI_THRESHOLD
    he_dn = d_he   < HE_THRESHOLD
    or_up = d_cv   > 0.1

    pola = pd.Series("Normal", index=stores.index)
    pola.loc[~fb_up & ~he_dn & ~or_up] = "D — Pemulihan"
    pola.loc[~fb_up & ~he_dn &  or_up] = "C — Pre-warning ORS"
    pola.loc[ fb_up &  he_dn & ~or_up] = "A — Pergeseran produk"
    pola.loc[ fb_up &  he_dn &  or_up] = "B — Tiga sinyal aktif"

    return pola


# ── Warning level (Cell 35) ───────────────────────────────────────────────────

def _warning_vectorized(stores: pd.DataFrame) -> pd.Series:
    """
    Priority order (Cell 35):
    1. Pola B → always Merah
    2. IF anomaly + churn_prob ≥ 0.90 → Merah
    3. aegis_score thresholds (Kuning/Oranye/Merah)
    """
    score      = _col(stores, "aegis_score")
    if_label   = stores["if_label"].fillna(1)
    churn_prob = stores["churn_prob"].fillna(0)
    pola       = stores["pola"].fillna("Normal")

    alert = pd.Series("Normal", index=stores.index)
    alert.loc[score >= CRS_KUNING]                      = "Kuning"
    alert.loc[score >= CRS_ORANYE]                      = "Oranye"
    alert.loc[score >= CRS_MERAH]                       = "Merah"
    alert.loc[(if_label == -1) & (churn_prob >= 0.90)]  = "Merah"
    alert.loc[pola.str.startswith("B")]                 = "Merah"

    return alert


# ── Main pipeline ─────────────────────────────────────────────────────────────

def compute_store_crs(df: pd.DataFrame) -> pd.DataFrame:
    """Full AEGIS ensemble pipeline → one row per store."""
    df = df.copy()

    # Ensure category columns are native types so string ops and arithmetic work
    _STR_COLS = [
        "ID Toko", "Nama Toko", "Cluster Pareto", "Tipe Customer",
        "Provinsi Toko", "Area AP Toko", "Area Toko", "Kabupaten Toko",
        "Brands", "Nama Produk", "Kode Produk", "UOM 1", "UOM 2",
        "TSO", "ASM", "SSM",
    ]
    for col in _STR_COLS:
        if col in df.columns and hasattr(df[col], "cat"):
            df[col] = df[col].astype(str)

    for col in ["TON Quantity", "Zak Quantity"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    if "Harga" in df.columns:
        df["Harga"] = pd.to_numeric(df["Harga"], errors="coerce").fillna(0)

    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")
    latest = df["_p"].max()

    # Store metadata (latest transaction per store)
    meta_cols = ["Nama Toko", "Kabupaten Toko", "Provinsi Toko",
                 "Cluster Pareto", "TSO", "ASM", "SSM"]
    store_meta = (
        df.sort_values("Tanggal Transaksi", ascending=False)
        .drop_duplicates("ID Toko")
        .set_index("ID Toko")[meta_cols]
    )

    fbsi_feat = _fbsi_features(df, latest)
    he_feat   = _he_features(df, latest)
    ors_feat  = _ors_features(df, latest)

    stores = (
        store_meta
        .join(fbsi_feat, how="left")
        .join(he_feat,   how="left")
        .join(ors_feat,  how="left")
    )

    # Latest-month volume per store (for volume_at_risk in routers)
    ton_latest = (
        df[df["_p"] == latest]
        .groupby("ID Toko")["TON Quantity"].sum()
        .rename("ton_latest")
    )
    stores = stores.join(ton_latest, how="left")

    stores = _run_isolation_forest(stores)
    stores = _compute_crs(stores)
    stores["churn_prob"] = _train_and_predict(df, stores)

    # AEGIS Score: CRS×0.50 + IF×0.20 + XGB×0.30 (Cell 35)
    stores["aegis_score"] = (
        stores["crs"]           * W_CRS
      + stores["if_score_norm"] * W_IF
      + (stores["churn_prob"] * 100).clip(0, 100) * W_XGB
    ).clip(0, 100)

    stores["pola"]      = _pola_vectorized(stores)
    stores["pola_kode"] = stores["pola"].str[0].fillna("N")   # A / B / C / D / N
    stores["alert"]     = _warning_vectorized(stores)
    stores["cad"] = (stores["alert"] == "Merah") & (
        stores["delta_he_pct"].fillna(0) < HE_THRESHOLD
    )

    stores["pattern"]        = stores["pola"]
    stores["fbsi_triggered"] = stores["delta_fbsi"].fillna(0) > FBSI_THRESHOLD
    stores["he_triggered"]   = stores["delta_he_pct"].fillna(0) < HE_THRESHOLD

    return stores.reset_index()


# ── AEGIS-EXPLAIN: SHAP explainability ────────────────────────────────────────

_FEATURE_LABELS: dict[str, str] = {
    "n_weeks_high"    : "Minggu dengan FBSI tinggi",
    "delta_fbsi"      : "Perubahan porsi produk murah (pp)",
    "s_fbsi_adjusted" : "Porsi produk murah saat ini (%)",
    "s_he"            : "Skor tekanan harga (0–100)",
    "delta_he_pct"    : "Perubahan harga efektif (%)",
    "s_ors"           : "Ketidakteraturan order (0–100)",
    "delta_cv"        : "Perubahan pola order (CV)",
    "if_score_norm"   : "Skor anomali Isolation Forest",
}


def calculate_shap_values(store_crs_df: pd.DataFrame, id_toko: str) -> dict:
    """
    Compute SHAP values for one store using the trained XGBoost model.
    Returns per-feature contributions toward the risk prediction probability.
    """
    import shap as _shap

    toko_row = store_crs_df[store_crs_df["ID Toko"] == id_toko]
    if len(toko_row) == 0:
        return {"status": "not_found"}

    feat_cols = [f for f in XGB_FEATURES if f in toko_row.columns]
    missing   = [f for f in XGB_FEATURES if f not in toko_row.columns]
    if missing:
        return {"status": "missing_features", "missing": missing}

    X = toko_row[feat_cols].fillna(0)

    if not _XGB_CACHE.exists():
        return {
            "status" : "model_not_ready",
            "message": "Model XGBoost belum dilatih — panggil compute_store_crs() terlebih dahulu",
        }

    try:
        cached = joblib.load(str(_XGB_CACHE))
        model  = cached["model"]
    except Exception as exc:
        return {"status": "error", "message": f"Gagal memuat model: {exc}"}

    try:
        explainer   = _shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X)

        # XGBClassifier binary: shap_values may be list[2] or single array
        if isinstance(shap_values, list):
            sv = np.array(shap_values[1])
        else:
            sv = np.array(shap_values)
        if sv.ndim == 3:          # (samples, features, classes) in some SHAP versions
            sv = sv[:, :, 1]

        base_val = explainer.expected_value
        if isinstance(base_val, (list, np.ndarray)):
            base_val = float(np.array(base_val).flat[-1])
        else:
            base_val = float(base_val)

        shap_row     = sv[0]
        feature_vals = X.values[0]

        contributions: list[dict] = []
        for i, feat in enumerate(feat_cols):
            sv_i = float(shap_row[i])
            fv_i = float(feature_vals[i])
            contributions.append({
                "feature"          : feat,
                "label"            : _FEATURE_LABELS.get(feat, feat),
                "feature_value"    : round(fv_i, 3),
                "shap_value"       : round(sv_i, 3),
                "abs_shap"         : round(abs(sv_i), 3),
                "direction"        : "meningkatkan_risiko" if sv_i > 0 else "menurunkan_risiko",
                "pct_contribution" : 0,
            })

        total_abs = sum(c["abs_shap"] for c in contributions)
        for c in contributions:
            c["pct_contribution"] = round(
                c["abs_shap"] / total_abs * 100 if total_abs > 0 else 0, 1
            )
        contributions.sort(key=lambda x: x["abs_shap"], reverse=True)

        pred_prob = float(model.predict_proba(X.values)[0][1])

        top_3           = contributions[:3]
        risk_factors    = [c for c in top_3 if c["direction"] == "meningkatkan_risiko"]
        protect_factors = [c for c in top_3 if c["direction"] == "menurunkan_risiko"]

        if risk_factors:
            narasi = "Risiko toko ini terutama didorong oleh: " + ", ".join(
                f"{c['label']} ({c['pct_contribution']}%)" for c in risk_factors
            )
        else:
            narasi = "Tidak ada faktor risiko dominan yang terdeteksi"
        if protect_factors:
            narasi += ". Faktor penjaga: " + ", ".join(c["label"] for c in protect_factors)

        return {
            "status"           : "ok",
            "id_toko"          : id_toko,
            "base_value"       : round(base_val, 3),
            "pred_probability" : round(pred_prob, 3),
            "contributions"    : contributions,
            "top_risk_factor"  : contributions[0]["label"] if contributions else None,
            "narasi"           : narasi,
            "total_features"   : len(feat_cols),
        }

    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@functools.lru_cache(maxsize=1)
def get_store_crs() -> pd.DataFrame:
    return compute_store_crs(load_data())

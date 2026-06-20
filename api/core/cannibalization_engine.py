"""
GMM-based cannibalization detector — Option C (brand-shift only).

GMM is trained on 4 brand-share shift features ONLY.
delta_total_volume_pct is computed but kept as a DESCRIPTIVE feature:
it is used post-hoc to distinguish kanibalisasi internal (volume stable)
from tekanan eksternal (volume drops), but does NOT enter gmm.fit().

Column names from transaksi_aegis_synthetic.parquet:
  date   : "Tanggal Transaksi"  (datetime)
  brand  : "Brands"             (ALL CAPS, e.g. "SEMEN ELANG")
  volume : "TON Quantity"       (float, tons)
  price  : "Harga"              (int, IDR per ZAK)
  qty    : "Zak Quantity"       (float, bags)
  store  : "ID Toko"            (string)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

# Features fed to GaussianMixture.fit()
CANNIBALIZATION_FEATURES = [
    "delta_elang_share",
    "delta_badak_share",
    "delta_banteng_share",
    "delta_harga_efektif_pct",
]

# Computed alongside training features but NOT used in GMM fitting.
# Used post-hoc to describe and distinguish cluster meaning.
DESCRIPTIVE_FEATURES = ["delta_total_volume_pct"]

_MODELS_DIR       = Path("api/data/models")
MODEL_CACHE_PATH  = _MODELS_DIR / "gmm_cannibalization.pkl"
SCALER_CACHE_PATH = _MODELS_DIR / "gmm_scaler.pkl"
RESULT_CACHE_PATH = _MODELS_DIR / "gmm_training_result.json"


# ── Feature engineering ────────────────────────────────────────────────────────

def _calc_shares(df_window: pd.DataFrame) -> pd.DataFrame:
    """Volume-share per brand + harga efektif per TON, indexed by ID Toko."""
    agg = (
        df_window.groupby(["ID Toko", "Brands"])["TON Quantity"]
        .sum()
        .unstack(fill_value=0)
    )
    total = agg.sum(axis=1)
    shares = agg.div(total, axis=0).fillna(0)

    result = pd.DataFrame(index=agg.index)
    result["elang_share"]   = shares.get("SEMEN ELANG",   pd.Series(0, index=agg.index))
    result["badak_share"]   = shares.get("SEMEN BADAK",   pd.Series(0, index=agg.index))
    result["banteng_share"] = shares.get("SEMEN BANTENG", pd.Series(0, index=agg.index))
    result["total_volume"]  = total

    # Revenue-weighted price per TON: sum(Harga × Zak) / sum(TON)
    rev = (df_window["Harga"] * df_window["Zak Quantity"]).groupby(
        df_window["ID Toko"]
    ).sum()
    vol = df_window.groupby("ID Toko")["TON Quantity"].sum()
    result["harga_efektif"] = rev / vol.replace(0, np.nan)

    return result


def compute_brand_shift_features(
    df_transaksi: pd.DataFrame, periode_akhir: str
) -> pd.DataFrame:
    """
    Rolling-window brand-shift feature computation.

    Compares recent 3 months vs prior 3 months per store.
    Returns a DataFrame with ID Toko + CANNIBALIZATION_FEATURES +
    DESCRIPTIVE_FEATURES (all 5 columns present).

    Only CANNIBALIZATION_FEATURES are fed to gmm.fit().
    DESCRIPTIVE_FEATURES are retained for post-hoc cluster description.
    """
    end_date            = pd.Timestamp(periode_akhir)
    window_recent_start = end_date            - relativedelta(months=3)
    window_prior_start  = window_recent_start - relativedelta(months=3)

    ts        = df_transaksi["Tanggal Transaksi"]
    df_recent = df_transaksi[(ts >= window_recent_start) & (ts <= end_date)]
    df_prior  = df_transaksi[(ts >= window_prior_start)  & (ts <  window_recent_start)]

    shares_recent = _calc_shares(df_recent)
    shares_prior  = _calc_shares(df_prior)

    common = shares_recent.index.intersection(shares_prior.index)
    if len(common) == 0:
        all_cols = ["ID Toko"] + CANNIBALIZATION_FEATURES + DESCRIPTIVE_FEATURES
        return pd.DataFrame(columns=all_cols)

    sr = shares_recent.loc[common]
    sp = shares_prior.loc[common]

    feats = pd.DataFrame(index=common)
    feats["delta_elang_share"]   = sr["elang_share"]   - sp["elang_share"]
    feats["delta_badak_share"]   = sr["badak_share"]   - sp["badak_share"]
    feats["delta_banteng_share"] = sr["banteng_share"] - sp["banteng_share"]

    feats["delta_harga_efektif_pct"] = (
        (sr["harga_efektif"] - sp["harga_efektif"])
        / sp["harga_efektif"].replace(0, np.nan)
    ).fillna(0) * 100

    # Descriptive only — not used in GMM fitting
    feats["delta_total_volume_pct"] = (
        (sr["total_volume"] - sp["total_volume"])
        / sp["total_volume"].replace(0, np.nan)
    ).fillna(0) * 100

    # Clip to 1st–99th percentile to suppress extreme outliers
    for col in CANNIBALIZATION_FEATURES + DESCRIPTIVE_FEATURES:
        lo = feats[col].quantile(0.01)
        hi = feats[col].quantile(0.99)
        feats[col] = feats[col].clip(lo, hi)

    return feats.reset_index()  # ID Toko becomes a column


# ── Model selection ────────────────────────────────────────────────────────────

def determine_optimal_clusters(
    X_scaled: np.ndarray, max_k: int = 8
) -> tuple[int, dict[int, float]]:
    """BIC-based optimal cluster count selection."""
    bic_scores: list[float] = []
    k_range = range(2, max_k + 1)

    for k in k_range:
        gmm = GaussianMixture(n_components=k, random_state=42, n_init=3)
        gmm.fit(X_scaled)
        bic_scores.append(gmm.bic(X_scaled))

    optimal_k = list(k_range)[int(np.argmin(bic_scores))]
    return optimal_k, dict(zip(k_range, bic_scores))


# ── Cluster interpretation ────────────────────────────────────────────────────

def _interpret_cluster(
    avg_elang: float,
    avg_badak: float,
    avg_banteng: float,
    avg_total_vol: float,
    median_total_vol: float,
    cluster_idx: int,
) -> tuple[str, str, str]:
    """
    Two-stage interpretation returning (label, category, risk_level).

    Condition priority order (matters for overlapping signals):
    1. Kanibalisasi  — Elang↓ + Badak↑
    2. De-Kanibalisasi — Elang↑ + Badak↓
    3. Fighting Brand — Banteng↑  ← checked BEFORE generic "Elang turun"
       so pola like (Elang-34pp, Banteng+28pp) is correctly labeled here
       instead of falling into the ambiguous "Elang Turun" branch
    4. Elang turun without Badak rising — ambiguous / external
    5. Stabil
    6. Campuran (fallback)
    """
    # 1 — Kanibalisasi
    if avg_elang < -0.015 and avg_badak > 0.01:
        if -8 < median_total_vol < 8:
            return (
                "Kanibalisasi Internal (Elang → Badak, Volume Stabil)",
                "kanibalisasi",
                "Rendah",
            )
        if median_total_vol < -8:
            return (
                "Kanibalisasi Sebagian + Tekanan Eksternal (Volume Ikut Turun)",
                "kanibalisasi_sebagian_eksternal",
                "Sedang",
            )
        return (
            "Kanibalisasi Internal + Growth (Volume Naik)",
            "kanibalisasi",
            "Rendah",
        )

    # 2 — De-Kanibalisasi (Elang reclaims share from Badak — positive signal)
    if avg_elang > 0.015 and avg_badak < -0.01:
        return (
            "De-Kanibalisasi / Pemulihan Elang (Badak → Elang)",
            "de_kanibalisasi",
            "Tidak Ada",
        )

    # 3 — Fighting Brand (checked before "Elang turun" to catch mixed cases
    #     where Elang AND Badak both lose share to Banteng)
    if avg_banteng > 0.015:
        return "Pergeseran ke Fighting Brand", "fighting_brand_shift", "Sedang"

    # 4 — Elang down but Badak not absorbing it
    if avg_elang < -0.015 and avg_badak <= 0.01:
        if median_total_vol < -5:
            return (
                "Tekanan Eksternal (Volume Hilang, Bukan Kanibalisasi)",
                "tekanan_eksternal",
                "Tinggi",
            )
        return (
            "Elang Turun — Penyebab Tidak Jelas (Perlu Investigasi)",
            "perlu_investigasi",
            "Sedang",
        )

    # 5 — Stable
    if abs(avg_elang) < 0.01 and abs(avg_badak) < 0.01 and abs(avg_banteng) < 0.01:
        return "Stabil / Normal", "stabil", "Tidak Ada"

    # 6 — Fallback
    return f"Pola Campuran #{cluster_idx}", "campuran", "Perlu Investigasi"


# ── Training ──────────────────────────────────────────────────────────────────

def train_cannibalization_gmm(
    df_transaksi: pd.DataFrame, periode_akhir: str
) -> dict:
    """
    Full training pipeline (Option C):
    1. Compute all 5 features per store
    2. Standardize ONLY the 4 brand-shift features
    3. BIC-select optimal k, fit GaussianMixture on 4 features
    4. Use delta_total_volume_pct post-hoc (median per cluster) for labeling
    5. Persist model + JSON result cache
    """
    import joblib

    features_df = compute_brand_shift_features(df_transaksi, periode_akhir)

    if len(features_df) < 50:
        return {
            "status": "error",
            "message": f"Data tidak cukup: hanya {len(features_df)} toko (minimum 50).",
        }

    # ── Fit GMM on 4 brand-shift features only ────────────────────────────
    X        = features_df[CANNIBALIZATION_FEATURES].values
    scaler   = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    optimal_k, bic_raw = determine_optimal_clusters(X_scaled)

    gmm    = GaussianMixture(n_components=optimal_k, random_state=42, n_init=5)
    gmm.fit(X_scaled)

    labels = gmm.predict(X_scaled)
    probs  = gmm.predict_proba(X_scaled)

    features_df = features_df.copy()
    features_df["cluster"] = labels
    for i in range(optimal_k):
        features_df[f"prob_cluster_{i}"] = probs[:, i]

    # ── Interpret each cluster — volume used as post-hoc descriptor ───────
    cluster_interpretations: dict[str, dict] = {}
    for c in range(optimal_k):
        cdata = features_df[features_df["cluster"] == c]

        avg_elang   = float(cdata["delta_elang_share"].mean())
        avg_badak   = float(cdata["delta_badak_share"].mean())
        avg_banteng = float(cdata["delta_banteng_share"].mean())
        avg_vol     = float(cdata["delta_total_volume_pct"].mean())
        med_vol     = float(cdata["delta_total_volume_pct"].median())

        label, category, risk = _interpret_cluster(
            avg_elang, avg_badak, avg_banteng, avg_vol, med_vol, c
        )

        cluster_interpretations[str(c)] = {
            "label":                          label,
            "category":                       category,
            "risk_level":                     risk,
            "jumlah_toko":                    int(len(cdata)),
            "avg_delta_elang_share":          round(avg_elang, 4),
            "avg_delta_badak_share":          round(avg_badak, 4),
            "avg_delta_banteng_share":        round(avg_banteng, 4),
            "avg_delta_harga_efektif_pct":    round(float(cdata["delta_harga_efektif_pct"].mean()), 2),
            # Volume: descriptive only, median is the primary discriminator
            "avg_delta_total_volume_pct":     round(avg_vol, 2),
            "median_delta_total_volume_pct":  round(med_vol, 2),
        }

    # ── Validation summary (exact category matching — no substring bugs) ──
    def _toko_sum(keys: list[str]) -> int:
        return sum(cluster_interpretations[c]["jumlah_toko"] for c in keys)

    kani_clusters    = [c for c, i in cluster_interpretations.items()
                        if i["category"] == "kanibalisasi"]
    dekani_clusters  = [c for c, i in cluster_interpretations.items()
                        if i["category"] == "de_kanibalisasi"]
    ext_clusters     = [c for c, i in cluster_interpretations.items()
                        if i["category"] == "tekanan_eksternal"]
    fb_clusters      = [c for c, i in cluster_interpretations.items()
                        if i["category"] == "fighting_brand_shift"]

    validation_summary = {
        "kanibalisasi_clusters_found":       len(kani_clusters),
        "kanibalisasi_total_toko":           _toko_sum(kani_clusters),
        "de_kanibalisasi_clusters_found":    len(dekani_clusters),
        "de_kanibalisasi_total_toko":        _toko_sum(dekani_clusters),
        "tekanan_eksternal_clusters_found":  len(ext_clusters),
        "tekanan_eksternal_total_toko":      _toko_sum(ext_clusters),
        "fighting_brand_clusters_found":     len(fb_clusters),
        "fighting_brand_total_toko":         _toko_sum(fb_clusters),
    }

    # ── Persist ───────────────────────────────────────────────────────────
    prob_cols = [f"prob_cluster_{i}" for i in range(optimal_k)]
    store_assignments = (
        features_df[["ID Toko", "cluster"] + prob_cols]
        .assign(cluster=lambda d: d["cluster"].astype(int))
        .to_dict("records")
    )

    result = {
        "status":                  "ok",
        "optimal_k":               optimal_k,
        "bic_scores":              {str(k): round(v, 2) for k, v in bic_raw.items()},
        "cluster_interpretations": cluster_interpretations,
        "validation_summary":      validation_summary,
        "store_assignments":       store_assignments,
        "trained_at":              pd.Timestamp.now().isoformat(),
        "periode_akhir":           periode_akhir,
        "total_toko_dianalisis":   int(len(features_df)),
        "gmm_features_used":       CANNIBALIZATION_FEATURES,
        "descriptive_features":    DESCRIPTIVE_FEATURES,
    }

    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(gmm,    MODEL_CACHE_PATH)
    joblib.dump(scaler, SCALER_CACHE_PATH)
    RESULT_CACHE_PATH.write_text(
        json.dumps(result, ensure_ascii=False), encoding="utf-8"
    )

    return result


# ── Query helpers ──────────────────────────────────────────────────────────────

def load_cached_result() -> dict | None:
    if not RESULT_CACHE_PATH.exists():
        return None
    try:
        return json.loads(RESULT_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_store_cannibalization_status(id_toko: str, training_result: dict) -> dict:
    store_data = next(
        (s for s in training_result["store_assignments"] if s["ID Toko"] == id_toko),
        None,
    )
    if not store_data:
        return {"status": "not_found", "id_toko": id_toko}

    cluster_id = str(store_data["cluster"])
    interp     = training_result["cluster_interpretations"][cluster_id]
    k          = training_result["optimal_k"]

    all_probs = {
        training_result["cluster_interpretations"][str(i)]["label"]: round(
            float(store_data.get(f"prob_cluster_{i}", 0)), 3
        )
        for i in range(k)
    }

    return {
        "status":            "ok",
        "id_toko":           id_toko,
        "cluster_label":     interp["label"],
        "category":          interp["category"],
        "risk_level":        interp["risk_level"],
        "confidence":        round(float(store_data.get(f"prob_cluster_{cluster_id}", 0)), 3),
        "all_probabilities": all_probs,
    }


def get_all_stores_cannibalization_summary(training_result: dict) -> dict:
    interpretations = training_result["cluster_interpretations"]

    summary_by_risk: dict[str, dict] = {}
    for interp in interpretations.values():
        risk = interp["risk_level"]
        if risk not in summary_by_risk:
            summary_by_risk[risk] = {"jumlah_toko": 0, "clusters": []}
        summary_by_risk[risk]["jumlah_toko"] += interp["jumlah_toko"]
        summary_by_risk[risk]["clusters"].append(interp["label"])

    return {
        "total_toko":             training_result["total_toko_dianalisis"],
        "jumlah_cluster":         training_result["optimal_k"],
        "periode_akhir":          training_result.get("periode_akhir", ""),
        "trained_at":             training_result.get("trained_at", ""),
        "validation_summary":     training_result.get("validation_summary", {}),
        "summary_by_risk_level":  summary_by_risk,
        "cluster_details":        list(interpretations.values()),
        "gmm_features_used":      training_result.get("gmm_features_used", CANNIBALIZATION_FEATURES),
        "descriptive_features":   training_result.get("descriptive_features", DESCRIPTIVE_FEATURES),
    }

"""
Causal ML Engine — DoWhy + EconML.

Menjawab: "Berapa dampak KAUSAL program loyalty terhadap volume toko,
setelah dikontrol faktor cluster, historical volume, dan aktivitas toko?"

Design: Panel event-time Diff-in-Diff (DiD), bukan cross-sectional.
loyalty_members.json (regenerasi 2026-06-20) punya tgl_masuk tersebar
nyata Jan 2024 - Mar 2026, jadi setiap toko treated punya window
SEBELUM dan SESUDAH tgl_masuk-nya sendiri untuk dibandingkan.

  Treated : tgl_masuk = event date sungguhan dari loyalty_members.json
  Control : toko yang tidak pernah ikut program, diberi pseudo-event-date
            yang di-sample dari distribusi empiris tgl_masuk treated
            (stacked-cohort DiD — setiap control "meniru" kalender salah
            satu cohort treated, supaya tren pasar di periode yang sama
            ikut terpotret di kedua grup → parallel trends lebih valid
            dibanding kontrol acak lintas waktu).

  Window  : pre  = 3 bulan kalender penuh SEBELUM bulan tgl_masuk
            post = 1 bulan kalender penuh SESUDAH bulan tgl_masuk
            (bulan tgl_masuk sendiri dilewati supaya tidak tercampur
            sebagian pre/sebagian post)
            Toko yang pre/post window-nya keluar dari rentang data
            (mepet ke awal Jan 2024 atau akhir Apr 2026) dikeluarkan.

  Outcome : diff_outcome = log1p(post_elang_vol) - log1p(pre_avg_elang_vol)
            ("long difference" dalam log — ini ADALAH estimator DiD;
            regresi diff_outcome ~ treatment + confounders pada DoWhy
            setara dengan DiD-with-covariates / conditional DiD)

  Confounders (dihitung dari window PRE saja, bukan kalender tetap):
      - log_hist_avg_vol : log1p rata-rata volume total (semua brand) pre
      - hist_elang_share : proporsi Elang dari total volume pre
      - n_months_active  : jumlah bulan pre dengan transaksi > 0 (0-3)
      - cluster_ordinal  : urutan Cluster Pareto (Bronze→Super Platinum)

  ATE   : DoWhy backdoor linear regression pada diff_outcome (= conditional
          DiD ATT) + refutation test (random common cause)
  Naive DiD: pembanding tanpa kontrol confounder, mean(diff treated) -
          mean(diff control) — untuk sanity-check seberapa besar peran
          confounder adjustment
  CATE  : EconML CausalForestDML pada diff_outcome yang sama, jadi
          heterogeneous treatment effect-nya juga dalam skala DiD
          (bukan cross-sectional snapshot lagi)
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

CAUSAL_RESULT_CACHE = Path("api/data/models/causal_training_result.json")

PRE_MONTHS  = 3   # bulan kalender penuh sebelum tgl_masuk untuk baseline
POST_MONTHS = 1   # bulan kalender penuh sesudah tgl_masuk untuk outcome

CLUSTER_ORDER: dict[str, int] = {
    "Bronze": 1, "Silver": 2, "Gold": 3,
    "Platinum": 4, "Super Platinum": 5,
}


# ── Dataset preparation ────────────────────────────────────────────────────────

def prepare_causal_panel_dataset(
    df_transaksi: pd.DataFrame,
    loyalty_members: list[dict],
    control_multiplier: int = 10,
    seed: int = 42,
) -> tuple[pd.DataFrame, dict]:
    """
    Bangun panel event-time: 1 baris per toko (treated atau control),
    dengan outcome = perubahan volume ELANG dari window pre ke window post
    relatif terhadap tanggal event toko itu sendiri (tgl_masuk untuk
    treated, pseudo-date untuk control).

    Return (df_panel, meta) — meta berisi info exclusion untuk transparansi.
    """
    df = df_transaksi.copy()
    df["_p"] = df["Tanggal Transaksi"].dt.to_period("M")
    data_start_p = df["_p"].min()
    data_end_p   = df["_p"].max()

    total_dict = df.groupby(["ID Toko", "_p"])["TON Quantity"].sum().to_dict()
    elang_dict = (
        df[df["Brands"] == "SEMEN ELANG"]
        .groupby(["ID Toko", "_p"])["TON Quantity"].sum()
        .to_dict()
    )
    cluster_latest = df.groupby("ID Toko")["Cluster Pareto"].last().to_dict()
    known_ids = set(df["ID Toko"].unique())

    def _is_valid_event(m0: pd.Period) -> bool:
        return (m0 - PRE_MONTHS) >= data_start_p and (m0 + POST_MONTHS) <= data_end_p

    def _build_row(id_toko: str, event_period: pd.Period, treatment: int) -> dict:
        pre_periods = [event_period - i for i in range(PRE_MONTHS, 0, -1)]
        post_period = event_period + POST_MONTHS

        elang_pre = [elang_dict.get((id_toko, p), 0.0) for p in pre_periods]
        total_pre = [total_dict.get((id_toko, p), 0.0) for p in pre_periods]
        post_elang = float(elang_dict.get((id_toko, post_period), 0.0))

        pre_avg_elang = float(np.mean(elang_pre))
        pre_avg_total = float(np.mean(total_pre))
        sum_total_pre = float(np.sum(total_pre))
        hist_elang_share = (float(np.sum(elang_pre)) / sum_total_pre) if sum_total_pre > 0 else 0.0
        n_months_active = int(sum(v > 0 for v in total_pre))

        cluster = cluster_latest.get(id_toko, "Bronze")

        return {
            "id_toko":           id_toko,
            "event_period":      str(event_period),
            "treatment":         treatment,
            "pre_avg_elang_vol": pre_avg_elang,
            "post_elang_vol":    post_elang,
            "hist_avg_vol":      pre_avg_total,
            "hist_elang_share":  hist_elang_share,
            "n_months_active":   n_months_active,
            "cluster_pareto":    cluster,
            "cluster_ordinal":   CLUSTER_ORDER.get(cluster, 1),
        }

    # ── Treated: tgl_masuk sungguhan dari loyalty_members ──────────────────
    treated_rows: list[dict] = []
    excluded_treated: list[dict] = []

    for m in loyalty_members:
        id_toko = m.get("id_toko")
        tgl_masuk = m.get("tgl_masuk")
        if not id_toko or not tgl_masuk:
            continue
        try:
            m0 = pd.to_datetime(tgl_masuk).to_period("M")
        except Exception:
            continue

        if id_toko not in known_ids:
            excluded_treated.append({
                "id_toko": id_toko, "tgl_masuk": tgl_masuk,
                "reason": "toko tidak ditemukan di data transaksi yang dipakai training",
            })
            continue

        if not _is_valid_event(m0):
            excluded_treated.append({
                "id_toko": id_toko, "tgl_masuk": tgl_masuk,
                "reason": f"window pre({PRE_MONTHS}bln)/post({POST_MONTHS}bln) "
                          f"keluar dari rentang data [{data_start_p}, {data_end_p}]",
            })
            continue

        treated_rows.append(_build_row(id_toko, m0, treatment=1))

    if not treated_rows:
        meta = {
            "n_treated_input": len(loyalty_members), "n_treated_valid": 0,
            "n_treated_excluded": len(excluded_treated), "excluded_detail": excluded_treated,
            "n_control": 0, "data_start": str(data_start_p), "data_end": str(data_end_p),
            "pre_months": PRE_MONTHS, "post_months": POST_MONTHS,
        }
        return pd.DataFrame(), meta

    # ── Control: toko tak pernah ikut program, pseudo-date dari distribusi
    #    empiris event_period treated (stacked-cohort DiD) ─────────────────
    treated_ids = {m.get("id_toko") for m in loyalty_members}
    all_ids = df["ID Toko"].unique()
    control_pool = np.array([i for i in all_ids if i not in treated_ids])

    rng = np.random.default_rng(seed)
    n_target_control = min(len(control_pool), len(treated_rows) * control_multiplier)
    sampled_control_ids = rng.choice(control_pool, size=n_target_control, replace=False)

    treated_event_periods = [r["event_period"] for r in treated_rows]
    pseudo_period_strs = rng.choice(treated_event_periods, size=n_target_control, replace=True)

    control_rows = [
        _build_row(cid, pd.Period(pp, "M"), treatment=0)
        for cid, pp in zip(sampled_control_ids, pseudo_period_strs)
    ]

    df_panel = pd.DataFrame(treated_rows + control_rows)

    df_panel["log_pre_elang"]    = np.log1p(df_panel["pre_avg_elang_vol"])
    df_panel["log_post_elang"]   = np.log1p(df_panel["post_elang_vol"])
    df_panel["diff_outcome"]     = df_panel["log_post_elang"] - df_panel["log_pre_elang"]
    df_panel["log_hist_avg_vol"] = np.log1p(df_panel["hist_avg_vol"])

    meta = {
        "n_treated_input":    len(loyalty_members),
        "n_treated_valid":    len(treated_rows),
        "n_treated_excluded": len(excluded_treated),
        "excluded_detail":    excluded_treated,
        "n_control":          len(control_rows),
        "data_start":         str(data_start_p),
        "data_end":           str(data_end_p),
        "pre_months":         PRE_MONTHS,
        "post_months":        POST_MONTHS,
    }

    return df_panel.reset_index(drop=True), meta


# ── Causal estimation ──────────────────────────────────────────────────────────

def estimate_causal_effect(df_panel: pd.DataFrame, meta: dict) -> dict:
    """
    Estimasi ATT (DoWhy backdoor linear regression pada diff_outcome =
    conditional DiD) + naive DiD pembanding + CATE per toko (EconML
    CausalForestDML, juga pada diff_outcome — bukan snapshot cross-sectional).
    """
    from dowhy import CausalModel
    from econml.dml import CausalForestDML
    from sklearn.ensemble import (
        GradientBoostingRegressor, RandomForestClassifier,
    )

    t0 = time.time()

    CONFOUNDERS = [
        "log_hist_avg_vol",
        "hist_elang_share",
        "n_months_active",
        "cluster_ordinal",
    ]

    # ── Naive DiD (tanpa adjustment confounder) — pembanding ───────────────
    naive_treated = float(df_panel.loc[df_panel["treatment"] == 1, "diff_outcome"].mean())
    naive_control = float(df_panel.loc[df_panel["treatment"] == 0, "diff_outcome"].mean())
    att_naive_log = naive_treated - naive_control
    att_naive_pct = round(float(np.expm1(att_naive_log)) * 100, 1)

    # ── DoWhy: ATT via regresi diff_outcome ~ treatment + confounders ──────
    # (ini setara estimator DiD-with-covariates / conditional DiD karena
    #  outcome-nya sendiri sudah long-difference post-pre per toko)
    logger.info("[causal] Estimating ATT via DoWhy backdoor (DiD on diff_outcome)...")

    causal_model = CausalModel(
        data=df_panel,
        treatment="treatment",
        outcome="diff_outcome",
        common_causes=CONFOUNDERS,
    )

    identified_estimand = causal_model.identify_effect(
        proceed_when_unidentifiable=True
    )

    estimate = causal_model.estimate_effect(
        identified_estimand,
        method_name="backdoor.linear_regression",
        target_units="ate",
    )

    ate_log = float(estimate.value)
    ate_pct = round(float(np.expm1(ate_log)) * 100, 1)

    # Approximate level effect: pakai median baseline ELANG toko treated
    # (pre-period, di antara yang punya histori ELANG > 0) sebagai skala ton.
    treated_pre = df_panel.loc[
        (df_panel["treatment"] == 1) & (df_panel["pre_avg_elang_vol"] > 0),
        "pre_avg_elang_vol",
    ]
    baseline_elang = float(treated_pre.median()) if len(treated_pre) > 0 else 0.0
    ate_level_approx = round(baseline_elang * float(np.expm1(ate_log)), 1)

    # ── Refutation ───────────────────────────────────────────────────────────
    logger.info("[causal] Running refutation test...")
    refutation = causal_model.refute_estimate(
        identified_estimand,
        estimate,
        method_name="random_common_cause",
        random_seed=42,
    )

    ref_new_effect    = float(refutation.new_effect)
    ref_delta         = abs(ref_new_effect - ate_log)
    ref_threshold     = abs(ate_log * 0.30)
    refutation_passed = ref_delta < ref_threshold

    # ── EconML: CATE per toko (CausalForestDML pada diff_outcome) ──────────
    logger.info("[causal] Fitting CausalForestDML for CATE...")

    X = df_panel[CONFOUNDERS].values.astype(float)
    T = df_panel["treatment"].values.astype(float)
    Y = df_panel["diff_outcome"].values.astype(float)

    logger.info(
        f"[causal] Panel fit dataset: {len(T)} obs "
        f"({int(T.sum())} treated, propensity={T.mean():.3f})"
    )

    causal_forest = CausalForestDML(
        model_y=GradientBoostingRegressor(n_estimators=100, max_depth=4, random_state=42),
        model_t=RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42),
        discrete_treatment=True,
        n_estimators=200,
        min_samples_leaf=10,
        random_state=42,
        verbose=0,
    )
    causal_forest.fit(Y, T, X=X)

    cate_log_per_row = causal_forest.effect(X).flatten()

    df_panel = df_panel.copy()
    df_panel["cate_log"] = cate_log_per_row
    # Level effect per toko: skala dari baseline ELANG toko itu sendiri
    df_panel["cate_level"] = (
        np.expm1(df_panel["cate_log"]) * df_panel["pre_avg_elang_vol"]
    )

    ate_forest = float(np.median(cate_log_per_row))

    cate_per_toko = (
        df_panel.set_index("id_toko")[["cate_log", "cate_level"]]
        .apply(lambda col: col.round(4))
        .to_dict("index")
    )

    cate_log_vals   = df_panel["cate_log"].values
    cate_level_vals = df_panel["cate_level"].values

    n_above_ate = int((cate_log_vals > ate_log).sum())
    n_below_ate = int((cate_log_vals <= ate_log).sum())
    n_negative  = int((cate_log_vals < 0).sum())

    elapsed = round(time.time() - t0, 1)
    logger.info(f"[causal] Training selesai dalam {elapsed}s")

    return {
        "status": "ok",
        "design": "panel_event_time_did",
        "window": {"pre_months": meta["pre_months"], "post_months": meta["post_months"]},
        "sample": {
            "n_treated_input":    meta["n_treated_input"],
            "n_treated_valid":    meta["n_treated_valid"],
            "n_treated_excluded": meta["n_treated_excluded"],
            "n_control":          meta["n_control"],
            "data_range":         f"{meta['data_start']} – {meta['data_end']}",
        },
        # Naive DiD (tanpa confounder adjustment) — pembanding
        "att_naive_log": round(att_naive_log, 4),
        "att_naive_pct": att_naive_pct,
        # DoWhy: conditional DiD (ATT teradjustasi confounder)
        "ate_log":          round(ate_log, 4),
        "ate_pct":          ate_pct,
        "ate_level_approx": ate_level_approx,
        "ate_interpretation": (
            f"Program loyalty diestimasi (conditional DiD) mengubah volume SEMEN ELANG "
            f"toko sebesar {ate_pct:+.1f}% dari baseline pre-enrollment-nya sendiri "
            f"({ate_level_approx:+.1f} ton/bulan dari baseline ~{baseline_elang:.1f} ton), "
            f"setelah dikontrol confounder (cluster, baseline volume, aktivitas). "
            f"Pembanding naive DiD (tanpa adjustment): {att_naive_pct:+.1f}%."
        ),
        # Refutation
        "refutation_passed": refutation_passed,
        "refutation_detail": {
            "original_effect_log": round(ate_log, 4),
            "refuted_effect_log":  round(ref_new_effect, 4),
            "delta":               round(ref_delta, 4),
            "threshold_30pct":     round(ref_threshold, 4),
            "verdict": (
                "PASSED — hasil estimasi robust terhadap penambahan variabel acak."
                if refutation_passed else
                "FAILED — estimasi sensitif terhadap variabel tidak teramati."
                " Gunakan hasil dengan hati-hati."
            ),
        },
        # EconML: median CATE dari CausalForestDML (robust vs mean yang sensitif outlier)
        "ate_forest_log": round(ate_forest, 4),
        "ate_forest_pct": round(float(np.expm1(ate_forest)) * 100, 1),
        # CATE distribution
        "cate_distribution": {
            "n_toko_total":          int(len(df_panel)),
            "n_above_ate":           n_above_ate,
            "n_below_ate":           n_below_ate,
            "n_negative_effect":     n_negative,
            "median_cate_log":       round(float(np.median(cate_log_vals)), 4),
            "p25_cate_log":          round(float(np.percentile(cate_log_vals, 25)), 4),
            "p75_cate_log":          round(float(np.percentile(cate_log_vals, 75)), 4),
            "min_cate_log":          round(float(cate_log_vals.min()), 4),
            "max_cate_log":          round(float(cate_log_vals.max()), 4),
            "median_cate_level_ton": round(float(np.median(cate_level_vals)), 1),
        },
        # Per-toko CATE (untuk endpoint store)
        "cate_per_toko": {
            k: {"cate_log": v["cate_log"], "cate_level": v["cate_level"]}
            for k, v in cate_per_toko.items()
        },
        # Meta
        "trained_at":       pd.Timestamp.now().isoformat(),
        "n_observations":   int(len(df_panel)),
        "n_treated":        int(df_panel["treatment"].sum()),
        "n_control":        int((df_panel["treatment"] == 0).sum()),
        "n_excluded":       meta["n_treated_excluded"],
        "confounders_used": CONFOUNDERS,
        "training_seconds": elapsed,
        "method_note": (
            "Panel event-time Diff-in-Diff. Treated: tgl_masuk sungguhan dari "
            "loyalty_members.json. Control: toko tak pernah ikut program, diberi "
            "pseudo-event-date di-sample dari distribusi empiris tgl_masuk treated "
            "(stacked-cohort DiD). Outcome = log1p(post_elang_vol) - "
            f"log1p(pre_avg_elang_vol) (pre={meta['pre_months']}bln, post={meta['post_months']}bln "
            "kalender penuh, bulan tgl_masuk dilewati). ATE dari DoWhy linear regression "
            "(backdoor identification) pada diff_outcome = conditional DiD ATT. "
            "CATE dari EconML CausalForestDML pada diff_outcome yang sama. "
            "Toko dengan window pre/post di luar rentang data dikeluarkan dari sampel."
        ),
    }


# ── Training entry point ───────────────────────────────────────────────────────

def train_and_cache_causal_model(
    df_transaksi: pd.DataFrame,
    loyalty_members: list[dict],
) -> dict:
    """Entry point utama: siapkan panel DiD, estimasi, simpan ke cache JSON."""
    df_panel, meta = prepare_causal_panel_dataset(df_transaksi, loyalty_members)

    n_treated_valid = meta["n_treated_valid"]

    if n_treated_valid < 20:
        return {
            "status": "error",
            "message": (
                f"Terlalu sedikit toko treated dengan window pre/post valid: "
                f"{n_treated_valid} dari {meta['n_treated_input']} input "
                f"(minimum 20). {meta['n_treated_excluded']} toko dikeluarkan "
                f"karena window di luar rentang data [{meta['data_start']}, {meta['data_end']}]."
            ),
        }

    n_obs = len(df_panel)
    if n_obs < 100:
        return {
            "status": "error",
            "message": f"Data tidak cukup: {n_obs} observasi total (minimum 100).",
        }

    result = estimate_causal_effect(df_panel, meta)

    CAUSAL_RESULT_CACHE.parent.mkdir(parents=True, exist_ok=True)
    CAUSAL_RESULT_CACHE.write_text(
        json.dumps(result, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    logger.info(f"[causal] Cache tersimpan → {CAUSAL_RESULT_CACHE}")

    return result


# ── Query helpers ──────────────────────────────────────────────────────────────

def load_causal_results() -> dict | None:
    if not CAUSAL_RESULT_CACHE.exists():
        return None
    try:
        return json.loads(CAUSAL_RESULT_CACHE.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_store_causal_effect(id_toko: str, causal_result: dict) -> dict:
    """CATE untuk satu toko, dengan interpretasi kontekstual."""
    if causal_result is None:
        return {"status": "not_available"}

    per_toko = causal_result.get("cate_per_toko", {})
    entry    = per_toko.get(id_toko)
    if entry is None:
        return {"status": "not_found", "id_toko": id_toko}

    cate_log   = entry["cate_log"]
    cate_level = entry["cate_level"]
    ate_log    = causal_result["ate_log"]
    ate_pct    = causal_result["ate_pct"]
    cate_pct   = round(np.expm1(cate_log) * 100, 1)

    vs_avg = "di atas rata-rata platform" if cate_log > ate_log else "di bawah rata-rata platform"

    return {
        "status":        "ok",
        "id_toko":       id_toko,
        "cate_log":      round(cate_log, 4),
        "cate_pct":      cate_pct,
        "cate_level_ton": round(cate_level, 1),
        "ate_pct_platform": ate_pct,
        "vs_average":    vs_avg,
        "interpretation": (
            f"Program loyalty diestimasi mengubah volume SEMEN ELANG toko ini "
            f"sebesar {cate_pct:+.1f}% dari baseline pre-enrollment-nya sendiri "
            f"({vs_avg}: rata-rata platform {ate_pct:+.1f}%). "
            f"Nilai positif berarti toko merespons program lebih baik dari rata-rata; "
            f"nilai negatif berarti toko mungkin membutuhkan pendekatan insentif berbeda."
        ),
    }


def get_summary(causal_result: dict) -> dict:
    """Ringkasan untuk dashboard — tanpa per-toko detail."""
    if causal_result is None:
        return {"status": "not_available"}

    excl_keys = {"cate_per_toko"}
    return {k: v for k, v in causal_result.items() if k not in excl_keys}

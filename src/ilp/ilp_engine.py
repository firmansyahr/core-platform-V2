import pandas as pd
import numpy as np
import streamlit as st
from scipy.stats import spearmanr

REWARD = {"SEMEN ELANG": 5_000, "SEMEN BADAK": 2_500}  # Rp/ton
ILP_MONTHS = 6       # months used for feature computation
_MAX_CANDIDATES = 3_000  # solver input cap for performance


def _ilp_mask(df: pd.DataFrame) -> pd.Series:
    """Boolean mask: SEMEN ELANG or SEMEN BADAK SERBAGUNA."""
    elang = df["Brands"] == "SEMEN ELANG"
    badak = (df["Brands"] == "SEMEN BADAK") & (
        df["Nama Produk"].str.upper()
        .str.replace(" ", "", regex=False)
        .str.contains("SERBAGUNA", na=False)
    )
    return elang | badak


@st.cache_data
def compute_ilp_scores(df: pd.DataFrame) -> pd.DataFrame:
    """
    Per-store ILP scoring using Spearman-weighted composite of:
      Ratio_vs_Cluster, Avg_Trx (monthly transaction count), Ton_Growth.

    Weights = max(0, Spearman corr of each feature with avg monthly ILP ton).
    Score is percentile-rank composite scaled to 0–100.
    Also computes estimated annual incentive cost per store.
    """
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()
    window_periods = [latest - i for i in range(ILP_MONTHS)]

    ilp = _ilp_mask(df)
    win = df[period_col.isin(window_periods) & ilp].copy()
    win["_period"] = period_col[win.index]
    win["_brand"]  = win["Brands"].map({"SEMEN ELANG": "elang"}).fillna("badak")

    if win.empty:
        return pd.DataFrame()

    # ── Monthly aggregates per store ─────────────────────────────────────────
    monthly = (win.groupby(["ID Toko", "_period"])
               .agg(ton=("TON Quantity", "sum"), trx=("No Transaksi", "nunique"))
               .reset_index())

    stores = monthly.groupby("ID Toko").agg(
        avg_ton=("ton", "mean"),
        avg_trx=("trx", "mean"),
    )

    # ── Ton growth: last 3m vs previous 3m ───────────────────────────────────
    recent_p = [latest - i for i in range(3)]
    early_p  = [latest - i for i in range(3, 6)]

    def _period_sum(ps):
        return (win[win["_period"].isin(ps)]
                .groupby("ID Toko")["TON Quantity"].sum()
                .reindex(stores.index, fill_value=0))

    recent_sum = _period_sum(recent_p)
    early_sum  = _period_sum(early_p)
    stores["ton_growth"] = (recent_sum - early_sum) / early_sum.clip(lower=1) * 100

    # ── Store metadata & ratio vs cluster ────────────────────────────────────
    meta_cols = ["ID Toko", "Nama Toko", "Kabupaten Toko",
                 "Provinsi Toko", "Cluster Pareto", "TSO", "SSM", "ASM"]
    store_meta = (df.sort_values("Tanggal Transaksi", ascending=False)
                  [meta_cols].drop_duplicates("ID Toko").set_index("ID Toko"))
    stores = stores.join(store_meta, how="left")

    cluster_med = stores.groupby("Cluster Pareto")["avg_ton"].median()
    stores["ratio_vs_cluster"] = (
        stores["avg_ton"] /
        stores["Cluster Pareto"].map(cluster_med).clip(lower=0.01)
    )

    # ── Spearman-weighted composite score ────────────────────────────────────
    feats  = ["ratio_vs_cluster", "avg_trx", "ton_growth"]
    target = stores["avg_ton"]
    raw_w  = {}
    for f in feats:
        corr, _ = spearmanr(stores[f].fillna(0), target, nan_policy="omit")
        raw_w[f] = max(float(corr), 0.0)
    total_w = sum(raw_w.values()) or 1.0

    stores["score"] = (
        sum((raw_w[f] / total_w) * stores[f].fillna(0).rank(pct=True)
            for f in feats) * 100
    )

    # ── Per-brand monthly avg TON → estimated annual cost ────────────────────
    brand_mon = (
        win.groupby(["ID Toko", "_brand", "_period"])["TON Quantity"].sum()
        .groupby(["ID Toko", "_brand"]).mean()
        .unstack("_brand", fill_value=0)
        .reindex(columns=["elang", "badak"], fill_value=0)
        .reindex(stores.index, fill_value=0)
    )
    stores["estimated_cost"] = (
        brand_mon["elang"] * REWARD["SEMEN ELANG"] +
        brand_mon["badak"] * REWARD["SEMEN BADAK"]
    ) * 12

    # ── Brand category ────────────────────────────────────────────────────────
    has_e = brand_mon["elang"] > 0
    has_b = brand_mon["badak"] > 0
    stores["brand_category"] = "Companion Only"
    stores.loc[has_e,            "brand_category"] = "Main Only"
    stores.loc[has_e & has_b,    "brand_category"] = "Mix"

    return stores.reset_index()


def solve_ilp(
    scores_df: pd.DataFrame,
    budget: float = 0,
    n_max: int = 0,
    max_frac_sp: float = 0.0,
    max_frac_plat: float = 0.0,
    max_frac_gold: float = 0.0,
    max_frac_silver: float = 0.0,
    max_frac_bronze: float = 0.0,
    max_frac_prov: float = 0.0,
) -> tuple[pd.DataFrame, str]:
    """
    Binary ILP: maximize Σ(score × x) subject to optional constraints.
    budget=0 / n_max=0 / max_frac_*=0.0 means that constraint is skipped.
    max_frac_* are proportions of total stores selected (e.g. 0.2 = max 20%).
    """
    df = scores_df[scores_df["estimated_cost"] > 0].copy()
    if df.empty:
        return pd.DataFrame(columns=scores_df.columns), "Tidak ada kandidat"

    cand   = df.nlargest(min(len(df), _MAX_CANDIDATES), "score").reset_index(drop=True)
    n      = len(cand)
    scores = cand["score"].tolist()
    costs  = cand["estimated_cost"].tolist()

    idx_sp     = cand.index[cand["Cluster Pareto"] == "Super Platinum"].tolist()
    idx_plat   = cand.index[cand["Cluster Pareto"] == "Platinum"].tolist()
    idx_gold   = cand.index[cand["Cluster Pareto"] == "Gold"].tolist()
    idx_silver = cand.index[cand["Cluster Pareto"] == "Silver"].tolist()
    idx_bronze = cand.index[cand["Cluster Pareto"] == "Bronze"].tolist()

    prov_groups = {
        p: grp.index.tolist()
        for p, grp in cand.groupby("Provinsi Toko", sort=False)
    }

    try:
        from pulp import LpProblem, LpMaximize, LpVariable, lpSum, PULP_CBC_CMD
        prob = LpProblem("ILP_Store_Selection", LpMaximize)
        x    = [LpVariable(f"x_{i}", cat="Binary") for i in range(n)]

        prob += lpSum(scores[i] * x[i] for i in range(n))

        if budget > 0:
            prob += lpSum(costs[i] * x[i] for i in range(n)) <= budget

        if n_max > 0:
            prob += lpSum(x[i] for i in range(n)) <= n_max

        total_x = lpSum(x[i] for i in range(n))

        for max_frac, idx in [
            (max_frac_sp,     idx_sp),
            (max_frac_plat,   idx_plat),
            (max_frac_gold,   idx_gold),
            (max_frac_silver, idx_silver),
            (max_frac_bronze, idx_bronze),
        ]:
            if max_frac > 0 and idx:
                prob += lpSum(x[i] for i in idx) <= max_frac * total_x

        if max_frac_prov > 0:
            for p_idx in prov_groups.values():
                if p_idx:
                    prob += lpSum(x[i] for i in p_idx) <= max_frac_prov * total_x

        prob.solve(PULP_CBC_CMD(msg=0, timeLimit=30))

        if prob.status == 1:
            sel = [i for i, v in enumerate(x) if v.varValue is not None and v.varValue > 0.5]
            return cand.iloc[sel].reset_index(drop=True), "Optimal"
    except Exception:
        pass

    # Greedy fallback: pick highest-score stores within constraints
    out, cum = [], 0.0
    for _, row in cand.sort_values("score", ascending=False).iterrows():
        if n_max > 0 and len(out) >= n_max:
            break
        if budget > 0 and cum + row["estimated_cost"] > budget:
            continue
        out.append(row)
        cum += row["estimated_cost"]
    result = pd.DataFrame(out).reset_index(drop=True) if out else pd.DataFrame(columns=cand.columns)
    return result, "Greedy fallback"

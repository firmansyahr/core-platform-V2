"""Store Performance Tracker — menutup loop AEGIS → ILP → Loyalty → Outcome."""
from __future__ import annotations

import json
import os
from collections import Counter

import numpy as np
import pandas as pd


def get_store_journey(
    df_transaksi: pd.DataFrame,
    store_crs_df: pd.DataFrame,
    loyalty_members: list[dict],
    id_toko: str,
) -> dict:
    """Rekonstruksi perjalanan satu toko: AEGIS → Loyalty → Outcome."""
    toko_df = df_transaksi[df_transaksi["ID Toko"] == id_toko].copy()
    if len(toko_df) == 0:
        return {"status": "not_found"}

    info = {
        "id_toko":        id_toko,
        "nama_toko":      str(toko_df["Nama Toko"].iloc[0]),
        "kabupaten":      str(toko_df["Kabupaten Toko"].iloc[0]),
        "cluster_pareto": str(toko_df["Cluster Pareto"].iloc[0]),
        "tso":            str(toko_df["TSO"].iloc[0]),
    }

    # Monthly aggregation
    toko_df["bulan"] = toko_df["Tanggal Transaksi"].dt.to_period("M")
    monthly_rows: list[dict] = []
    for period, grp in toko_df.groupby("bulan"):
        ton_total    = float(grp["TON Quantity"].sum())
        ton_fighting = float(
            grp.loc[grp["Brands"].str.contains("BANTENG", na=False), "TON Quantity"].sum()
        )
        ton_main = float(
            grp.loc[grp["Brands"].str.contains("ELANG", na=False), "TON Quantity"].sum()
        )
        fbsi = (ton_fighting / ton_total * 100) if ton_total > 0 else 0.0
        monthly_rows.append({
            "bulan":       period,
            "periode":     str(period),
            "ton_total":   ton_total,
            "ton_main":    ton_main,
            "ton_fighting": ton_fighting,
            "fbsi":        round(fbsi, 1),
            "trx_count":  int(len(grp)),
        })

    monthly_sorted = sorted(monthly_rows, key=lambda x: x["bulan"])

    # AEGIS current state
    aegis_row = store_crs_df[store_crs_df["ID Toko"] == id_toko]
    if len(aegis_row) > 0:
        current_score = float(aegis_row["aegis_score"].iloc[0])
        current_pola  = str(aegis_row["pola_kode"].iloc[0])
        current_level = (
            "Merah"  if current_score >= 85 else
            "Oranye" if current_score >= 65 else
            "Kuning" if current_score >= 40 else
            "Normal"
        )
    else:
        current_score, current_level, current_pola = 0.0, "Normal", "N"

    # Loyalty info
    member = next((m for m in loyalty_members if m["id_toko"] == id_toko), None)
    loyalty_info: dict | None = None
    if member:
        loyalty_info = {
            "status":           member.get("status", ""),
            "tgl_masuk":        member.get("tgl_masuk"),
            "tgl_keluar":       member.get("tgl_keluar"),
            "reward_type":      member.get("reward_type", "Standard"),
            "enrollment_count": member.get("enrollment_count", 1),
        }

    # Outcome — compare first 3 vs last 3 months (if enough data)
    vol_before = vol_after = vol_delta = 0.0
    fbsi_before = fbsi_after = fbsi_delta = 0.0

    if len(monthly_sorted) >= 6:
        vol_before  = float(np.mean([r["ton_total"]   for r in monthly_sorted[:3]]))
        vol_after   = float(np.mean([r["ton_total"]   for r in monthly_sorted[-3:]]))
        fbsi_before = float(np.mean([r["fbsi"]        for r in monthly_sorted[:3]]))
        fbsi_after  = float(np.mean([r["fbsi"]        for r in monthly_sorted[-3:]]))
        vol_delta   = ((vol_after - vol_before) / vol_before * 100) if vol_before > 0 else 0.0
        fbsi_delta  = fbsi_after - fbsi_before

    # Verdict
    if loyalty_info and loyalty_info["status"] == "Aktif":
        if vol_delta > 5 and fbsi_delta < 0:
            verdict        = "Membaik"
            verdict_detail = f"Volume naik {vol_delta:.1f}% dan porsi produk murah turun {abs(fbsi_delta):.1f}pp sejak masuk program"
            verdict_color  = "green"
        elif vol_delta > 0:
            verdict        = "Stabil"
            verdict_detail = f"Volume naik {vol_delta:.1f}% namun porsi produk murah belum turun signifikan"
            verdict_color  = "blue"
        elif vol_delta < -10:
            verdict        = "Perlu Perhatian"
            verdict_detail = f"Volume turun {abs(vol_delta):.1f}% meskipun sudah di program loyalty"
            verdict_color  = "red"
        else:
            verdict        = "Dalam Pemantauan"
            verdict_detail = "Perubahan belum signifikan, butuh lebih banyak data"
            verdict_color  = "gray"
    else:
        verdict        = "Belum di Program"
        verdict_detail = "Toko belum terdaftar di program loyalty"
        verdict_color  = "gray"

    return {
        "status": "ok",
        "info":   info,
        "current_aegis": {
            "score": round(current_score, 1),
            "level": current_level,
            "pola":  current_pola,
        },
        "loyalty": loyalty_info,
        "outcome": {
            "vol_before_avg":  round(vol_before, 2),
            "vol_after_avg":   round(vol_after, 2),
            "vol_delta_pct":   round(vol_delta, 1),
            "fbsi_before_avg": round(fbsi_before, 1),
            "fbsi_after_avg":  round(fbsi_after, 1),
            "fbsi_delta_pp":   round(fbsi_delta, 1),
            "verdict":         verdict,
            "verdict_detail":  verdict_detail,
            "verdict_color":   verdict_color,
        },
        "monthly_trend": [
            {
                "periode":     r["periode"],
                "ton_total":   round(r["ton_total"], 2),
                "ton_main":    round(r["ton_main"], 2),
                "ton_fighting": round(r["ton_fighting"], 2),
                "fbsi":        round(r["fbsi"], 1),
                "trx_count":  r["trx_count"],
            }
            for r in monthly_sorted
        ],
    }


def get_performance_overview(
    df_transaksi: pd.DataFrame,
    store_crs_df: pd.DataFrame,
    loyalty_members: list[dict],
) -> dict:
    """Overview performa semua toko loyalty aktif (max 100)."""
    active_members = [m for m in loyalty_members if m.get("status") == "Aktif"]
    results: list[dict] = []

    for member in active_members[:100]:
        id_toko = member["id_toko"]
        journey = get_store_journey(df_transaksi, store_crs_df, loyalty_members, id_toko)
        if journey["status"] != "ok":
            continue
        results.append({
            "id_toko":       id_toko,
            "nama_toko":     journey["info"]["nama_toko"],
            "kabupaten":     journey["info"]["kabupaten"],
            "cluster":       journey["info"]["cluster_pareto"],
            "tso":           journey["info"]["tso"],
            "aegis_score":   journey["current_aegis"]["score"],
            "aegis_level":   journey["current_aegis"]["level"],
            "loyalty_since": member.get("tgl_masuk", ""),
            "reward_type":   member.get("reward_type", "Standard"),
            "vol_delta_pct": journey["outcome"]["vol_delta_pct"],
            "fbsi_delta":    journey["outcome"]["fbsi_delta_pp"],
            "verdict":       journey["outcome"]["verdict"],
            "verdict_color": journey["outcome"]["verdict_color"],
        })

    verdicts = [r["verdict"] for r in results]
    vc = Counter(verdicts)

    return {
        "total_dipantau":   len(results),
        "membaik":          vc.get("Membaik", 0),
        "stabil":           vc.get("Stabil", 0),
        "perlu_perhatian":  vc.get("Perlu Perhatian", 0),
        "dalam_pemantauan": vc.get("Dalam Pemantauan", 0) + vc.get("Belum di Program", 0),
        "stores":           sorted(results, key=lambda x: x["vol_delta_pct"], reverse=True),
    }

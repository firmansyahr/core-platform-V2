"""Competitor Intelligence Engine — triangulasi AEGIS internal + ASPERSSI %."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

AGGREGATE_KEYWORDS = ["other", "lainnya", "others", "lain-lain", "misc"]


def detect_is_aggregate(nama_brand: str) -> bool:
    n = nama_brand.lower().strip()
    return any(k in n for k in AGGREGATE_KEYWORDS)

# ── Data paths ────────────────────────────────────────────────────────────────

_ASPERSSI_DIR  = Path("api/data/asperssi")
_SHARE_PROV    = _ASPERSSI_DIR / "share_provinsi.json"
_MS_BRAND      = _ASPERSSI_DIR / "marketshare_brand.json"


def load_share_provinsi() -> dict:
    if not _SHARE_PROV.exists():
        return {"metadata": {}, "data": []}
    with open(_SHARE_PROV, encoding="utf-8") as f:
        return json.load(f)


def save_share_provinsi(payload: dict) -> None:
    _ASPERSSI_DIR.mkdir(parents=True, exist_ok=True)
    with open(_SHARE_PROV, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def load_marketshare_brand() -> dict:
    if not _MS_BRAND.exists():
        return {"metadata": {}, "data": []}
    with open(_MS_BRAND, encoding="utf-8") as f:
        return json.load(f)


def save_marketshare_brand(payload: dict) -> None:
    _ASPERSSI_DIR.mkdir(parents=True, exist_ok=True)
    with open(_MS_BRAND, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


# ── Coverage ──────────────────────────────────────────────────────────────────

def get_asperssi_coverage() -> dict:
    share_prov = load_share_provinsi()
    ms_brand   = load_marketshare_brand()

    sp_data = share_prov.get("data", [])
    mb_data = ms_brand.get("data", [])

    return {
        "share_provinsi": {
            "periode_tersedia": sorted({d["periode"] for d in sp_data}),
            "provinsi_count":   len({d["provinsi"] for d in sp_data}),
            "last_updated":     share_prov.get("metadata", {}).get("last_updated"),
        },
        "marketshare_brand": {
            "periode_tersedia": sorted({d["periode"] for d in mb_data}),
            "brands_tracked":   sorted({
                b["nama"] for d in mb_data for b in d.get("brands", [])
            }),
            "provinsi_count":   len({d["provinsi"] for d in mb_data}),
            "last_updated":     ms_brand.get("metadata", {}).get("last_updated"),
        },
        "catatan": [
            "Data ASPERSSI dalam bentuk persentase — tidak bisa hitung volume absolut",
            "Share provinsi tersedia berbeda periode dengan market share brand",
            "Gunakan untuk analisis tren relatif dan konfirmasi arah, bukan magnitude absolut",
        ],
    }


# ── Triangulation ─────────────────────────────────────────────────────────────

def triangulate_aegis_with_asperssi(
    store_crs_df: pd.DataFrame,
    share_prov_data: dict,
    ms_brand_data: dict,
) -> list[dict]:
    """
    Triangulasi AEGIS internal signal + ASPERSSI % data.
    Fokus pada ARAH (naik/turun) karena data dalam persen, bukan absolut.
    """
    sp_list = share_prov_data.get("data", [])
    mb_list = ms_brand_data.get("data", [])

    # Map level column — engine calls it "alert" inside compute_store_crs
    level_col = "alert" if "alert" in store_crs_df.columns else "level"

    warnings_by_provinsi = (
        store_crs_df
        .groupby("Provinsi Toko")
        .agg(
            total_toko  =("ID Toko",          "count"),
            warning_count=(level_col,          lambda x: (x != "Normal").sum()),
            avg_fbsi    =("s_fbsi_adjusted",   "mean"),
            merah_count =(level_col,           lambda x: (x == "Merah").sum()),
        )
        .reset_index()
    )

    results: list[dict] = []

    for _, row in warnings_by_provinsi.iterrows():
        provinsi    = row["Provinsi Toko"]
        total       = row["total_toko"]
        warning_pct = round(row["warning_count"] / total * 100, 1) if total else 0.0

        # Share provinsi entries (sorted by periode)
        share_entries = sorted(
            [d for d in sp_list if d["provinsi"] == provinsi],
            key=lambda x: x["periode"],
        )

        # Market share brand entries
        ms_entries = sorted(
            [d for d in mb_list if d["provinsi"] == provinsi],
            key=lambda x: x["periode"],
        )

        # Share trend (provinsi % nasional)
        share_trend: float | None       = None
        share_trend_label: str | None   = None
        share_periode_label: str | None = None
        if share_entries:
            share_periode_label = (
                f"{share_entries[0]['periode']} - {share_entries[-1]['periode']}"
                if len(share_entries) >= 2 else share_entries[0]["periode"]
            )
        if len(share_entries) >= 2:
            delta = share_entries[-1]["share_nasional_pct"] - share_entries[0]["share_nasional_pct"]
            share_trend       = round(delta, 2)
            share_trend_label = "Naik" if delta > 0.3 else "Turun" if delta < -0.3 else "Stabil"

        # Market share trend per competitor brand
        top_competitor: dict | None = None
        competitor_rising            = False
        ms_periode_label: str | None = None
        brand_changes: list[dict]    = []
        aggregate_others_pct: float | None  = None
        aggregate_others_trend: str | None  = None

        if ms_entries:
            ms_periode_label = (
                f"{ms_entries[0]['periode']} - {ms_entries[-1]['periode']}"
                if len(ms_entries) >= 2 else ms_entries[0]["periode"]
            )
            # Capture aggregate_others_pct from latest period even with one entry
            for b in ms_entries[-1].get("brands", []):
                if not b.get("is_own_brand") and b.get("is_aggregate_others"):
                    aggregate_others_pct = b["market_share_pct"]
                    break

        if len(ms_entries) >= 2:
            first_brands = ms_entries[0].get("brands", [])
            last_brands  = ms_entries[-1].get("brands", [])
            for b_last in last_brands:
                if b_last.get("is_own_brand"):
                    continue
                is_aggregate = b_last.get("is_aggregate_others", False)
                b_first = next(
                    (b for b in first_brands if b["nama"] == b_last["nama"]), None
                )
                delta_ms = (
                    b_last["market_share_pct"] - b_first["market_share_pct"]
                ) if b_first else 0.0

                if is_aggregate:
                    aggregate_others_pct  = b_last["market_share_pct"]
                    aggregate_others_trend = (
                        "Naik" if delta_ms > 0.5 else "Turun" if delta_ms < -0.5 else "Stabil"
                    )
                else:
                    if b_first:
                        brand_changes.append({
                            "brand":          b_last["nama"],
                            "ms_current_pct": b_last["market_share_pct"],
                            "ms_change_pp":   round(delta_ms, 2),
                            "trend": "Naik" if delta_ms > 0.5 else "Turun" if delta_ms < -0.5 else "Stabil",
                        })

            if brand_changes:
                top_competitor    = max(brand_changes, key=lambda x: x["ms_change_pp"])
                competitor_rising = top_competitor["ms_change_pp"] > 0.5

        aggregate_pressure = (
            aggregate_others_pct is not None
            and aggregate_others_pct > 10.0
            and aggregate_others_trend == "Naik"
        )

        # Own brand MS for latest period
        own_brand_ms: float | None = None
        if ms_entries:
            for b in ms_entries[-1].get("brands", []):
                if b.get("is_own_brand"):
                    own_brand_ms = b["market_share_pct"]
                    break

        # Verdict
        has_aegis   = warning_pct >= 15
        has_ms_data = bool(ms_entries)
        has_sp_data = bool(share_entries)

        if has_aegis and has_ms_data and competitor_rising:
            verdict = "KONFIRMASI_KOMPETITOR"
            insight = (
                f"AEGIS mendeteksi {warning_pct:.1f}% toko warning di provinsi ini, "
                f"DIKONFIRMASI oleh kenaikan market share {top_competitor['brand']} "
                f"+{top_competitor['ms_change_pp']}pp "
                f"(ASPERSSI {ms_entries[0]['periode']} vs {ms_entries[-1]['periode']}). "
                f"Tekanan kompetitor eksternal terbukti dari dua sumber berbeda."
            )
        elif has_aegis and has_ms_data and aggregate_pressure and not competitor_rising:
            verdict = "WASPADA_AWAL"
            insight = (
                f"AEGIS mendeteksi {warning_pct:.1f}% toko warning. "
                f"Market share gabungan brand kecil tidak teridentifikasi ('Lainnya') "
                f"naik dan mencapai {aggregate_others_pct:.1f}% di provinsi ini. "
                f"Tidak ada satu kompetitor dominan yang teridentifikasi — "
                f"kemungkinan tekanan dari banyak pemain lokal kecil. "
                f"Rekomendasikan validasi lapangan TSO untuk identifikasi spesifik."
            )
        elif has_aegis and has_ms_data and not competitor_rising:
            verdict = "INTERNAL_ATAU_SEASONAL"
            insight = (
                f"AEGIS mendeteksi {warning_pct:.1f}% toko warning, "
                f"tapi market share kompetitor tidak naik signifikan di data ASPERSSI. "
                f"Indikasi masalah internal (stok/harga/TSO) atau seasonal, "
                f"bukan serangan kompetitor baru."
            )
        elif has_aegis and not has_ms_data:
            verdict = "TIDAK_CUKUP_DATA"
            insight = (
                f"AEGIS mendeteksi {warning_pct:.1f}% toko warning "
                f"tapi data ASPERSSI untuk provinsi ini tidak tersedia. "
                f"Validasi lapangan TSO diperlukan."
            )
        elif not has_aegis and has_ms_data and competitor_rising:
            verdict = "WASPADA_AWAL"
            insight = (
                f"Market share {top_competitor['brand']} naik "
                f"+{top_competitor['ms_change_pp']}pp di data ASPERSSI, "
                f"meski AEGIS warning masih rendah ({warning_pct:.1f}%). "
                f"Kompetitor mulai masuk tapi belum terasa di transaksi. "
                f"Pantau ketat 1–2 bulan ke depan."
            )
        elif not has_aegis and has_ms_data and aggregate_pressure:
            verdict = "WASPADA_AWAL"
            insight = (
                f"Market share gabungan brand kecil tidak teridentifikasi ('Lainnya') "
                f"naik ke {aggregate_others_pct:.1f}% di data ASPERSSI, "
                f"meski AEGIS warning masih rendah ({warning_pct:.1f}%). "
                f"Tidak ada satu kompetitor dominan yang teridentifikasi — "
                f"kemungkinan tekanan dari banyak pemain lokal kecil. "
                f"Rekomendasikan validasi lapangan TSO untuk identifikasi spesifik."
            )
        else:
            verdict = "NORMAL"
            insight = (
                f"Tidak ada indikasi tekanan kompetitor signifikan. "
                f"Warning AEGIS {warning_pct:.1f}%, market share kompetitor stabil."
            )

        data_completeness = (
            "Lengkap"  if has_sp_data and has_ms_data else
            "Parsial"  if has_sp_data or has_ms_data  else
            "Tidak Ada"
        )
        catatan = (
            "Share provinsi dan market share brand dari periode berbeda — "
            "interpretasi hati-hati karena tidak sinkron"
            if has_sp_data and has_ms_data else ""
        )

        results.append({
            "provinsi":                  provinsi,
            "aegis_warning_pct":         warning_pct,
            "aegis_merah_count":         int(row["merah_count"]),
            "avg_fbsi_pct":              round(float(row["avg_fbsi"]), 1),
            "share_provinsi_trend":      share_trend,
            "share_provinsi_trend_label": share_trend_label,
            "share_provinsi_periode":    share_periode_label,
            "share_provinsi_pct_latest": (
                share_entries[-1]["share_nasional_pct"] if share_entries else None
            ),
            "own_brand_ms_pct":          own_brand_ms,
            "top_competitor":            top_competitor,
            "brand_changes":             brand_changes,
            "aggregate_others_pct":      aggregate_others_pct,
            "aggregate_others_trend":    aggregate_others_trend,
            "ms_brand_periode":          ms_periode_label,
            "verdict":                   verdict,
            "insight":                   insight,
            "data_completeness":         data_completeness,
            "catatan_data":              catatan,
        })

    return sorted(results, key=lambda x: x["aegis_warning_pct"], reverse=True)


# ── GMM cross-check ──────────────────────────────────────────────────────────

def cross_check_gmm_with_triangulation(
    triangulation_results: list[dict],
    gmm_result: dict,
    store_crs_df: pd.DataFrame,
) -> list[dict]:
    """
    Enrich each triangulation result with GMM category distribution per province.
    Adds 'gmm_cross_check' key to each result dict (in-place mutation + return).
    """
    assignments = gmm_result.get("store_assignments", [])
    interps     = gmm_result.get("cluster_interpretations", {})
    if not assignments or store_crs_df.empty:
        return triangulation_results

    store_to_category: dict[str, str] = {
        str(s["ID Toko"]): interps.get(str(s["cluster"]), {}).get("category", "tidak_ada_data")
        for s in assignments
    }

    provinsi_to_ids: dict[str, list[str]] = {}
    if "Provinsi Toko" in store_crs_df.columns and "ID Toko" in store_crs_df.columns:
        for prov, grp in store_crs_df.groupby("Provinsi Toko")["ID Toko"]:
            provinsi_to_ids[str(prov)] = grp.astype(str).tolist()

    for result in triangulation_results:
        ids   = provinsi_to_ids.get(result["provinsi"], [])
        counts: dict[str, int] = {}
        for id_toko in ids:
            cat = store_to_category.get(id_toko, "tidak_ada_data")
            counts[cat] = counts.get(cat, 0) + 1

        total = sum(counts.values())
        kani_n = counts.get("kanibalisasi", 0) + counts.get("kanibalisasi_sebagian_eksternal", 0)
        ext_n  = counts.get("tekanan_eksternal", 0) + counts.get("fighting_brand_shift", 0)
        kani_pct = round(kani_n / total * 100, 1) if total else 0.0
        ext_pct  = round(ext_n  / total * 100, 1) if total else 0.0

        catatan: str | None = None
        if result.get("verdict") == "KONFIRMASI_KOMPETITOR":
            if kani_pct > ext_pct:
                catatan = (
                    f"PERHATIAN: Triangulasi ASPERSSI menunjukkan tekanan kompetitor, "
                    f"namun {kani_pct}% toko di provinsi ini justru menunjukkan "
                    f"pola kanibalisasi internal. Disarankan validasi lebih lanjut "
                    f"sebelum eskalasi besar-besaran."
                )
            else:
                catatan = (
                    f"KONSISTEN: {ext_pct}% toko menunjukkan sinyal tekanan "
                    f"eksternal, sejalan dengan hasil triangulasi ASPERSSI."
                )

        result["gmm_cross_check"] = {
            "category_distribution":  counts,
            "kanibalisasi_pct":        kani_pct,
            "eksternal_pct":           ext_pct,
            "total_toko_dianalisis":   total,
            "catatan":                 catatan,
            "gmm_tersedia":            True,
        }

    return triangulation_results


# ── Competitor ranking ────────────────────────────────────────────────────────

def get_competitor_ranking(ms_brand_data: dict) -> dict[str, Any]:
    """
    Ranking kompetitor dari data ASPERSSI % saja.
    Returns { "rankings": [...], "aggregate_others": {...} | None }
    Brand dengan is_aggregate_others=True dipisah dari ranking utama.
    """
    brand_summary: dict[str, Any]     = {}
    aggregate_summary: dict[str, Any] = {}

    for entry in ms_brand_data.get("data", []):
        for brand in entry.get("brands", []):
            if brand.get("is_own_brand"):
                continue
            nama        = brand["nama"]
            is_agg      = brand.get("is_aggregate_others", False)
            target_dict = aggregate_summary if is_agg else brand_summary
            if nama not in target_dict:
                target_dict[nama] = {"points": []}
            target_dict[nama]["points"].append({
                "provinsi": entry["provinsi"],
                "periode":  entry["periode"],
                "ms_pct":   brand["market_share_pct"],
            })

    def _build_entry(brand: str, points: list[dict]) -> dict:
        avg_ms       = sum(p["ms_pct"] for p in points) / len(points)
        provinsi_set = {p["provinsi"] for p in points}
        trends: list[float] = []
        for prov in provinsi_set:
            prov_pts = sorted(
                [p for p in points if p["provinsi"] == prov],
                key=lambda x: x["periode"],
            )
            if len(prov_pts) >= 2:
                trends.append(prov_pts[-1]["ms_pct"] - prov_pts[0]["ms_pct"])
        avg_trend = sum(trends) / len(trends) if trends else 0.0
        return {
            "brand":          brand,
            "avg_ms_pct":     round(avg_ms, 2),
            "avg_trend_pp":   round(avg_trend, 2),
            "trend_label":    "Naik" if avg_trend > 0.5 else "Turun" if avg_trend < -0.5 else "Stabil",
            "provinsi_hadir": sorted(provinsi_set),
            "provinsi_count": len(provinsi_set),
            "data_points":    len(points),
            "catatan": (
                "Tren dihitung dari "
                + f"{min(p['periode'] for p in points)} ke {max(p['periode'] for p in points)}"
                if points else "-"
            ),
        }

    rankings = sorted(
        [_build_entry(b, d["points"]) for b, d in brand_summary.items()],
        key=lambda x: x["avg_ms_pct"],
        reverse=True,
    )

    # Aggregate "Lainnya" — merge all aggregate brands into one summary entry
    aggregate_others: dict | None = None
    if aggregate_summary:
        all_points = [p for d in aggregate_summary.values() for p in d["points"]]
        avg_ms     = sum(p["ms_pct"] for p in all_points) / len(all_points)
        provinsi_set = {p["provinsi"] for p in all_points}
        trends: list[float] = []
        for brand_name, d in aggregate_summary.items():
            for prov in provinsi_set:
                prov_pts = sorted(
                    [p for p in d["points"] if p["provinsi"] == prov],
                    key=lambda x: x["periode"],
                )
                if len(prov_pts) >= 2:
                    trends.append(prov_pts[-1]["ms_pct"] - prov_pts[0]["ms_pct"])
        avg_trend = sum(trends) / len(trends) if trends else 0.0
        aggregate_others = {
            "label":          "Lainnya (gabungan brand kecil tidak teridentifikasi)",
            "avg_ms_pct":     round(avg_ms, 2),
            "avg_trend_pp":   round(avg_trend, 2),
            "trend_label":    "Naik" if avg_trend > 0.5 else "Turun" if avg_trend < -0.5 else "Stabil",
            "provinsi_count": len(provinsi_set),
            "is_aggregate":   True,
        }

    return {"rankings": rankings, "aggregate_others": aggregate_others}


# ── CAD Intelligence ──────────────────────────────────────────────────────────

def get_cad_intelligence(cad_records: list[dict]) -> dict:
    """Agregasi kompetitor dari validasi TSO di CAD History."""
    kompetitor: dict[str, Any] = {}

    for alert in cad_records:
        hvd = alert.get("hasil_validasi_detail") or {}
        if isinstance(hvd, dict):
            kategori = hvd.get("kategori_utama")
        else:
            # fallback: old string field
            old_map = {
                "KOMPETITOR_EKSTERNAL": "Kompetitor Eksternal",
            }
            kategori = old_map.get(alert.get("hasil_validasi", ""), "")

        if kategori != "Kompetitor Eksternal":
            continue

        detail = hvd.get("detail_kompetitor") or {} if isinstance(hvd, dict) else {}
        brand  = (detail.get("nama_brand") or "Tidak Disebutkan") if isinstance(detail, dict) else "Tidak Disebutkan"

        if brand not in kompetitor:
            kompetitor[brand] = {
                "brand":          brand,
                "kejadian":       0,
                "provinsi":       set(),
                "kabupaten":      set(),
                "toko_terdampak": 0,
                "gap_harga":      [],
                "metode":         {},
            }

        e = kompetitor[brand]
        e["kejadian"] += 1
        e["provinsi"].add(alert.get("provinsi", ""))
        e["kabupaten"].add(alert.get("kabupaten", ""))

        toko_d = hvd.get("toko_terdampak") if isinstance(hvd, dict) else None
        if isinstance(toko_d, int):
            e["toko_terdampak"] += toko_d

        gap = detail.get("gap_harga_per_zak", 0) if isinstance(detail, dict) else 0
        if gap and gap > 0:
            e["gap_harga"].append(gap)

        metode = (detail.get("metode_masuk") or "Tidak Diketahui") if isinstance(detail, dict) else "Tidak Diketahui"
        e["metode"][metode] = e["metode"].get(metode, 0) + 1

    result: list[dict] = []
    for brand, d in kompetitor.items():
        result.append({
            "brand":               brand,
            "kejadian_cad":        d["kejadian"],
            "provinsi_list":       sorted(d["provinsi"] - {""}),
            "kabupaten_count":     len(d["kabupaten"] - {""}),
            "toko_terdampak":      d["toko_terdampak"],
            "avg_gap_harga_per_zak": (
                round(sum(d["gap_harga"]) / len(d["gap_harga"]), 0)
                if d["gap_harga"] else None
            ),
            "metode_dominan": (
                max(d["metode"], key=d["metode"].get) if d["metode"] else None
            ),
        })

    return {
        "kompetitor_list":    sorted(result, key=lambda x: x["kejadian_cad"], reverse=True),
        "total_kejadian":     sum(r["kejadian_cad"] for r in result),
        "provinsi_terdampak": len({p for r in result for p in r["provinsi_list"]}),
        "disclaimer": (
            "Data berdasarkan laporan subjektif TSO di lapangan, bukan data resmi pasar"
        ),
    }

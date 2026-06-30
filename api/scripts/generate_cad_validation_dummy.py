"""
Generate dummy validation data for pending CAD Alerts.

Usage:
  # Test local (DRYRUN):
  python3 api/scripts/generate_cad_validation_dummy.py

  # Production (on Railway):
  DB_PATH=/mnt/data/app_data/core_platform.db python3 api/scripts/generate_cad_validation_dummy.py
"""
from __future__ import annotations

import json
import os
import random
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

random.seed(42)

# ── Config ────────────────────────────────────────────────────────────────────

LOCAL_DB   = "api/data/core_platform_DRYRUN.db"
PROD_DB    = "/mnt/data/app_data/core_platform.db"
DB_PATH    = os.environ.get("DB_PATH", LOCAL_DB)

GMM_RESULT = Path("api/data/models/gmm_training_result.json")
PARQUET    = Path("data/transaksi_sample_deploy.parquet")

RATIO_RESOLVED    = 0.90   # 90% RESOLVED
RATIO_IN_PROGRESS = 0.05   # 5% IN_PROGRESS
# remaining ~5% stays OPEN

MIN_FALSE_ALARM = 4  # floor: garantikan ≥4 false-positive (sistem tidak selalu benar)

TSO_NAMES = [
    "TSO-012 Hendra Wijaya",
    "TSO-025 Siti Aminah",
    "TSO-038 Budi Santoso",
    "TSO-047 Kurniawan Wijaya",
    "TSO-051 Dewi Lestari",
    "TSO-063 Agus Pratama",
    "TSO-072 Rini Susanti",
    "TSO-089 Joko Prasetyo",
]

# (kategori_human, legacy_key, weight_default)
CATEGORIES = [
    ("Kompetitor Eksternal",    "KOMPETITOR_EKSTERNAL",    0.38),
    ("Internal Lemah",          "INTERNAL_LEMAH",          0.22),
    ("Kanibalisasi Brand",      "KANIBALISASI_BRAND",      0.18),
    ("Masalah Distribusi",      "MASALAH_DISTRIBUSI",      0.12),
    ("Tidak Ditemukan Masalah", "TIDAK_DITEMUKAN_MASALAH", 0.10),
]

# GMM category → preferred AEGIS kategori & weight multiplier
GMM_BOOST: dict[str, dict[str, float]] = {
    "kanibalisasi":         {"Kanibalisasi Brand": 3.0, "Internal Lemah": 1.5},
    "fighting_brand_shift": {"Kompetitor Eksternal": 3.0, "Kanibalisasi Brand": 1.5},
    "de_kanibalisasi":      {"Tidak Ditemukan Masalah": 4.0},
    "stabil":               {"Tidak Ditemukan Masalah": 1.5, "Internal Lemah": 1.3},
}

# Pola AEGIS → extra weight adjustments
POLA_BOOST: dict[str, dict[str, float]] = {
    "A": {"Kanibalisasi Brand": 2.0, "Kompetitor Eksternal": 1.5},
    "B": {"Kompetitor Eksternal": 2.0, "Internal Lemah": 1.5},
    "C": {"Masalah Distribusi": 2.5, "Internal Lemah": 1.5},
    "D": {"Tidak Ditemukan Masalah": 4.0},
}

ACTION_ITEMS: dict[str, list[str]] = {
    "Kompetitor Eksternal": [
        "Kompetitor menawarkan diskon harga {pct}% di wilayah {kab}. "
        "Eskalasi ke ASM untuk program defensif bulan depan.",
        "Ditemukan aktivitas promo agresif {brand} di {kab}. "
        "Rekomendasikan intensifikasi kunjungan TSO mingguan.",
        "Toko beralih sementara ke kompetitor karena harga lebih murah Rp {harga:,}/ton. "
        "Program loyalty perlu diperkuat.",
    ],
    "Internal Lemah": [
        "Frekuensi kunjungan TSO di {kab} kurang konsisten (rata-rata {freq}x/bulan). "
        "Target kunjungan minimal 2x/bulan per toko.",
        "Stok produk sering kosong di sub-distributor {kab}. "
        "Koordinasikan dengan tim logistik untuk perbaikan supply chain.",
        "Hubungan TSO–toko perlu diperbaiki. {n} toko menyatakan jarang dikunjungi.",
    ],
    "Kanibalisasi Brand": [
        "Toko beralih dari Semen Elang ke Semen Badak untuk margin lebih tinggi. "
        "Pola kanibalisasi internal terdeteksi di {pct}% toko.",
        "Volume Semen Elang turun, volume Semen Badak naik sebanding — "
        "indikasi substitusi antar brand internal di {kab}.",
        "Program incentive Semen Badak terlalu agresif menarik {n} toko dari Semen Elang. "
        "Review rasio reward MB vs CB.",
    ],
    "Masalah Distribusi": [
        "Keterlambatan pengiriman {hari} hari di {kab} mendorong toko mencari supplier alternatif sementara.",
        "Kapasitas gudang sub-distributor {kab} terbatas — antrian pengiriman menyebabkan toko wait-and-see.",
        "Armada pengiriman kurang di {kab}. {n} toko tidak bisa order rutin karena minimum order terlalu tinggi.",
    ],
    "Tidak Ditemukan Masalah": [
        "Kunjungan lapangan {kab}: kondisi toko normal, penurunan volume bersifat musiman. "
        "Proyeksi pulih bulan depan.",
        "Anomali AEGIS false-positive. Toko aktif beli, hubungan TSO baik, tidak ada kompetitor signifikan.",
        "Volume turun karena proyek konstruksi lokal selesai — demand siklikal, bukan sinyal churn.",
    ],
}

CATATAN_SHORT: dict[str, list[str]] = {
    "Kompetitor Eksternal": [
        "Kompetitor aktif promosi di wilayah ini, toko cenderung beralih sementara.",
        "Harga kompetitor lebih murah, TSO perlu eskalasi program defensif.",
    ],
    "Internal Lemah": [
        "Kunjungan TSO perlu ditingkatkan frekuensinya.",
        "Masalah stok di sub-distributor, perlu perbaikan supply chain.",
    ],
    "Kanibalisasi Brand": [
        "Toko beralih ke Fighting Brand untuk margin lebih tinggi.",
        "Pola substitusi brand internal — review struktur reward CB vs MB.",
    ],
    "Masalah Distribusi": [
        "Keterlambatan pengiriman menyebabkan toko mencari alternatif sementara.",
        "Kendala logistik mempengaruhi ketersediaan produk di wilayah ini.",
    ],
    "Tidak Ditemukan Masalah": [
        "Setelah kunjungan lapangan, kondisi toko normal — fluktuasi musiman biasa.",
        "Tidak ada indikasi masalah signifikan, volume akan kembali normal.",
    ],
}

COMPETITOR_BRANDS = ["Semen XX", "Tiga Bulat", "Honch", "Merak", "Rajawali"]


# ── GMM correlation ───────────────────────────────────────────────────────────

def build_kabupaten_gmm_map() -> dict[str, str]:
    """Return {kabupaten_upper → dominant_gmm_category}."""
    if not GMM_RESULT.exists() or not PARQUET.exists():
        return {}
    try:
        import pandas as pd
        data  = json.loads(GMM_RESULT.read_text(encoding="utf-8"))
        interp = data.get("cluster_interpretations", {})
        assignments = data.get("store_assignments", [])
        store_cluster = {s["ID Toko"]: str(s["cluster"]) for s in assignments}

        df     = pd.read_parquet(PARQUET)
        toko_kab = (
            df[["ID Toko", "Kabupaten Toko"]]
            .drop_duplicates()
            .set_index("ID Toko")["Kabupaten Toko"]
            .to_dict()
        )

        kab_cats: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for id_toko, cluster in store_cluster.items():
            kab = toko_kab.get(id_toko)
            if not kab:
                continue
            cat = interp.get(cluster, {}).get("category", "stabil")
            kab_cats[kab.upper()][cat] += 1

        result = {}
        for kab, cats in kab_cats.items():
            # dominant = highest count, excluding 'stabil' if another cat is >20%
            total = sum(cats.values())
            non_stabil = {k: v for k, v in cats.items() if k != "stabil"}
            if non_stabil and max(non_stabil.values()) / total > 0.15:
                result[kab] = max(non_stabil, key=non_stabil.get)
            else:
                result[kab] = max(cats, key=cats.get)
        return result
    except Exception as e:
        print(f"  [warn] GMM map build failed: {e}")
        return {}


# ── Category selection ────────────────────────────────────────────────────────

def pick_category(
    kabupaten: str,
    pola_dominan: str,
    status_alert: str,
    gmm_map: dict[str, str],
) -> tuple[str, str]:
    """Return (kategori_human, legacy_key)."""
    weights = {cat[0]: cat[2] for cat in CATEGORIES}

    # Apply GMM boost
    gmm_cat = gmm_map.get(kabupaten.upper(), "stabil")
    for cat_human, mult in GMM_BOOST.get(gmm_cat, {}).items():
        if cat_human in weights:
            weights[cat_human] *= mult

    # Apply AEGIS pola boost
    for cat_human, mult in POLA_BOOST.get(pola_dominan, {}).items():
        if cat_human in weights:
            weights[cat_human] *= mult

    # KRITIS alert: suppress "Tidak Ditemukan Masalah"
    if status_alert == "KRITIS":
        weights["Tidak Ditemukan Masalah"] = 0.0

    cats    = [c[0] for c in CATEGORIES]
    legacy  = {c[0]: c[1] for c in CATEGORIES}
    w_list  = [weights[c] for c in cats]
    chosen  = random.choices(cats, weights=w_list, k=1)[0]
    return chosen, legacy[chosen]


# ── Template rendering ────────────────────────────────────────────────────────

def _render(template: str, kabupaten: str, jumlah_toko: int) -> str:
    toko_dikunjungi = random.randint(max(1, jumlah_toko // 2), jumlah_toko)
    return template.format(
        kab=kabupaten.title(),
        pct=random.randint(8, 25),
        harga=random.choice([2000, 3000, 3500, 4000]),
        freq=random.choice([1, 2]),
        hari=random.randint(3, 7),
        n=random.randint(2, toko_dikunjungi),
        brand=random.choice(COMPETITOR_BRANDS),
    )


# ── Build one validation record ───────────────────────────────────────────────

def make_false_alarm(row: sqlite3.Row) -> dict:
    """Force record ke TIDAK_DITEMUKAN_MASALAH — representasi false-positive AEGIS."""
    kabupaten     = row["kabupaten"]
    tgl_alert_str = row["tgl_alert"]
    jumlah_toko   = row["jumlah_toko"]

    tgl_alert       = datetime.strptime(tgl_alert_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    tgl_validasi    = (tgl_alert + timedelta(days=random.randint(2, 10))).strftime("%Y-%m-%d")
    tso             = random.choice(TSO_NAMES)
    toko_dikunjungi = random.randint(max(1, jumlah_toko // 2), jumlah_toko)

    action_str = _render(random.choice(ACTION_ITEMS["Tidak Ditemukan Masalah"]), kabupaten, jumlah_toko)

    hasil_detail = {
        "kategori_utama":          "Tidak Ditemukan Masalah",
        "kategori_sekunder":       None,
        "toko_dikunjungi":         toko_dikunjungi,
        "toko_terdampak":          0,
        "toko_false_alarm":        toko_dikunjungi,
        "toko_butuh_investigasi":  0,
        "detail_kompetitor":       None,
        "detail_stok":             None,
        "detail_harga":            None,
        "distribusi_kondisi":      [],
        "target_resolusi":         None,
        "action_items":            action_str,
        "catatan_detail":          None,
    }

    follow_up = {
        "status":              "Resolved",
        "reminder_sent":       False,
        "eskalasi_asm":        False,
        "resolved_at":         tgl_validasi,
        "perlu_tindak_lanjut": False,
        "deadline":            None,
    }

    return {
        "status":                "Resolved",
        "status_resolusi":       "RESOLVED",
        "tgl_validasi":          tgl_validasi,
        "validated_by":          tso,
        "hasil_validasi":        "TIDAK_DITEMUKAN_MASALAH",
        "hasil_validasi_detail": json.dumps(hasil_detail, ensure_ascii=False),
        "catatan":               random.choice(CATATAN_SHORT["Tidak Ditemukan Masalah"]),
        "tanggal_resolved":      tgl_validasi,
        "follow_up":             json.dumps(follow_up, ensure_ascii=False),
    }


def make_resolved(
    row: sqlite3.Row,
    gmm_map: dict[str, str],
) -> dict:
    kabupaten     = row["kabupaten"]
    tgl_alert_str = row["tgl_alert"]
    jumlah_toko   = row["jumlah_toko"]
    status_alert  = row["status_alert"]

    kondisi_raw  = row["kondisi_alert"]
    kondisi      = json.loads(kondisi_raw) if isinstance(kondisi_raw, str) else (kondisi_raw or {})
    pola_dominan = kondisi.get("pola_dominan", "B")

    kategori, legacy_key = pick_category(kabupaten, pola_dominan, status_alert, gmm_map)

    tgl_alert = datetime.strptime(tgl_alert_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    days_to_validate = random.randint(2, 10)
    tgl_validasi = tgl_alert + timedelta(days=days_to_validate)
    tgl_validasi_str = tgl_validasi.strftime("%Y-%m-%d")

    tso = random.choice(TSO_NAMES)

    toko_dikunjungi   = random.randint(max(1, jumlah_toko // 2), jumlah_toko)
    toko_terdampak    = random.randint(1, toko_dikunjungi)
    toko_false_alarm  = toko_dikunjungi - toko_terdampak
    toko_investigasi  = max(0, random.randint(0, 2))

    action_tmpl  = random.choice(ACTION_ITEMS[kategori])
    action_str   = _render(action_tmpl, kabupaten, jumlah_toko)
    catatan_str  = random.choice(CATATAN_SHORT[kategori])

    perlu_tindak = kategori != "Tidak Ditemukan Masalah"
    deadline = (
        (tgl_validasi + timedelta(days=14)).strftime("%Y-%m-%d")
        if perlu_tindak else None
    )

    hasil_detail = {
        "kategori_utama":          kategori,
        "kategori_sekunder":       None,
        "toko_dikunjungi":         toko_dikunjungi,
        "toko_terdampak":          toko_terdampak,
        "toko_false_alarm":        toko_false_alarm,
        "toko_butuh_investigasi":  toko_investigasi,
        "detail_kompetitor":       (
            {"brand": random.choice(COMPETITOR_BRANDS),
             "selisih_harga_rp": random.choice([2000, 3000, 3500, 4000])}
            if kategori == "Kompetitor Eksternal" else None
        ),
        "detail_stok":             None,
        "detail_harga":            None,
        "distribusi_kondisi":      [],
        "target_resolusi":         tgl_validasi_str,
        "action_items":            action_str,
        "catatan_detail":          None,
    }

    follow_up = {
        "status":          "Resolved",
        "reminder_sent":   False,
        "eskalasi_asm":    kategori in ("Kompetitor Eksternal",) and status_alert == "KRITIS",
        "resolved_at":     tgl_validasi_str,
        "perlu_tindak_lanjut": perlu_tindak,
        "deadline":        deadline,
    }

    return {
        "status":               "Resolved",
        "status_resolusi":      "RESOLVED",
        "tgl_validasi":         tgl_validasi_str,
        "validated_by":         tso,
        "hasil_validasi":       legacy_key,
        "hasil_validasi_detail": json.dumps(hasil_detail, ensure_ascii=False),
        "catatan":              catatan_str,
        "tanggal_resolved":     tgl_validasi_str,
        "follow_up":            json.dumps(follow_up, ensure_ascii=False),
        # kondisi_alert intentionally NOT updated — already correct
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main(dry_run: bool = False) -> None:
    print(f"DB: {DB_PATH}")
    print(f"Dry-run: {dry_run}")
    print()

    gmm_map = build_kabupaten_gmm_map()
    print(f"GMM kabupaten map loaded: {len(gmm_map)} entries")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur  = conn.cursor()

    cur.execute(
        "SELECT id, kabupaten, tgl_alert, jumlah_toko, status_alert, kondisi_alert "
        "FROM cad_alerts WHERE status_resolusi != 'RESOLVED'"
    )
    pending = cur.fetchall()
    n_total = len(pending)
    print(f"Pending alerts: {n_total}")

    n_resolved    = round(n_total * RATIO_RESOLVED)
    n_in_progress = round(n_total * RATIO_IN_PROGRESS)
    n_open        = n_total - n_resolved - n_in_progress

    print(f"Plan: {n_resolved} RESOLVED | {n_in_progress} IN_PROGRESS | {n_open} OPEN")
    print()

    pending_shuffled = list(pending)
    random.shuffle(pending_shuffled)

    to_resolve     = pending_shuffled[:n_resolved]
    to_in_progress = pending_shuffled[n_resolved : n_resolved + n_in_progress]
    # remaining: stays OPEN, no update needed

    # Pre-select floor records for TIDAK_DITEMUKAN before main loop
    n_false_alarm = min(MIN_FALSE_ALARM, n_resolved)
    false_alarm_ids = {row["id"] for row in random.sample(to_resolve, n_false_alarm)}
    print(f"Floor TIDAK_DITEMUKAN_MASALAH: {n_false_alarm} records pre-selected")

    # ── Apply RESOLVED ──
    cat_counts: dict[str, int] = defaultdict(int)
    for row in to_resolve:
        if row["id"] in false_alarm_ids:
            validation = make_false_alarm(row)
        else:
            validation = make_resolved(row, gmm_map)
        cat_counts[validation["hasil_validasi"]] += 1
        if not dry_run:
            set_clause = ", ".join(f"{k} = ?" for k in validation)
            cur.execute(
                f"UPDATE cad_alerts SET {set_clause} WHERE id = ?",
                list(validation.values()) + [row["id"]],
            )

    # ── Apply IN_PROGRESS ──
    for row in to_in_progress:
        if not dry_run:
            tso = random.choice(TSO_NAMES)
            cur.execute(
                "UPDATE cad_alerts SET status = ?, status_resolusi = ?, validated_by = ? WHERE id = ?",
                ("In Progress", "IN_PROGRESS", tso, row["id"]),
            )

    if not dry_run:
        conn.commit()

    # ── Verification ──
    print("=== Category distribution (RESOLVED) ===")
    for cat, cnt in sorted(cat_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {cnt}")

    print()
    cur.execute("SELECT status_resolusi, COUNT(*) FROM cad_alerts GROUP BY status_resolusi")
    print("=== Final status distribution ===")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")

    if dry_run:
        print("\n[DRY-RUN] No changes written to DB.")
    else:
        print(f"\n[DONE] {n_resolved} alerts updated to RESOLVED.")

    # ── Sample resolved for inspection ──
    if not dry_run:
        print()
        print("=== Sample 5 RESOLVED records ===")
        cur.execute(
            "SELECT id, kabupaten, hasil_validasi, validated_by, tgl_validasi, catatan "
            "FROM cad_alerts WHERE status_resolusi = 'RESOLVED' LIMIT 5"
        )
        for r in cur.fetchall():
            print(f"  {r['id']}")
            print(f"    kabupaten    : {r['kabupaten']}")
            print(f"    hasil        : {r['hasil_validasi']}")
            print(f"    validated_by : {r['validated_by']}")
            print(f"    tgl_validasi : {r['tgl_validasi']}")
            print(f"    catatan      : {r['catatan']}")

    conn.close()


if __name__ == "__main__":
    import sys
    dry = "--dry-run" in sys.argv
    main(dry_run=dry)

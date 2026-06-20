"""
Script regenerasi loyalty_members.json — one-off, bukan production code.

Strategi:
  Kelompok 1 — AEGIS-triggered (60% = 180 toko):
    Roll compute_store_crs() per bulan Jan 2025 – Apr 2026.
    Cari first_warning_date per toko (alert Merah/Oranye).
    tgl_masuk = first_warning_date + jitter 7-28 hari, cap Mar 2026.

  Kelompok 2 — Random/proaktif (40% = 120 toko):
    Sample acak dari sisa toko (tidak dipilih di kelompok 1).
    tgl_masuk = random Jan 2024 – Mar 2026.

Output:
  Dry run → api/data/loyalty_members_NEW_dryrun.json
  Final   → api/data/loyalty_members.json  (hanya setelah diapprove)
"""

from __future__ import annotations

import json
import random
import sys
import time
import uuid
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# Pastikan root project ada di sys.path
_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_ROOT))

random.seed(42)
np.random.seed(42)

# ── Config ────────────────────────────────────────────────────────────────────

DATA_PATH       = _ROOT / "data" / "transaksi_aegis_synthetic.parquet"
OUTPUT_DRYRUN   = _ROOT / "api" / "data" / "loyalty_members_NEW_dryrun.json"
OUTPUT_FINAL    = _ROOT / "api" / "data" / "loyalty_members.json"
OUTPUT_BACKUP   = _ROOT / "api" / "data" / "loyalty_members_BACKUP_pre_regen.json"

TARGET_TOTAL = 300
N_AEGIS      = int(TARGET_TOTAL * 0.6)   # 180
N_RANDOM     = TARGET_TOTAL - N_AEGIS    # 120

# Periode rolling AEGIS: butuh ≥12 bulan sebelumnya (ORS_WINDOW=12)
ROLL_START = pd.Period("2025-01", "M")
ROLL_END   = pd.Period("2026-04", "M")

ENROLL_MAX  = datetime(2026, 3, 31)   # cap enrollment, sisakan ≥1 bulan post
RANDOM_MIN  = datetime(2024, 1, 1)
RANDOM_MAX  = datetime(2026, 3, 31)


# ── Langkah 1: Rolling AEGIS ──────────────────────────────────────────────────

def roll_historical_aegis(df: pd.DataFrame) -> pd.DataFrame:
    """
    Jalankan compute_store_crs() per bulan Jan 2025 – Apr 2026.
    Return DataFrame kolom: [id_toko, month (Period), alert].
    """
    from api.core.aegis_engine import compute_store_crs

    periods = list(pd.period_range(ROLL_START, ROLL_END, freq="M"))
    chunks: list[pd.DataFrame] = []

    print(f"Rolling AEGIS untuk {len(periods)} bulan...", flush=True)
    total_t0 = time.time()

    for period in periods:
        cutoff = period.to_timestamp(how="end")
        df_slice = df[df["Tanggal Transaksi"] <= cutoff].copy()

        t0 = time.time()
        print(f"  [{period}] computing... ", end="", flush=True)

        try:
            result = compute_store_crs(df_slice)
            elapsed = time.time() - t0

            n_merah  = (result["alert"] == "Merah").sum()
            n_oranye = (result["alert"] == "Oranye").sum()
            print(f"done ({elapsed:.1f}s)  Merah={n_merah}, Oranye={n_oranye}", flush=True)

            chunk = result[["ID Toko", "alert"]].copy()
            chunk.columns = ["id_toko", "alert"]
            chunk["month"] = period
            chunks.append(chunk)

        except Exception as exc:
            print(f"ERROR: {exc}", flush=True)

    total_elapsed = time.time() - total_t0
    print(f"Rolling selesai dalam {total_elapsed:.0f}s\n", flush=True)

    return pd.concat(chunks, ignore_index=True)


# ── Langkah 2: First warning per toko ────────────────────────────────────────

def find_first_warnings(alert_history: pd.DataFrame) -> dict[str, pd.Period]:
    """
    Return {id_toko: first_warning_period} untuk toko yang pernah
    mendapat alert Merah atau Oranye.
    """
    warning_df = alert_history[
        alert_history["alert"].isin(["Merah", "Oranye"])
    ].sort_values("month")

    return warning_df.groupby("id_toko")["month"].first().to_dict()


# ── Langkah 3: Generate tanggal enrollment ───────────────────────────────────

def jitter_from_warning(first_warning_period: pd.Period) -> str:
    """Period bulan warning + jitter 7-28 hari, cap Mar 2026."""
    base = first_warning_period.to_timestamp()   # hari pertama bulan tersebut
    jeda = random.randint(7, 28)
    enroll_dt = base + timedelta(days=jeda)
    if enroll_dt > ENROLL_MAX:
        enroll_dt = ENROLL_MAX
    return enroll_dt.strftime("%Y-%m-%d")


def random_date() -> str:
    """Random date Jan 2024 – Mar 2026."""
    delta_days = (RANDOM_MAX - RANDOM_MIN).days
    return (RANDOM_MIN + timedelta(days=random.randint(0, delta_days))).strftime("%Y-%m-%d")


# ── Langkah 4: Build member records ──────────────────────────────────────────

def build_members(
    df: pd.DataFrame,
    first_warnings: dict[str, pd.Period],
) -> list[dict]:
    """
    Bangun 300 member records.
    Kelompok 1: N_AEGIS toko dari toko_dengan_warning
    Kelompok 2: N_RANDOM toko dari sisa toko (tidak pernah warning atau tidak dipilih)
    """
    # Metadata toko: ambil snapshot terbaru per toko
    toko_meta = (
        df.sort_values("Tanggal Transaksi", ascending=False)
        .drop_duplicates("ID Toko")
        .set_index("ID Toko")[["Nama Toko", "Kabupaten Toko", "Cluster Pareto", "TSO"]]
    )

    all_toko = toko_meta.index.tolist()

    # ── Kelompok 1: AEGIS-triggered ──────────────────────────────────────────
    # Toko dengan first_warning di bulan terakhir (ROLL_END) dikeluarkan dari pool:
    # base(bulan_warning) + jitter(7-28h) akan jatuh di bulan berikutnya, yang
    # selalu di luar ENROLL_MAX → ter-cap mundur ke SEBELUM tanggal warning itu
    # sendiri (anakronistik). 7.100 kandidat tersedia, jadi exclude saja.
    excluded_last_month = {
        toko for toko, period in first_warnings.items() if period == ROLL_END
    }
    warning_toko_ids = [
        toko for toko in first_warnings if toko not in excluded_last_month
    ]
    n_available_warning = len(warning_toko_ids)

    if n_available_warning >= N_AEGIS:
        selected_aegis = random.sample(warning_toko_ids, N_AEGIS)
        fallback_note = (
            f"Tersedia {n_available_warning} toko dengan warning valid "
            f"({len(excluded_last_month)} toko dikeluarkan karena first_warning di bulan "
            f"terakhir {ROLL_END}, tidak ada tanggal masuk yang valid untuk toko tersebut), "
            f"diambil {N_AEGIS}. Tidak ada fallback."
        )
    else:
        # Fallback: pakai semua toko yang pernah warning, kekurangan dipenuhi dari random
        selected_aegis = warning_toko_ids
        shortfall = N_AEGIS - n_available_warning
        fallback_note = (
            f"FALLBACK: hanya {n_available_warning} toko yang pernah Merah/Oranye "
            f"(kurang {shortfall} dari target {N_AEGIS}). "
            f"{shortfall} toko tambahan diisi dari kelompok random dengan tgl_masuk acak."
        )

    selected_aegis_set = set(selected_aegis)

    # ── Kelompok 2: random dari sisa toko ────────────────────────────────────
    # "Sisa" = toko yang tidak dipilih di kelompok AEGIS (boleh pernah warning)
    sisa_toko = [t for t in all_toko if t not in selected_aegis_set]
    n_random_take = min(N_RANDOM, len(sisa_toko))
    selected_random = random.sample(sisa_toko, n_random_take)

    # ── Assemble records ──────────────────────────────────────────────────────
    members: list[dict] = []

    for id_toko in selected_aegis:
        first_warn = first_warnings.get(id_toko)

        if first_warn is not None:
            tgl_masuk = jitter_from_warning(first_warn)
            trigger   = "aegis_warning"
            first_str = str(first_warn)
        else:
            # Fallback toko: tidak pernah warning, dapat tanggal random
            tgl_masuk = random_date()
            trigger   = "proactive_random"
            first_str = None

        meta = _get_meta(toko_meta, id_toko)
        members.append({
            "id":                  str(uuid.uuid4()),
            "id_toko":             id_toko,
            "nama_toko":           meta["nama_toko"],
            "kabupaten":           meta["kabupaten"],
            "cluster_pareto":      meta["cluster_pareto"],
            "tso":                 meta["tso"],
            "status":              "Aktif",
            "reward_type":         "Emergency Boost",
            "reward_rate":         15000,
            "catatan":             "",
            "tgl_masuk":           tgl_masuk,
            "tgl_keluar":          None,
            "alasan_keluar":       None,
            "enrollment_trigger":  trigger,
            "first_warning_period": first_str,
        })

    for id_toko in selected_random:
        tgl_masuk = random_date()
        meta = _get_meta(toko_meta, id_toko)
        members.append({
            "id":                  str(uuid.uuid4()),
            "id_toko":             id_toko,
            "nama_toko":           meta["nama_toko"],
            "kabupaten":           meta["kabupaten"],
            "cluster_pareto":      meta["cluster_pareto"],
            "tso":                 meta["tso"],
            "status":              "Aktif",
            "reward_type":         "Standard",
            "reward_rate":         5000,
            "catatan":             "",
            "tgl_masuk":           tgl_masuk,
            "tgl_keluar":          None,
            "alasan_keluar":       None,
            "enrollment_trigger":  "proactive_random",
            "first_warning_period": None,
        })

    return members, fallback_note


def _get_meta(toko_meta: pd.DataFrame, id_toko: str) -> dict:
    if id_toko in toko_meta.index:
        row = toko_meta.loc[id_toko]
        return {
            "nama_toko":      str(row["Nama Toko"]),
            "kabupaten":      str(row["Kabupaten Toko"]),
            "cluster_pareto": str(row["Cluster Pareto"]),
            "tso":            str(row["TSO"]),
        }
    return {"nama_toko": "", "kabupaten": "", "cluster_pareto": "Bronze", "tso": ""}


# ── Langkah 5: Report & summary ───────────────────────────────────────────────

def print_report(members: list[dict], first_warnings: dict, fallback_note: str) -> None:
    df_m = pd.DataFrame(members)

    print("=" * 70)
    print("DRY RUN REPORT")
    print("=" * 70)

    print(f"\nTotal members    : {len(df_m)}")
    print(f"  AEGIS-triggered: {(df_m['enrollment_trigger'] == 'aegis_warning').sum()}")
    print(f"  Random/proaktif: {(df_m['enrollment_trigger'] == 'proactive_random').sum()}")
    print(f"\n{fallback_note}")

    # ── 10 baris sampel ──────────────────────────────────────────────────────
    print("\n─── 10 BARIS SAMPEL (5 AEGIS, 5 random) ───")
    aegis_sample  = df_m[df_m["enrollment_trigger"] == "aegis_warning"].head(5)
    random_sample = df_m[df_m["enrollment_trigger"] == "proactive_random"].head(5)
    sample = pd.concat([aegis_sample, random_sample])

    for _, row in sample.iterrows():
        warn = f"(first_warning: {row['first_warning_period']})" if row["first_warning_period"] else ""
        print(
            f"  {row['id_toko']}  {row['tgl_masuk']}  "
            f"{row['cluster_pareto']:15s}  {row['enrollment_trigger']:20s}  {warn}"
        )

    # ── Distribusi tgl_masuk per bulan ───────────────────────────────────────
    print("\n─── DISTRIBUSI tgl_masuk PER BULAN ───")
    df_m["_bulan"] = pd.to_datetime(df_m["tgl_masuk"]).dt.to_period("M")
    bulan_dist = df_m.groupby("_bulan").size().sort_index()

    for bulan, n in bulan_dist.items():
        bar = "█" * n
        print(f"  {str(bulan):10s}: {n:3d} toko  {bar}")

    # ── Distribusi cluster ───────────────────────────────────────────────────
    print("\n─── DISTRIBUSI CLUSTER (300 peserta vs semua toko) ───")
    cluster_order = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"]

    df = pd.read_parquet(str(DATA_PATH))
    all_cluster = (
        df.sort_values("Tanggal Transaksi", ascending=False)
        .drop_duplicates("ID Toko")["Cluster Pareto"]
        .value_counts()
    )
    total_all = all_cluster.sum()

    member_cluster = df_m["cluster_pareto"].value_counts()
    total_m = len(df_m)

    print(f"  {'Cluster':18s}  {'Peserta':>8s}  {'%peserta':>9s}  {'%semua_toko':>12s}")
    print(f"  {'-'*18}  {'-'*8}  {'-'*9}  {'-'*12}")
    for cl in cluster_order:
        n_m   = int(member_cluster.get(cl, 0))
        n_all = int(all_cluster.get(cl, 0))
        pct_m   = n_m / total_m * 100 if total_m else 0
        pct_all = n_all / total_all * 100 if total_all else 0
        print(f"  {cl:18s}  {n_m:>8d}  {pct_m:>8.1f}%  {pct_all:>11.1f}%")

    # ── Rentang tanggal ──────────────────────────────────────────────────────
    print(f"\n─── RENTANG TANGGAL ───")
    dates = sorted(df_m["tgl_masuk"].tolist())
    print(f"  Paling awal : {dates[0]}")
    print(f"  Paling akhir: {dates[-1]}")
    print(f"  Span        : {(pd.to_datetime(dates[-1]) - pd.to_datetime(dates[0])).days} hari")

    # ── Info fallback ─────────────────────────────────────────────────────────
    print(f"\n─── STATUS FALLBACK ───")
    print(f"  Toko pernah warning (Merah/Oranye) di 16 bulan: {len(first_warnings)}")
    print(f"  Target kelompok AEGIS-triggered                : {N_AEGIS}")
    if len(first_warnings) >= N_AEGIS:
        print(f"  → Cukup, tidak ada fallback yang dipakai.")
    else:
        print(f"  → Kurang {N_AEGIS - len(first_warnings)} toko, fallback ke tanggal random.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main(write_final: bool = False) -> None:
    print(f"Loading data transaksi...", flush=True)
    df = pd.read_parquet(str(DATA_PATH))
    print(f"  {len(df):,} baris, {df['ID Toko'].nunique():,} toko unik\n", flush=True)

    # 1. Rolling AEGIS
    alert_history = roll_historical_aegis(df)

    # 2. First warning per toko
    first_warnings = find_first_warnings(alert_history)
    print(f"Toko yang pernah Merah/Oranye: {len(first_warnings):,}\n", flush=True)

    # 3. Generate members
    members, fallback_note = build_members(df, first_warnings)

    # 4. Save dry run
    OUTPUT_DRYRUN.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_DRYRUN.write_text(
        json.dumps(members, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    print(f"\nDry run disimpan → {OUTPUT_DRYRUN}", flush=True)

    # 5. Print report
    print_report(members, first_warnings, fallback_note)

    if write_final:
        # Backup file lama
        if OUTPUT_FINAL.exists():
            OUTPUT_BACKUP.write_text(
                OUTPUT_FINAL.read_text(encoding="utf-8"), encoding="utf-8"
            )
            print(f"\nBackup lama disimpan → {OUTPUT_BACKUP}")

        OUTPUT_FINAL.write_text(
            json.dumps(members, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        print(f"File production diperbarui → {OUTPUT_FINAL}")


if __name__ == "__main__":
    # Jalankan dry run saja (default).
    # Untuk overwrite production: python regenerate_loyalty_enrollment.py --final
    write_final = "--final" in sys.argv
    main(write_final=write_final)

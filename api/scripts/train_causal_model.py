"""
Re-train Causal ML Engine (panel event-time DiD) — one-off, bukan production code.

Pakai data/transaksi_aegis_synthetic.parquet (full 21.014 toko), BUKAN
data/transaksi_sample_deploy.parquet (5.248 toko) yang dipakai api/core/
data_loader.get_data() di production — karena loyalty_members.json hasil
regenerasi disampling dari populasi 21.014 toko penuh; hanya 75/300
member yang muncul di sample deploy (lihat catatan di laporan akhir).

Output: api/data/models/causal_training_result.json (sama seperti yang
dipakai endpoint GET /api/causal/summary).
"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")

_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_ROOT))

from api.core.causal_engine import train_and_cache_causal_model  # noqa: E402

DATA_PATH    = _ROOT / "data" / "transaksi_aegis_synthetic.parquet"
MEMBERS_PATH = _ROOT / "api" / "data" / "loyalty_members.json"


def main() -> None:
    print(f"Loading data transaksi dari {DATA_PATH}...", flush=True)
    df = pd.read_parquet(str(DATA_PATH))
    print(f"  {len(df):,} baris, {df['ID Toko'].nunique():,} toko unik", flush=True)
    print(f"  Rentang: {df['Tanggal Transaksi'].min()} – {df['Tanggal Transaksi'].max()}\n", flush=True)

    members = json.loads(MEMBERS_PATH.read_text(encoding="utf-8"))
    print(f"Loyalty members: {len(members)} toko\n", flush=True)

    result = train_and_cache_causal_model(df, members)

    if result.get("status") == "error":
        print(f"ERROR: {result['message']}", flush=True)
        sys.exit(1)

    print("=" * 70, flush=True)
    print("CAUSAL TRAINING REPORT", flush=True)
    print("=" * 70, flush=True)

    s = result["sample"]
    print(f"\nDesign         : {result['design']}")
    print(f"Window         : pre={result['window']['pre_months']}bln, post={result['window']['post_months']}bln")
    print(f"Data range     : {s['data_range']}")
    print(f"Treated input  : {s['n_treated_input']}")
    print(f"Treated valid  : {s['n_treated_valid']}  (excluded: {s['n_treated_excluded']})")
    print(f"Control        : {s['n_control']}")
    print(f"Total observasi: {result['n_observations']}")

    print(f"\n--- Naive DiD (tanpa confounder adjustment) ---")
    print(f"  ATT: {result['att_naive_pct']:+.1f}%  (log: {result['att_naive_log']:+.4f})")

    print(f"\n--- Conditional DiD (DoWhy backdoor + confounders) ---")
    print(f"  ATE: {result['ate_pct']:+.1f}%  (~{result['ate_level_approx']:+.1f} ton/bulan)")
    print(f"  {result['ate_interpretation']}")

    print(f"\n--- Refutation (random common cause) ---")
    print(f"  Passed: {result['refutation_passed']}")
    print(f"  {result['refutation_detail']['verdict']}")

    print(f"\n--- CausalForestDML (CATE) ---")
    print(f"  ATE forest (median CATE): {result['ate_forest_pct']:+.1f}%")
    cd = result["cate_distribution"]
    print(f"  n_toko_total={cd['n_toko_total']}  n_negative_effect={cd['n_negative_effect']}")
    print(f"  median_cate_log={cd['median_cate_log']}  p25={cd['p25_cate_log']}  p75={cd['p75_cate_log']}")
    print(f"  min={cd['min_cate_log']}  max={cd['max_cate_log']}")

    if s["n_treated_excluded"] > 0:
        print(f"\n--- Toko dikeluarkan (window pre/post tidak cukup) ---")
        # excluded_detail tidak disimpan ke cache result (hanya dihitung), jadi
        # re-derive dari prepare_causal_panel_dataset untuk laporan ini saja.
        from api.core.causal_engine import prepare_causal_panel_dataset
        _, meta = prepare_causal_panel_dataset(df, members)
        for row in meta["excluded_detail"]:
            print(f"  {row['id_toko']}  tgl_masuk={row['tgl_masuk']}")

    print(f"\nTraining selesai dalam {result['training_seconds']}s")
    print(f"Cache disimpan → api/data/models/causal_training_result.json")


if __name__ == "__main__":
    main()

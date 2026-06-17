import functools
import os
import traceback
from pathlib import Path

import pandas as pd

DATA_DIR         = Path(os.getenv("DATA_DIR", "data"))
PARQUET_FILENAME = os.getenv("PARQUET_FILENAME", "transaksi_sample_deploy.parquet")
DATA_PATH        = DATA_DIR / PARQUET_FILENAME

_df_cache = None


def preload_data() -> None:
    global _df_cache
    if _df_cache is not None:
        print("[data_loader] Cache sudah ada, skip", flush=True)
        return
    try:
        if not DATA_PATH.exists():
            print(f"[data_loader] File tidak ditemukan: {DATA_PATH}", flush=True)
            return
        print(f"[data_loader] Loading {DATA_PATH}...", flush=True)
        _df_cache = pd.read_parquet(DATA_PATH)

        # Convert any category columns to native types so engine arithmetic works
        for col in _df_cache.columns:
            if hasattr(_df_cache[col], "cat"):
                _df_cache[col] = _df_cache[col].astype(str)

        for col in ["TON Quantity", "Zak Quantity"]:
            if col in _df_cache.columns:
                _df_cache[col] = pd.to_numeric(_df_cache[col], errors="coerce").fillna(0)
        if "Harga" in _df_cache.columns:
            _df_cache["Harga"] = pd.to_numeric(_df_cache["Harga"], errors="coerce").fillna(0)

        _df_cache["Tanggal Transaksi"] = pd.to_datetime(
            _df_cache["Tanggal Transaksi"], errors="coerce"
        )
        _df_cache = (
            _df_cache
            .dropna(subset=["Tanggal Transaksi"])
            .sort_values("Tanggal Transaksi")
            .reset_index(drop=True)
        )
        mb = _df_cache.memory_usage(deep=True).sum() / 1024 / 1024
        print(f"[data_loader] Loaded: {len(_df_cache):,} baris, {mb:.1f} MB", flush=True)
    except Exception as e:
        print(f"[data_loader] ERROR: {e}", flush=True)
        traceback.print_exc()


def get_data() -> pd.DataFrame:
    global _df_cache
    if _df_cache is None:
        preload_data()
    return _df_cache


@functools.lru_cache(maxsize=1)
def load_data() -> pd.DataFrame:
    return get_data()

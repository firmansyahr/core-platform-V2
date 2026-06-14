import functools
import os
from pathlib import Path

import pandas as pd

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
DATA_PATH = DATA_DIR / "transaksi_aegis_synthetic.parquet"


@functools.lru_cache(maxsize=1)
def load_data() -> pd.DataFrame:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"File data tidak ditemukan: {DATA_PATH}\n"
            f"Set environment variable DATA_DIR ke path yang benar."
        )
    df = pd.read_parquet(DATA_PATH)
    df["Tanggal Transaksi"] = pd.to_datetime(df["Tanggal Transaksi"], errors="coerce")
    return (
        df.dropna(subset=["Tanggal Transaksi"])
        .sort_values("Tanggal Transaksi")
        .reset_index(drop=True)
    )

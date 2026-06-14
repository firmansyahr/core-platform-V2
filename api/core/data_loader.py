import functools
from pathlib import Path

import pandas as pd

DATA_PATH = Path("data/transaksi_aegis_synthetic.parquet")


@functools.lru_cache(maxsize=1)
def load_data() -> pd.DataFrame:
    df = pd.read_parquet(DATA_PATH)
    df["Tanggal Transaksi"] = pd.to_datetime(df["Tanggal Transaksi"], errors="coerce")
    return (
        df.dropna(subset=["Tanggal Transaksi"])
        .sort_values("Tanggal Transaksi")
        .reset_index(drop=True)
    )

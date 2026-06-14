import os
import pandas as pd
import streamlit as st
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DATA_SOURCE  = os.getenv("DATA_SOURCE", "parquet")
DATABASE_URL = os.getenv("DATABASE_URL", "")
DATA_DIR     = Path("data/raw")

@st.cache_data(ttl=3600)
def load_aegis() -> pd.DataFrame:
    if DATA_SOURCE == "postgres":
        return _from_postgres("SELECT * FROM transaksi")
    return _from_parquet(DATA_DIR / "transaksi_aegis_synthetic.parquet")

def load_ilp() -> pd.DataFrame:
    return load_aegis()

def _from_parquet(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    df["Tanggal Transaksi"] = pd.to_datetime(
        df["Tanggal Transaksi"], errors="coerce")
    return (df.dropna(subset=["Tanggal Transaksi"])
              .sort_values("Tanggal Transaksi")
              .reset_index(drop=True))

def _from_postgres(query: str) -> pd.DataFrame:
    from sqlalchemy import create_engine, text
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        df = pd.read_sql(text(query), conn)
    df["Tanggal Transaksi"] = pd.to_datetime(
        df["Tanggal Transaksi"], errors="coerce")
    return (df.dropna(subset=["Tanggal Transaksi"])
              .sort_values("Tanggal Transaksi")
              .reset_index(drop=True))

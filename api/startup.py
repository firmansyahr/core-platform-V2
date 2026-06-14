"""Pre-startup script: download parquet data if not already present."""
import os
import sys
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
PARQUET_PATH = DATA_DIR / "transaksi_aegis_synthetic.parquet"
PARQUET_URL = os.getenv("PARQUET_URL", "")


def ensure_data() -> None:
    if PARQUET_PATH.exists():
        print(f"[startup] Data sudah ada: {PARQUET_PATH}", flush=True)
        return

    if not PARQUET_URL:
        print(
            "[startup] ERROR: PARQUET_PATH tidak ditemukan dan PARQUET_URL tidak di-set.",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[startup] Mengunduh data dari {PARQUET_URL} ...", flush=True)

    import urllib.request
    urllib.request.urlretrieve(PARQUET_URL, PARQUET_PATH)
    print(f"[startup] Download selesai → {PARQUET_PATH}", flush=True)


if __name__ == "__main__":
    ensure_data()

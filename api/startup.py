"""Pre-startup script: download parquet data if not already present."""
import os
import sys
from pathlib import Path

DATA_DIR         = Path(os.getenv("DATA_DIR", "data"))
PARQUET_FILENAME = os.getenv("PARQUET_FILENAME", "transaksi_sample_deploy.parquet")
PARQUET_PATH     = DATA_DIR / PARQUET_FILENAME
PARQUET_URL      = os.getenv("PARQUET_URL", "")


def ensure_data() -> None:
    if PARQUET_PATH.exists():
        size_mb = PARQUET_PATH.stat().st_size / 1024 / 1024
        print(f"[startup] Data sudah ada: {PARQUET_PATH} ({size_mb:.1f} MB)", flush=True)
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

    size_mb = PARQUET_PATH.stat().st_size / 1024 / 1024
    print(f"[startup] Download selesai → {PARQUET_PATH} ({size_mb:.1f} MB)", flush=True)


if __name__ == "__main__":
    ensure_data()

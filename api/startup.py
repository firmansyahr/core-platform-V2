"""Pre-startup script: download parquet data if not already present."""
import json
import os
import sys
from pathlib import Path

DATA_DIR         = Path(os.getenv("DATA_DIR", "data"))
PARQUET_FILENAME = os.getenv("PARQUET_FILENAME", "transaksi_sample_deploy.parquet")
PARQUET_PATH     = DATA_DIR / PARQUET_FILENAME
PARQUET_URL      = os.getenv("PARQUET_URL", "")

_DEFAULT_LOYALTY_CONFIG = {
    "w1": 0.6, "w2": 0.4,
    "min_pct_sp": 0.80, "min_pct_platinum": 0.70,
    "min_pct_gold": 0.60, "min_pct_silver": 0.50,
    "growth_rates": {
        "default": {"normal": 0.03, "warning": 0.01, "kritis": 0.00},
        "overrides": [],
    },
}

_FILE_DEFAULTS: dict = {
    "loyalty_members.json": [],
    "loyalty_history.json": [],
    "loyalty_config.json":  _DEFAULT_LOYALTY_CONFIG,
    "promos.json":          [],
    "cad_history.json":     [],
}


def _get_data_dir() -> Path:
    vol = Path("/mnt/data")
    if vol.exists() and os.access(vol, os.W_OK):
        d = vol / "app_data"
        d.mkdir(parents=True, exist_ok=True)
        return d
    d = Path("api/data")
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_data_files() -> None:
    data_dir = _get_data_dir()
    for filename, default in _FILE_DEFAULTS.items():
        filepath = data_dir / filename
        if not filepath.exists():
            print(f"[startup] Membuat {filepath}...", flush=True)
            filepath.write_text(
                json.dumps(default, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
    print(f"[startup] Data files ready di {data_dir}", flush=True)


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

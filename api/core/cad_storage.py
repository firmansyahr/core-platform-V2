"""
Local JSON storage for CAD Alert History.
Thread-safe read/write via _lock.
"""
import json
import logging
import os
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional


def _get_data_dir() -> Path:
    vol = Path("/mnt/data")
    if vol.exists() and os.access(vol, os.W_OK):
        d = vol / "app_data"
        d.mkdir(parents=True, exist_ok=True)
        return d
    d = Path(__file__).parent.parent / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


_DATA_DIR  = _get_data_dir()
_HIST_FILE = _DATA_DIR / "cad_history.json"
_lock      = threading.Lock()
_log       = logging.getLogger(__name__)


# ── Low-level I/O ─────────────────────────────────────────────────────────────

def _read() -> list[dict]:
    if not _HIST_FILE.exists():
        return []
    with open(_HIST_FILE, encoding="utf-8") as f:
        return json.load(f)


def _write(records: list[dict]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_HIST_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)


# ── Core build logic ──────────────────────────────────────────────────────────

def _build_records_from_cad() -> tuple[list[dict], list[str]]:
    """
    Computes CAD alert records from the current AEGIS engine snapshot.
    Returns (all_records_including_existing, list_of_newly_created_ids).
    """
    import pandas as pd
    from api.core.aegis_engine import get_store_crs

    existing      = _read()
    existing_ids  = {r["id"] for r in existing}

    stores  = get_store_crs()
    warning = stores[stores["alert"] != "Normal"].dropna(subset=["Kabupaten Toko"])
    if warning.empty:
        return existing, []

    kab_cad = warning.groupby("Kabupaten Toko")["cad"].any()
    kab_has_merah = (
        warning[warning["alert"] == "Merah"]
        .groupby("Kabupaten Toko")["ID Toko"].count().gt(0)
        .reindex(kab_cad.index, fill_value=False)
    )
    kab_count = warning.groupby("Kabupaten Toko")["ID Toko"].count()
    kab_score = warning.groupby("Kabupaten Toko")["aegis_score"].mean().round(1)

    kab_df = pd.DataFrame({
        "has_cad":          kab_cad,
        "has_merah":        kab_has_merah,
        "jumlah_toko":      kab_count,
        "aegis_score_rata": kab_score,
    })
    kab_df["status_alert"] = "KUNING"
    kab_df.loc[kab_df["has_merah"], "status_alert"] = "MERAH"
    kab_df.loc[kab_df["has_cad"],   "status_alert"] = "KRITIS"

    today    = date.today().isoformat()
    now_iso  = datetime.now(timezone.utc).isoformat()
    date_tag = date.today().strftime("%Y%m%d")

    all_records: list[dict] = list(existing)
    created_ids: list[str]  = []

    for kab, row in kab_df.iterrows():
        kab_str   = str(kab)
        kab_clean = (
            kab_str.upper()
            .replace(" ", "_").replace(".", "").replace("/", "_")[:28]
        )
        rec_id = f"CAD-{date_tag}-{kab_clean}"

        if rec_id in existing_ids:
            continue

        all_records.append({
            "id":                rec_id,
            "kabupaten":         kab_str,
            "tanggal_alert":     today,
            "status_alert":      str(row["status_alert"]),
            "jumlah_toko":       int(row["jumlah_toko"]),
            "aegis_score_rata":  float(row.get("aegis_score_rata") or 0),
            "tso_assigned":      None,
            "tanggal_kunjungan": None,
            "hasil_validasi":    None,
            "catatan":           None,
            "status_resolusi":   "OPEN",
            "tanggal_resolved":  None,
            "created_at":        now_iso,
        })
        created_ids.append(rec_id)

    return all_records, created_ids


# ── Public API ────────────────────────────────────────────────────────────────

def initialize_cad_history() -> None:
    """Called at startup. Skips entirely if file already exists."""
    if _HIST_FILE.exists():
        return
    try:
        records, created = _build_records_from_cad()
        with _lock:
            _write(records)
        _log.info(f"CAD history initialized: {len(created)} records created.")
    except Exception as exc:
        _log.warning(f"CAD history init failed: {exc}")


def generate_from_cad_alerts() -> tuple[int, int]:
    """Re-sync from current CAD alerts, skipping already-existing IDs."""
    before_count = len(_read())
    try:
        all_records, created_ids = _build_records_from_cad()
        with _lock:
            _write(all_records)
        return len(created_ids), before_count
    except Exception as exc:
        _log.warning(f"CAD history generate failed: {exc}")
        return 0, before_count


def get_records(
    status: Optional[str] = None,
    kabupaten: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    records = sorted(
        _read(),
        key=lambda r: (r.get("tanggal_alert", ""), r.get("kabupaten", "")),
        reverse=True,
    )
    if status:
        records = [r for r in records if r.get("status_resolusi") == status]
    if kabupaten:
        q = kabupaten.strip().lower()
        records = [r for r in records if q in r.get("kabupaten", "").lower()]
    total = len(records)
    return records[offset : offset + limit], total


def update_record(rec_id: str, updates: dict) -> Optional[dict]:
    with _lock:
        records = _read()
        for i, r in enumerate(records):
            if r["id"] == rec_id:
                merged = {**r, **{k: v for k, v in updates.items() if v is not None}}
                if (updates.get("status_resolusi") == "RESOLVED"
                        and not r.get("tanggal_resolved")):
                    merged["tanggal_resolved"] = date.today().isoformat()
                records[i] = merged
                _write(records)
                return records[i]
    return None


def get_summary() -> dict:
    records   = _read()
    total     = len(records)
    open_     = sum(1 for r in records if r.get("status_resolusi") == "OPEN")
    in_prog   = sum(1 for r in records if r.get("status_resolusi") == "IN_PROGRESS")
    resolved  = sum(1 for r in records if r.get("status_resolusi") == "RESOLVED")

    validated  = [r for r in records if r.get("hasil_validasi")]
    pct_val    = round(len(validated) / total * 100, 1) if total else 0.0
    kompetitor = [r for r in validated if r.get("hasil_validasi") == "KOMPETITOR_EKSTERNAL"]
    pct_komp   = round(len(kompetitor) / len(validated) * 100, 1) if validated else 0.0

    days: list[int] = []
    for r in records:
        if r.get("tanggal_kunjungan") and r.get("tanggal_alert"):
            try:
                d = (
                    date.fromisoformat(r["tanggal_kunjungan"])
                    - date.fromisoformat(r["tanggal_alert"])
                ).days
                if d >= 0:
                    days.append(d)
            except ValueError:
                pass
    avg_days = round(sum(days) / len(days), 1) if days else 0.0

    return {
        "total_alert":       total,
        "open":              open_,
        "in_progress":       in_prog,
        "resolved":          resolved,
        "pct_validated":     pct_val,
        "pct_kompetitor":    pct_komp,
        "avg_response_days": avg_days,
    }

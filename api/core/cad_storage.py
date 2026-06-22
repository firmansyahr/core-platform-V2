"""
Storage for CAD Alert History — JSON (legacy) atau SQLite, lihat USE_SQLITE.
Thread-safe read/write via _lock (cabang JSON saja, lihat catatan di
loyalty.py/promo.py untuk alasan SQLite tidak butuh lock app-level).
"""
import json
import logging
import os
import threading
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from api.database import SessionLocal
from api.models import CADAlert as CADAlertRow
from api.models import CADValidasiToko as CADValidasiTokoRow


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

# Feature flag — Tahap 4c rollout, pola identik dengan loyalty.py/promo.py.
USE_SQLITE = os.getenv("USE_SQLITE_STORAGE", "false").lower() == "true"

KATEGORI_CHOICES = [
    "Kompetitor Eksternal",
    "Masalah Harga / Gap Harga Besar",
    "Masalah Stok / Keterlambatan Kirim",
    "Faktor Seasonal",
    "Faktor Internal Distributor",
    "Kondisi Normal / False Alarm",
    "Butuh Investigasi Lanjut",
]

_OLD_HASIL_MAP: dict[str, str] = {
    "KOMPETITOR_EKSTERNAL": "Kompetitor Eksternal",
    "MASALAH_LOGISTIK":     "Masalah Stok / Keterlambatan Kirim",
    "MASALAH_STOK":         "Masalah Stok / Keterlambatan Kirim",
    "TIDAK_ADA_MASALAH":    "Kondisi Normal / False Alarm",
    "LAINNYA":              "Butuh Investigasi Lanjut",
}


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


# ── Schema normalization ───────────────────────────────────────────────────────

def _status_from_resolusi(resolusi: str) -> str:
    mapping = {"OPEN": "Pending Validasi", "IN_PROGRESS": "In Progress", "RESOLVED": "Resolved"}
    return mapping.get(resolusi, "Pending Validasi")


def _ensure_new_fields(record: dict) -> dict:
    """Return a copy of the record with all new-schema fields filled in from defaults."""
    r = dict(record)

    # Unified date aliases
    if "tgl_alert" not in r:
        r["tgl_alert"] = r.get("tanggal_alert")
    if "provinsi" not in r:
        r["provinsi"] = None
    if "tgl_validasi" not in r:
        r["tgl_validasi"] = r.get("tanggal_kunjungan")
    if "validated_by" not in r:
        r["validated_by"] = r.get("tso_assigned")

    # Status (unified human-readable)
    if "status" not in r:
        fu = r.get("follow_up") or {}
        if isinstance(fu, dict) and fu.get("eskalasi_asm"):
            r["status"] = "Butuh Eskalasi"
        else:
            r["status"] = _status_from_resolusi(r.get("status_resolusi", "OPEN"))

    # kondisi_alert block
    if "kondisi_alert" not in r or not isinstance(r.get("kondisi_alert"), dict):
        jumlah = r.get("jumlah_toko", 0)
        r["kondisi_alert"] = {
            "total_toko_warning": jumlah,
            "merah_count":        0,
            "oranye_count":       0,
            "kuning_count":       jumlah,
            "avg_aegis_score":    r.get("aegis_score_rata", 0.0),
            "pola_dominan":       "B" if r.get("status_alert") == "KRITIS" else "A",
        }

    # hasil_validasi_detail (structured; separate from legacy string hasil_validasi)
    if "hasil_validasi_detail" not in r:
        old = r.get("hasil_validasi")
        if isinstance(old, str) and old:
            r["hasil_validasi_detail"] = {
                "kategori_utama":          _OLD_HASIL_MAP.get(old, old),
                "kategori_sekunder":       None,
                "toko_dikunjungi":         None,
                "toko_terdampak":          None,
                "toko_false_alarm":        None,
                "toko_butuh_investigasi":  None,
                "detail_kompetitor":       None,
                "detail_stok":             None,
                "detail_harga":            None,
                "distribusi_kondisi":      [],
                "target_resolusi":         None,
                "action_items":            r.get("catatan"),
                "catatan_detail":          None,
            }
        else:
            r["hasil_validasi_detail"] = None

    # toko_validasi list
    if "toko_validasi" not in r:
        r["toko_validasi"] = []

    # follow_up block
    if "follow_up" not in r or not isinstance(r.get("follow_up"), dict):
        r["follow_up"] = {
            "status":        r.get("status", "Pending Validasi"),
            "reminder_sent": False,
            "eskalasi_asm":  False,
            "resolved_at":   r.get("tanggal_resolved"),
        }

    return r


def _check_overdue(record: dict) -> bool:
    """True if In Progress and last update > 14 days ago."""
    if record.get("status_resolusi") != "IN_PROGRESS":
        return False
    tgl = (record.get("tanggal_kunjungan") or record.get("tgl_validasi")
           or record.get("tanggal_alert") or record.get("tgl_alert"))
    if not tgl:
        return False
    try:
        return (date.today() - date.fromisoformat(tgl)).days > 14
    except ValueError:
        return False


# ── Storage abstraction (JSON / SQLite) ────────────────────────────────────────
#
# Pola identik dengan loyalty.py/promo.py. Model CADAlert hanya punya kolom
# KANONIK (tgl_alert/tgl_validasi/validated_by) — nama legacy (tanggal_alert/
# tanggal_kunjungan/tso_assigned) DIBUANG dari skema sesuai desain awal model.
# Tapi export.py (CSV) dan beberapa logic internal di sini (_check_overdue,
# dst.) masih baca nama LEGACY — jadi _cad_alert_to_dict() WAJIB isi KEDUA
# nama key dengan nilai yang sama, bukan cuma kanonik.
#
# Ditemukan saat audit: 1 record production (CAD-20260617-KOTA_PALANGKA_RAYA)
# punya field legacy & kanonik yang DIVERGEN (update_record() lama hanya
# menulis nama legacy, tidak pernah sinkron ke kanonik). Keputusan: saat
# migrasi/tulis baru, COALESCE kanonik-dulu-fallback-legacy ke satu nilai,
# lalu nilai itu yang dipakai untuk kedua nama key saat dibaca balik —
# konsisten dengan niat desain model ("kolom legacy dibuang").

def _iso_utc(dt: datetime | None) -> str | None:
    """Sama seperti promo.py — SQLite/SQLAlchemy melepas tzinfo kolom
    DateTime saat dibaca balik; semua datetime di sini selalu ditulis UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _toko_validasi_to_dict(t: "CADValidasiTokoRow") -> dict:
    return {
        "id_toko":      t.id_toko,
        "nama_toko":    t.nama_toko,
        "aegis_score":  t.aegis_score,
        "kondisi":      t.kondisi,
        "catatan":      t.catatan,
        "validated_by": t.validated_by,
        "validated_at": _iso_utc(t.validated_at),
    }


def _cad_alert_to_dict(a: "CADAlertRow", toko_rows: list) -> dict:
    tgl_alert_str     = a.tgl_alert.isoformat() if a.tgl_alert else None
    tgl_validasi_str  = a.tgl_validasi.isoformat() if a.tgl_validasi else None
    resolved_str      = a.tanggal_resolved.isoformat() if a.tanggal_resolved else None
    return {
        "id":                    a.id,
        "kabupaten":             a.kabupaten,
        "provinsi":              a.provinsi,
        "tgl_alert":             tgl_alert_str,
        "tanggal_alert":         tgl_alert_str,
        "status_alert":          a.status_alert,
        "jumlah_toko":           a.jumlah_toko,
        "aegis_score_rata":      a.aegis_score_rata,
        "tgl_validasi":          tgl_validasi_str,
        "tanggal_kunjungan":     tgl_validasi_str,
        "validated_by":          a.validated_by,
        "tso_assigned":          a.validated_by,
        "hasil_validasi":        a.hasil_validasi,
        "hasil_validasi_detail": a.hasil_validasi_detail,
        "catatan":               a.catatan,
        "status_resolusi":       a.status_resolusi,
        "status":                a.status,
        "tanggal_resolved":      resolved_str,
        "created_at":            _iso_utc(a.created_at),
        "kondisi_alert":         a.kondisi_alert,
        "follow_up":             a.follow_up,
        "toko_validasi":         [_toko_validasi_to_dict(t) for t in toko_rows],
    }


def _get_all_records() -> list[dict]:
    """Semua record CAD, belum di-sort/filter/paginasi — dipakai get_records(),
    get_record_by_id(), get_toko_cad_history(), get_summary(). Hasil tetap
    di-pass lewat _ensure_new_fields() oleh pemanggil (idempotent — no-op
    untuk dict yang sudah lengkap dari SQLite, tetap berfungsi penuh untuk
    JSON lama)."""
    if USE_SQLITE:
        db = SessionLocal()
        try:
            alerts = db.query(CADAlertRow).all()
            out = []
            for a in alerts:
                toko_rows = (
                    db.query(CADValidasiTokoRow)
                    .filter_by(cad_alert_id=a.id)
                    .order_by(CADValidasiTokoRow.id)
                    .all()
                )
                out.append(_cad_alert_to_dict(a, toko_rows))
            return out
        finally:
            db.close()
    return _read()


# ── Core build logic ──────────────────────────────────────────────────────────

def _build_records_from_cad() -> tuple[list[dict], list[str]]:
    import pandas as pd
    from api.core.aegis_engine import get_store_crs

    existing     = _get_all_records()
    existing_ids = {r["id"] for r in existing}

    stores  = get_store_crs()
    warning = stores[stores["alert"] != "Normal"].dropna(subset=["Kabupaten Toko"])
    if warning.empty:
        return existing, []

    kab_cad      = warning.groupby("Kabupaten Toko")["cad"].any()
    kab_has_merah = (
        warning[warning["alert"] == "Merah"]
        .groupby("Kabupaten Toko")["ID Toko"].count().gt(0)
        .reindex(kab_cad.index, fill_value=False)
    )
    kab_count = warning.groupby("Kabupaten Toko")["ID Toko"].count()
    kab_score = warning.groupby("Kabupaten Toko")["aegis_score"].mean().round(1)

    kab_merah_count  = (warning[warning["alert"] == "Merah"]
                        .groupby("Kabupaten Toko")["ID Toko"].count()
                        .reindex(kab_cad.index, fill_value=0))
    kab_oranye_count = (warning[warning["alert"] == "Oranye"]
                        .groupby("Kabupaten Toko")["ID Toko"].count()
                        .reindex(kab_cad.index, fill_value=0))
    kab_kuning_count = (warning[warning["alert"] == "Kuning"]
                        .groupby("Kabupaten Toko")["ID Toko"].count()
                        .reindex(kab_cad.index, fill_value=0))

    pola_mode = None
    if "pola_kode" in warning.columns:
        pola_mode = (warning.groupby("Kabupaten Toko")["pola_kode"]
                     .agg(lambda x: x.mode().iloc[0] if len(x) > 0 else "B")
                     .reindex(kab_cad.index, fill_value="B"))

    kab_df = pd.DataFrame({
        "has_cad":          kab_cad,
        "has_merah":        kab_has_merah,
        "jumlah_toko":      kab_count,
        "aegis_score_rata": kab_score,
        "merah_count":      kab_merah_count,
        "oranye_count":     kab_oranye_count,
        "kuning_count":     kab_kuning_count,
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

        pola = "B"
        if pola_mode is not None:
            try:
                pola = str(pola_mode.loc[kab])
            except Exception:
                pola = "B"

        all_records.append({
            "id":                    rec_id,
            "kabupaten":             kab_str,
            "provinsi":              None,
            "tanggal_alert":         today,
            "tgl_alert":             today,
            "status_alert":          str(row["status_alert"]),
            "jumlah_toko":           int(row["jumlah_toko"]),
            "aegis_score_rata":      float(row.get("aegis_score_rata") or 0),
            "tso_assigned":          None,
            "tanggal_kunjungan":     None,
            "tgl_validasi":          None,
            "validated_by":          None,
            "hasil_validasi":        None,
            "hasil_validasi_detail": None,
            "catatan":               None,
            "status_resolusi":       "OPEN",
            "status":                "Pending Validasi",
            "tanggal_resolved":      None,
            "created_at":            now_iso,
            "kondisi_alert": {
                "total_toko_warning": int(row["jumlah_toko"]),
                "merah_count":        int(row.get("merah_count", 0)),
                "oranye_count":       int(row.get("oranye_count", 0)),
                "kuning_count":       int(row.get("kuning_count", 0)),
                "avg_aegis_score":    float(row.get("aegis_score_rata") or 0),
                "pola_dominan":       pola,
            },
            "toko_validasi": [],
            "follow_up": {
                "status":        "Pending Validasi",
                "reminder_sent": False,
                "eskalasi_asm":  False,
                "resolved_at":   None,
            },
        })
        created_ids.append(rec_id)

    return all_records, created_ids


# ── Public API ────────────────────────────────────────────────────────────────

def generate_from_cad_alerts() -> tuple[int, int]:
    before_count = len(_get_all_records())
    try:
        all_records, created_ids = _build_records_from_cad()
        if USE_SQLITE:
            if created_ids:
                new_records = [r for r in all_records if r["id"] in created_ids]
                db = SessionLocal()
                try:
                    for r in new_records:
                        db.add(CADAlertRow(
                            id=r["id"], kabupaten=r["kabupaten"], provinsi=r.get("provinsi"),
                            tgl_alert=date.fromisoformat(r["tgl_alert"]),
                            status_alert=r["status_alert"], jumlah_toko=r["jumlah_toko"],
                            aegis_score_rata=r["aegis_score_rata"],
                            tgl_validasi=None, validated_by=None,
                            hasil_validasi=None, hasil_validasi_detail=None, catatan=None,
                            status_resolusi="OPEN", status="Pending Validasi", tanggal_resolved=None,
                            kondisi_alert=r["kondisi_alert"], follow_up=r["follow_up"],
                        ))
                    db.commit()
                finally:
                    db.close()
        else:
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
        _get_all_records(),
        key=lambda r: (r.get("tanggal_alert") or r.get("tgl_alert") or "", r.get("kabupaten", "")),
        reverse=True,
    )

    normalized = []
    for r in records:
        nr = _ensure_new_fields(r)
        overdue = _check_overdue(r)
        nr["overdue"] = overdue
        if overdue and not (nr["follow_up"] or {}).get("reminder_sent"):
            nr["follow_up"]["reminder_sent"] = True
        normalized.append(nr)

    if status and status != "all":
        if status in ("OPEN", "IN_PROGRESS", "RESOLVED"):
            normalized = [r for r in normalized if r.get("status_resolusi") == status]
        else:
            normalized = [r for r in normalized if r.get("status") == status]

    if kabupaten:
        q = kabupaten.strip().lower()
        normalized = [r for r in normalized if q in r.get("kabupaten", "").lower()]

    total = len(normalized)
    return normalized[offset: offset + limit], total


def get_record_by_id(rec_id: str) -> Optional[dict]:
    for r in _get_all_records():
        if r["id"] == rec_id:
            nr = _ensure_new_fields(r)
            nr["overdue"] = _check_overdue(r)
            return nr
    return None


def update_record(rec_id: str, updates: dict) -> Optional[dict]:
    if USE_SQLITE:
        db = SessionLocal()
        try:
            a = db.query(CADAlertRow).filter_by(id=rec_id).first()
            if a is None:
                return None
            if "tso_assigned" in updates:
                a.validated_by = updates["tso_assigned"]
            if "tanggal_kunjungan" in updates:
                a.tgl_validasi = date.fromisoformat(updates["tanggal_kunjungan"])
            if "hasil_validasi" in updates:
                a.hasil_validasi = updates["hasil_validasi"]
            if "catatan" in updates:
                a.catatan = updates["catatan"]
            if "status_resolusi" in updates:
                a.status_resolusi = updates["status_resolusi"]
                if updates["status_resolusi"] == "RESOLVED" and not a.tanggal_resolved:
                    a.tanggal_resolved = date.today()
                    a.status = "Resolved"
                elif updates["status_resolusi"] == "IN_PROGRESS":
                    a.status = "In Progress"
            db.commit()
            toko_rows = (
                db.query(CADValidasiTokoRow).filter_by(cad_alert_id=a.id)
                .order_by(CADValidasiTokoRow.id).all()
            )
            return _ensure_new_fields(_cad_alert_to_dict(a, toko_rows))
        finally:
            db.close()
    with _lock:
        records = _read()
        for i, r in enumerate(records):
            if r["id"] == rec_id:
                merged = {**r, **{k: v for k, v in updates.items() if v is not None}}
                if updates.get("status_resolusi") == "RESOLVED" and not r.get("tanggal_resolved"):
                    merged["tanggal_resolved"] = date.today().isoformat()
                    merged["status"] = "Resolved"
                elif updates.get("status_resolusi") == "IN_PROGRESS":
                    merged["status"] = "In Progress"
                records[i] = merged
                _write(records)
                return _ensure_new_fields(records[i])
    return None


def validate_record(
    rec_id: str,
    hasil_detail: dict,
    validated_by: str,
    tgl_validasi: str,
) -> Optional[dict]:
    """Store structured validation data into the record."""
    _REV_MAP = {v: k for k, v in _OLD_HASIL_MAP.items()}
    if USE_SQLITE:
        db = SessionLocal()
        try:
            a = db.query(CADAlertRow).filter_by(id=rec_id).first()
            if a is None:
                return None
            kategori = hasil_detail.get("kategori_utama", "")
            a.tgl_validasi          = date.fromisoformat(tgl_validasi)
            a.validated_by          = validated_by
            a.hasil_validasi        = _REV_MAP.get(kategori, "LAINNYA")
            a.hasil_validasi_detail = hasil_detail
            a.catatan               = hasil_detail.get("action_items")
            a.status_resolusi       = "IN_PROGRESS"
            a.status                = "In Progress"
            db.commit()
            toko_rows = (
                db.query(CADValidasiTokoRow).filter_by(cad_alert_id=a.id)
                .order_by(CADValidasiTokoRow.id).all()
            )
            return _ensure_new_fields(_cad_alert_to_dict(a, toko_rows))
        finally:
            db.close()
    with _lock:
        records = _read()
        for i, r in enumerate(records):
            if r["id"] == rec_id:
                kategori = hasil_detail.get("kategori_utama", "")
                old_hasil = _REV_MAP.get(kategori, "LAINNYA")
                records[i] = {
                    **r,
                    "tgl_validasi":          tgl_validasi,
                    "tanggal_kunjungan":     tgl_validasi,
                    "validated_by":          validated_by,
                    "tso_assigned":          validated_by,
                    "hasil_validasi":        old_hasil,
                    "hasil_validasi_detail": hasil_detail,
                    "catatan":               hasil_detail.get("action_items"),
                    "status_resolusi":       "IN_PROGRESS",
                    "status":                "In Progress",
                }
                _write(records)
                return _ensure_new_fields(records[i])
    return None


def add_toko_validasi(rec_id: str, toko_data: dict) -> Optional[list]:
    """Append or update a per-toko validation entry; auto-update distribusi_kondisi."""
    if USE_SQLITE:
        db = SessionLocal()
        try:
            a = db.query(CADAlertRow).filter_by(id=rec_id).first()
            if a is None:
                return None
            db.query(CADValidasiTokoRow).filter_by(
                cad_alert_id=rec_id, id_toko=toko_data.get("id_toko")
            ).delete()
            db.add(CADValidasiTokoRow(
                cad_alert_id=rec_id,
                id_toko=toko_data.get("id_toko"),
                nama_toko=toko_data.get("nama_toko"),
                kondisi=toko_data.get("kondisi"),
                catatan=toko_data.get("catatan"),
                validated_by=toko_data.get("validated_by"),
                aegis_score=toko_data.get("aegis_score"),
                validated_at=datetime.now(timezone.utc),
            ))
            db.flush()
            toko_rows = (
                db.query(CADValidasiTokoRow).filter_by(cad_alert_id=rec_id)
                .order_by(CADValidasiTokoRow.id).all()
            )

            hvd = a.hasil_validasi_detail
            if isinstance(hvd, dict):
                counts = Counter(t.kondisi for t in toko_rows if t.kondisi)
                a.hasil_validasi_detail = {
                    **hvd,
                    "distribusi_kondisi": [
                        {"kategori": k, "jumlah_toko": v}
                        for k, v in sorted(counts.items(), key=lambda x: -x[1])
                    ],
                }

            db.commit()
            return [_toko_validasi_to_dict(t) for t in toko_rows]
        finally:
            db.close()
    with _lock:
        records = _read()
        for i, r in enumerate(records):
            if r["id"] == rec_id:
                toko_list = list(r.get("toko_validasi") or [])
                # Replace existing entry for same toko
                toko_list = [t for t in toko_list if t.get("id_toko") != toko_data.get("id_toko")]
                toko_list.append({**toko_data, "validated_at": datetime.now(timezone.utc).isoformat()})
                records[i]["toko_validasi"] = toko_list

                # Recalculate distribusi_kondisi
                hvd = records[i].get("hasil_validasi_detail")
                if isinstance(hvd, dict):
                    counts = Counter(t.get("kondisi", "") for t in toko_list if t.get("kondisi"))
                    hvd["distribusi_kondisi"] = [
                        {"kategori": k, "jumlah_toko": v}
                        for k, v in sorted(counts.items(), key=lambda x: -x[1])
                    ]
                    records[i]["hasil_validasi_detail"] = hvd

                _write(records)
                return toko_list
    return None


def get_toko_validasi(rec_id: str) -> Optional[dict]:
    record = get_record_by_id(rec_id)
    if record is None:
        return None
    toko_list = record.get("toko_validasi") or []
    counter: dict[str, int] = {}
    for t in toko_list:
        k = t.get("kondisi") or "—"
        counter[k] = counter.get(k, 0) + 1
    kondisi_alert = record.get("kondisi_alert") or {}
    return {
        "toko_validasi": toko_list,
        "total": len(toko_list),
        "total_warning": kondisi_alert.get("total_toko_warning", record.get("jumlah_toko", 0)),
        "distribusi_kondisi": [
            {"kategori": k, "jumlah_toko": v}
            for k, v in sorted(counter.items(), key=lambda x: -x[1])
        ],
    }


def update_follow_up(rec_id: str, follow_up_data: dict) -> Optional[dict]:
    if USE_SQLITE:
        db = SessionLocal()
        try:
            a = db.query(CADAlertRow).filter_by(id=rec_id).first()
            if a is None:
                return None
            existing_fu = a.follow_up or {}
            merged_fu = {**existing_fu, **follow_up_data}

            if merged_fu.get("eskalasi_asm"):
                a.status = "Butuh Eskalasi"
            elif follow_up_data.get("status"):
                a.status = follow_up_data["status"]
                if follow_up_data["status"] == "Resolved":
                    a.status_resolusi = "RESOLVED"
                    if not a.tanggal_resolved:
                        a.tanggal_resolved = date.today()
                    merged_fu["resolved_at"] = a.tanggal_resolved.isoformat()

            a.follow_up = merged_fu
            db.commit()
            toko_rows = (
                db.query(CADValidasiTokoRow).filter_by(cad_alert_id=a.id)
                .order_by(CADValidasiTokoRow.id).all()
            )
            return _ensure_new_fields(_cad_alert_to_dict(a, toko_rows))
        finally:
            db.close()
    with _lock:
        records = _read()
        for i, r in enumerate(records):
            if r["id"] == rec_id:
                existing_fu = r.get("follow_up") or {}
                merged_fu = {**existing_fu, **follow_up_data}
                records[i]["follow_up"] = merged_fu

                if merged_fu.get("eskalasi_asm"):
                    records[i]["status"] = "Butuh Eskalasi"
                elif follow_up_data.get("status"):
                    records[i]["status"] = follow_up_data["status"]
                    if follow_up_data["status"] == "Resolved":
                        records[i]["status_resolusi"] = "RESOLVED"
                        if not records[i].get("tanggal_resolved"):
                            records[i]["tanggal_resolved"] = date.today().isoformat()
                        merged_fu["resolved_at"] = records[i]["tanggal_resolved"]
                        records[i]["follow_up"] = merged_fu

                _write(records)
                return _ensure_new_fields(records[i])
    return None


def get_toko_cad_history(id_toko: str) -> list[dict]:
    """Return all CAD alert validations that include a specific toko ID."""
    results = []
    for r in _get_all_records():
        for tv in (r.get("toko_validasi") or []):
            if tv.get("id_toko") == id_toko:
                results.append({
                    "cad_id":             r["id"],
                    "kabupaten":          r.get("kabupaten"),
                    "tgl_alert":          r.get("tgl_alert") or r.get("tanggal_alert"),
                    "kondisi":            tv.get("kondisi"),
                    "catatan":            tv.get("catatan"),
                    "validated_by":       tv.get("validated_by"),
                    "validated_at":       tv.get("validated_at"),
                    "aegis_score_at_time": tv.get("aegis_score"),
                })
    results.sort(key=lambda x: x.get("validated_at") or "", reverse=True)
    return results


def get_summary() -> dict:
    records  = _get_all_records()
    total    = len(records)
    pending  = sum(1 for r in records if r.get("status_resolusi") == "OPEN")
    in_prog  = sum(1 for r in records if r.get("status_resolusi") == "IN_PROGRESS")
    resolved = sum(1 for r in records if r.get("status_resolusi") == "RESOLVED")

    # Kategori distribution
    kategori_count: dict[str, int] = {}
    for r in records:
        hvd = r.get("hasil_validasi_detail")
        if isinstance(hvd, dict) and hvd.get("kategori_utama"):
            k = hvd["kategori_utama"]
        elif isinstance(r.get("hasil_validasi"), str) and r["hasil_validasi"]:
            k = _OLD_HASIL_MAP.get(r["hasil_validasi"], r["hasil_validasi"])
        else:
            continue
        kategori_count[k] = kategori_count.get(k, 0) + 1

    validated = [r for r in records if r.get("hasil_validasi") or r.get("hasil_validasi_detail")]
    pct_val   = round(len(validated) / total * 100, 1) if total else 0.0

    visited: list[int] = []
    for r in records:
        hvd = r.get("hasil_validasi_detail")
        if isinstance(hvd, dict) and hvd.get("toko_dikunjungi"):
            try:
                visited.append(int(hvd["toko_dikunjungi"]))
            except (TypeError, ValueError):
                pass
    avg_visited = round(sum(visited) / len(visited), 1) if visited else 0.0

    days: list[int] = []
    for r in records:
        kunjungan  = r.get("tanggal_kunjungan") or r.get("tgl_validasi")
        alert_date = r.get("tanggal_alert") or r.get("tgl_alert")
        if kunjungan and alert_date:
            try:
                d = (date.fromisoformat(kunjungan) - date.fromisoformat(alert_date)).days
                if d >= 0:
                    days.append(d)
            except ValueError:
                pass
    avg_days = round(sum(days) / len(days), 1) if days else 0.0

    kompetitor = [r for r in records if r.get("hasil_validasi") == "KOMPETITOR_EKSTERNAL"]
    pct_komp   = round(len(kompetitor) / len(validated) * 100, 1) if validated else 0.0

    return {
        "total_alerts":          total,
        "total_alert":           total,
        "pending_validasi":      pending,
        "in_progress":           in_prog,
        "resolved":              resolved,
        "open":                  pending,
        "pct_validated":         pct_val,
        "pct_kompetitor":        pct_komp,
        "avg_response_days":     avg_days,
        "avg_toko_dikunjungi":   avg_visited,
        "kategori_distribution": kategori_count,
    }

"""Export endpoints — PDF reports and CSV exports."""
from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from api.core.aegis_engine import get_store_crs
from api.core import cad_storage
from api.core.pdf_generator import generate_aegis_report, generate_ilp_report

router = APIRouter(prefix="/api/export", tags=["export"])


def _pdf_response(pdf_bytes: bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _csv_response(csv_str: str, filename: str) -> Response:
    return Response(
        content=csv_str.encode("utf-8-sig"),  # BOM for Excel compat
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── AEGIS Report ──────────────────────────────────────────────────────────────

@router.get("/aegis-report")
def aegis_report() -> Response:
    df       = get_store_crs()
    pdf      = generate_aegis_report(df)
    filename = f"AEGIS_Report_{date.today().strftime('%Y%m%d')}.pdf"
    return _pdf_response(pdf, filename)


# ── ILP Report ────────────────────────────────────────────────────────────────

class ILPExportBody(BaseModel):
    data:   list[dict[str, Any]]
    meta:   dict[str, Any] = {}
    params: dict[str, Any] = {}


@router.post("/ilp-report")
def ilp_report(body: ILPExportBody) -> Response:
    pdf      = generate_ilp_report(body.data, body.params)
    filename = f"ILP_Report_{date.today().strftime('%Y%m%d')}.pdf"
    return _pdf_response(pdf, filename)


# ── CAD History CSV ───────────────────────────────────────────────────────────

_CAD_COLUMNS = [
    ("id",                "ID"),
    ("kabupaten",         "Kabupaten"),
    ("tanggal_alert",     "Tanggal Alert"),
    ("status_alert",      "Status Alert"),
    ("jumlah_toko",       "Jumlah Toko"),
    ("aegis_score_rata",  "Score Rata-rata"),
    ("tso_assigned",      "TSO Ditugaskan"),
    ("tanggal_kunjungan", "Tanggal Kunjungan"),
    ("hasil_validasi",    "Hasil Validasi"),
    ("catatan",           "Catatan"),
    ("status_resolusi",   "Status Resolusi"),
    ("tanggal_resolved",  "Tanggal Resolved"),
    ("created_at",        "Dibuat Pada"),
]


@router.get("/cad-history-csv")
def cad_history_csv() -> Response:
    records, _ = cad_storage.get_records(limit=10_000)

    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL)
    writer.writerow([label for _, label in _CAD_COLUMNS])
    for rec in records:
        writer.writerow([rec.get(key, "") for key, _ in _CAD_COLUMNS])

    filename = f"CAD_History_{date.today().strftime('%Y%m%d')}.csv"
    return _csv_response(buf.getvalue(), filename)

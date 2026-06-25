"""
APScheduler wiring untuk background job ORACLE Phase 2.5 — daily monitoring
dan auto-validasi CAD alert per jam.

CATATAN BIAYA: kedua job ini memanggil Anthropic API secara OTONOM tanpa
trigger user (daily monitoring 1x/hari, CAD auto-validate hingga 1x/jam jika
ada alert baru — masing-masing CAD memanggil Haiku 1-2x). Ini pengeluaran API
berulang yang berjalan terus selama service hidup, BUKAN sekali jalan seperti
fitur lain di ORACLE sejauh ini. Job di-skip otomatis kalau ANTHROPIC_API_KEY
tidak diset (lihat _api_key_ready), supaya tidak retry gagal tiap jam di
environment tanpa key (mis. lokal dev).
"""
from __future__ import annotations

import logging
import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler()


def _api_key_ready() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


async def _run_oracle_daily_monitoring() -> None:
    if not _api_key_ready():
        logger.info("[oracle_scheduler] Skip daily monitoring — ANTHROPIC_API_KEY belum diset")
        return
    try:
        from api.core.oracle_agent import OracleAgent

        agent = OracleAgent()
        result = await agent.run_daily_monitoring()
        logger.info("[oracle_scheduler] Daily monitoring selesai: %d findings", result["findings_count"])
    except Exception:
        logger.exception("[oracle_scheduler] Daily monitoring error")


async def _run_competitor_analysis() -> None:
    try:
        from api.core.competitor_analyzer import CompetitorAnalyzer
        from api.database import SessionLocal

        db = SessionLocal()
        try:
            analyzer = CompetitorAnalyzer(db)
            result = analyzer.run_full_analysis()
            logger.info(
                "[oracle_scheduler] Competitor analysis selesai: CPI %d stores, EWA %d alerts",
                result["competitive_pressure_index"].get("stores_processed", 0),
                result["early_warning_alerts"].get("alerts_created", 0),
            )
        finally:
            db.close()
    except Exception:
        logger.exception("[oracle_scheduler] Competitor analysis error")


async def _run_oracle_cad_auto_validate() -> None:
    if not _api_key_ready():
        return
    try:
        from api.core.oracle_agent import OracleAgent
        from api.core.oracle_toolkit import OracleToolkit

        toolkit = OracleToolkit()
        unvalidated = toolkit.get_unvalidated_cad(max_age_hours=24)
        cad_ids = [u["cad_id"] for u in unvalidated.get("unvalidated", [])]
        if not cad_ids:
            return

        agent = OracleAgent()
        async for event in agent.validate_cad_alerts_batch(cad_ids):
            if event["type"] == "validation_complete":
                s = event["summary"]
                logger.info(
                    "[oracle_scheduler] Auto-validated %d CAD alerts: genuine=%d false_alarm=%d needs_review=%d",
                    s["total"], s["genuine_threat"], s["false_alarm"], s["needs_review"],
                )
    except Exception:
        logger.exception("[oracle_scheduler] CAD auto-validation error")


def start_scheduler() -> None:
    # Competitor analysis berjalan tanpa API key — hanya butuh data transaksi
    _scheduler.add_job(
        _run_competitor_analysis, trigger=CronTrigger(hour=6, minute=30),
        id="competitor_analysis", replace_existing=True,
    )

    if not _api_key_ready():
        logger.warning("[oracle_scheduler] ANTHROPIC_API_KEY tidak diset — background job ORACLE TIDAK dijalankan")
        _scheduler.start()
        logger.info("[oracle_scheduler] Started — competitor analysis 06:30 (oracle jobs skip tanpa API key)")
        return

    _scheduler.add_job(
        _run_oracle_daily_monitoring, trigger=CronTrigger(hour=7, minute=0),
        id="oracle_daily_monitoring", replace_existing=True,
    )
    _scheduler.add_job(
        _run_oracle_cad_auto_validate, trigger=CronTrigger(hour=7, minute=15),
        id="oracle_cad_auto_validate", replace_existing=True,
    )
    _scheduler.start()
    logger.info("[oracle_scheduler] Started — competitor analysis 06:30, daily monitoring 07:00, CAD auto-validate 07:15")


def shutdown_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

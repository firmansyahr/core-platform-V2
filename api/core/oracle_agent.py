"""
OracleAgent — agentic execution engine Phase 2.5: multi-step task, CAD
auto-validation, draft creation, dan proactive daily monitoring.

ADAPTASI DARI SPESIFIKASI AWAL (verifikasi terhadap codebase nyata, bukan
diterapkan mentah):
- TIDAK ADA class "OracleModelRouter" dengan .HAIKU/.SONNET/.route() di
  codebase ini — routing model yang sebenarnya adalah fungsi select_model()
  + konstanta MODEL_HAIKU/MODEL_SONNET/MODEL_OPUS di oracle_engine.py.
  Dipakai langsung, bukan kelas fiktif.
- Seluruh codebase pakai SQLAlchemy SYNC (SessionLocal), TIDAK ADA
  AsyncSession di mana pun — operasi DB di sini tetap sync (dibungkus
  langsung, bukan "await db.execute(...)" yang mengasumsikan ORM async).
  SQLite lokal cukup cepat untuk ini tidak jadi bottleneck nyata.
- OracleAgent TIDAK menerima db session di constructor (pola "agent =
  OracleAgent(get_db())" / "OracleAgent(next(get_db()))" di brief membocorkan
  koneksi karena next() pada generator tidak pernah memicu "finally:
  db.close()") — tiap operasi buka/tutup SessionLocal() sendiri, konsisten
  dengan pola OracleToolkit/loyalty.py/promo.py di proyek ini.
- run_multi_step_analysis TIDAK reimplement tool-calling loop dari nol —
  setiap step didelegasikan ke OracleEngine.chat() yang sudah ada (guard,
  tool dispatch, model routing per-message semuanya otomatis ikut terpakai),
  bukan jalur paralel terpisah yang harus dijaga konsistensinya sendiri.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator

import asyncio

from anthropic import Anthropic

from api.core.oracle_engine import MODEL_HAIKU, MODEL_SONNET, OracleEngine, select_model
from api.core.oracle_guard import OracleInputGuard
from api.core.oracle_router import OracleModelRouter
from api.core.oracle_toolkit import OracleToolkit
from api.database import SessionLocal
from api.models import OracleCadVerdict, OracleDraft, OracleNotification, OracleTask

logger = logging.getLogger(__name__)

_CAD_SIGNAL_METHODS = [
    ("volume_trend", "get_volume_trend"),
    ("gmm_cluster", "get_gmm_cluster_history"),
    ("competitor_activity", "get_competitor_activity_nearby"),
    ("seasonal_pattern", "get_seasonal_pattern"),
    ("peer_comparison", "get_peer_comparison"),
    ("program_status", "get_program_status"),
    ("payment_history", "get_payment_history"),
]


def _strip_json_fence(text: str) -> str:
    """Claude (terutama Haiku) kadang membungkus JSON dalam ```json fence
    walau diminta 'HANYA JSON' — strip sebelum json.loads, bukan asumsikan
    selalu bersih."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    return t.strip()


class OracleAgent:
    def __init__(self) -> None:
        self.toolkit = OracleToolkit()
        self.guard = OracleInputGuard()
        self.engine = OracleEngine()
        self.router = OracleModelRouter()
        self._client: Anthropic | None = None

    def _get_client(self) -> Anthropic:
        if self._client is None:
            self._client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        return self._client

    # ──────────────────────────────────────────────────────────────────────
    # Task tracking (oracle_tasks) — helper sync, dipakai semua fitur agentic
    # ──────────────────────────────────────────────────────────────────────

    def _create_task(self, task_id: str, task_type: str, task_name: str, steps_total: int, triggered_by: str = "user") -> None:
        db = SessionLocal()
        try:
            db.add(OracleTask(
                id=task_id, task_type=task_type, task_name=task_name,
                status="running", steps_total=steps_total, steps_completed=0,
                triggered_by=triggered_by,
            ))
            db.commit()
        finally:
            db.close()

    def _update_task_step(self, task_id: str, steps_completed: int, current_step: str) -> None:
        db = SessionLocal()
        try:
            t = db.query(OracleTask).filter_by(id=task_id).first()
            if t:
                t.steps_completed = steps_completed
                t.current_step = current_step
                t.updated_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()

    def _complete_task(self, task_id: str, result: Any, status: str = "completed") -> None:
        db = SessionLocal()
        try:
            t = db.query(OracleTask).filter_by(id=task_id).first()
            if t:
                t.status = status
                t.result_json = result
                t.updated_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()

    def _fail_task(self, task_id: str, error_message: str) -> None:
        db = SessionLocal()
        try:
            t = db.query(OracleTask).filter_by(id=task_id).first()
            if t:
                t.status = "failed"
                t.error_message = error_message
                t.updated_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()

    def get_task(self, task_id: str) -> dict | None:
        db = SessionLocal()
        try:
            t = db.query(OracleTask).filter_by(id=task_id).first()
            if not t:
                return None
            return {
                "id": t.id, "task_type": t.task_type, "task_name": t.task_name, "status": t.status,
                "steps_total": t.steps_total, "steps_completed": t.steps_completed, "current_step": t.current_step,
                "result": t.result_json, "error_message": t.error_message, "triggered_by": t.triggered_by,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            }
        finally:
            db.close()

    def cancel_task(self, task_id: str) -> bool:
        db = SessionLocal()
        try:
            t = db.query(OracleTask).filter_by(id=task_id).first()
            if not t or t.status not in ("running", "awaiting_approval"):
                return False
            t.status = "cancelled"
            t.updated_at = datetime.now(timezone.utc)
            db.commit()
            return True
        finally:
            db.close()

    # ──────────────────────────────────────────────────────────────────────
    # MULTI-STEP ANALYSIS — tiap step didelegasikan ke OracleEngine.chat()
    # (guard, tool dispatch, model routing per-message sudah otomatis ikut)
    # ──────────────────────────────────────────────────────────────────────

    async def run_multi_step_analysis(self, task_name: str, steps: list[dict]) -> AsyncGenerator[dict, None]:
        task_id = str(uuid.uuid4())
        self._create_task(task_id, "multi_step_analysis", task_name, len(steps))

        yield {"type": "task_start", "task_id": task_id, "task_name": task_name, "total_steps": len(steps)}

        accumulated: dict[str, Any] = {}
        for i, step in enumerate(steps):
            description = step.get("description") or step.get("step", f"Step {i + 1}")
            self._update_task_step(task_id, i, description)
            yield {"type": "step_start", "step_number": i + 1, "step_description": description}

            if self.get_task(task_id) is None or self.get_task(task_id)["status"] == "cancelled":
                yield {"type": "task_cancelled", "task_id": task_id, "step": i + 1}
                return

            try:
                result = await asyncio.to_thread(
                    self.engine.chat, description, [],
                    {"entity_snapshot": accumulated} if accumulated else None,
                )
            except Exception as e:  # noqa: BLE001 — error 1 step tidak boleh crash proses, dicatat ke task
                self._fail_task(task_id, str(e))
                yield {"type": "task_error", "error": str(e), "step": i + 1}
                return

            accumulated[step.get("step", f"step_{i + 1}")] = {"summary": result.get("reply", ""), "tools_used": result.get("tool_calls_made", [])}
            self._update_task_step(task_id, i + 1, description)
            yield {"type": "step_complete", "step_number": i + 1, "step_result_summary": result.get("reply", "")[:300]}

        final_model = select_model(task_name)
        synth_message = (
            f"Berdasarkan hasil seluruh tahap analisis berikut untuk tugas '{task_name}', "
            f"buat sintesis akhir yang ringkas dan actionable."
        )
        final = await asyncio.to_thread(self.engine.chat, synth_message, [], {"entity_snapshot": accumulated})

        self._complete_task(task_id, {"reply": final.get("reply"), "steps": accumulated})
        yield {
            "type": "task_complete", "task_id": task_id, "result": final, "model_used": final_model,
        }

    # ──────────────────────────────────────────────────────────────────────
    # CAD ALERT AUTO-VALIDATION
    # ──────────────────────────────────────────────────────────────────────

    async def validate_cad_alerts_batch(self, cad_ids: list[str]) -> AsyncGenerator[dict, None]:
        task_id = str(uuid.uuid4())
        self._create_task(task_id, "cad_validation", f"Validasi {len(cad_ids)} CAD Alerts", len(cad_ids))
        yield {"type": "task_start", "task_id": task_id, "total_alerts": len(cad_ids)}

        semaphore = asyncio.Semaphore(5)

        async def validate_single(cad_id: str) -> dict:
            async with semaphore:
                return await self._validate_one_cad(cad_id)

        results = await asyncio.gather(*(validate_single(c) for c in cad_ids), return_exceptions=True)

        verdicts = []
        for cad_id, result in zip(cad_ids, results):
            if isinstance(result, Exception):
                logger.error("CAD validation error for %s: %s", cad_id, result)
                verdicts.append({"cad_id": cad_id, "verdict": "needs_review", "confidence_score": 0.5, "error": str(result)})
            else:
                verdicts.append(result)
                self._save_cad_verdict(result)

        genuine = [v for v in verdicts if v["verdict"] == "genuine_threat"]
        false_alarm = [v for v in verdicts if v["verdict"] == "false_alarm"]
        needs_review = [v for v in verdicts if v["verdict"] == "needs_review"]

        self._complete_task(task_id, {"verdicts": verdicts}, status="awaiting_approval")

        yield {
            "type": "validation_complete", "task_id": task_id,
            "summary": {
                "total": len(cad_ids), "genuine_threat": len(genuine),
                "false_alarm": len(false_alarm), "needs_review": len(needs_review),
            },
            "verdicts": verdicts, "requires_approval": True,
            "approval_actions": [
                {
                    "action": "dismiss_false_alarms", "label": f"Dismiss {len(false_alarm)} False Alarm",
                    "count": len(false_alarm), "cad_ids": [v["cad_id"] for v in false_alarm],
                },
                {
                    "action": "confirm_genuine", "label": f"Konfirmasi {len(genuine)} Genuine Threat",
                    "count": len(genuine), "cad_ids": [v["cad_id"] for v in genuine],
                },
            ],
        }

    async def _validate_one_cad(self, cad_id: str) -> dict:
        """Validasi satu CAD alert dengan 7 signal check (dijalankan paralel
        via asyncio.to_thread — toolkit method-nya sync/pandas-bound, bukan
        async, jadi to_thread yang benar2 melepas GIL, bukan asyncio.gather
        polos terhadap coroutine yang tidak pernah await apa pun)."""
        signal_results = await asyncio.gather(
            *(asyncio.to_thread(getattr(self.toolkit, method_name), cad_id) for _, method_name in _CAD_SIGNAL_METHODS),
        )
        signal_map = dict(zip((label for label, _ in _CAD_SIGNAL_METHODS), signal_results))

        response = await asyncio.to_thread(
            self._get_client().messages.create,
            model=MODEL_HAIKU,
            max_tokens=500,
            system="""Kamu adalah validator CAD Alert untuk sistem distribusi semen.
Berikan confidence score (0.0-1.0) bahwa alert ini adalah GENUINE THREAT (bukan false alarm).
Field status "not_tracked"/"not_found" pada sebuah signal berarti signal itu TIDAK BISA dipakai
sebagai evidence (bukan indikasi apa pun) — JANGAN jadikan ketidaktersediaan data sebagai alasan.
Respond HANYA dengan JSON, tidak ada teks lain:
{"confidence": float, "verdict": "genuine_threat|false_alarm|needs_review", "key_evidence": [], "primary_reason": ""}""",
            messages=[{
                "role": "user",
                "content": f"Signals untuk CAD Alert {cad_id}:\n{json.dumps(signal_map, ensure_ascii=False, default=str, indent=2)}",
            }],
        )
        raw_text = "".join(b.text for b in response.content if b.type == "text")
        try:
            verdict_data = json.loads(_strip_json_fence(raw_text))
        except json.JSONDecodeError:
            logger.warning("CAD verdict JSON parse gagal untuk %s: %r", cad_id, raw_text[:200])
            verdict_data = {"confidence": 0.5, "verdict": "needs_review", "key_evidence": [], "primary_reason": "Gagal mem-parse respons model"}

        model_used = MODEL_HAIKU
        confidence = float(verdict_data.get("confidence", 0.5))

        # Kasus jelas (confidence tinggi/rendah) tetap 1 call Haiku — cukup
        # dan murah. Kasus AMBIGU (0.35-0.85) di-escalate ke Sonnet untuk
        # judgment yang lebih nuanced, bukan langsung dipercaya Haiku begitu
        # saja — trade-off: +1 call Sonnet HANYA untuk kasus ambigu, supaya
        # mayoritas validasi (kasus jelas) tetap 1 call sesuai target 80%
        # Haiku, bukan 2x call untuk SEMUA alert yang akan membalik target
        # distribusi biaya.
        if 0.35 <= confidence <= 0.85:
            refined_model = self.router.route_for_agentic_step("multi_tool_synthesis")
            refined = await asyncio.to_thread(
                self._get_client().messages.create,
                model=refined_model,
                max_tokens=500,
                system="""Kamu adalah validator CAD Alert senior untuk sistem distribusi semen.
Validator junior (model lebih kecil) sudah memberi confidence awal yang AMBIGU (0.35-0.85) — kasus
ini butuh judgment lebih nuanced. Review ulang signal data dan confidence awal, beri keputusan final.
Field status "not_tracked"/"not_found" pada sebuah signal berarti signal itu TIDAK BISA dipakai
sebagai evidence — JANGAN jadikan ketidaktersediaan data sebagai alasan.
Respond HANYA dengan JSON, tidak ada teks lain:
{"confidence": float, "verdict": "genuine_threat|false_alarm|needs_review", "key_evidence": [], "primary_reason": ""}""",
                messages=[{
                    "role": "user",
                    "content": (
                        f"Signals untuk CAD Alert {cad_id}:\n{json.dumps(signal_map, ensure_ascii=False, default=str, indent=2)}\n\n"
                        f"Confidence awal dari validator junior: {confidence} ({verdict_data.get('primary_reason', '')})"
                    ),
                }],
            )
            refined_text = "".join(b.text for b in refined.content if b.type == "text")
            try:
                refined_data = json.loads(_strip_json_fence(refined_text))
                verdict_data = refined_data
                confidence = float(refined_data.get("confidence", confidence))
                model_used = refined_model
            except json.JSONDecodeError:
                logger.warning("CAD verdict refinement JSON parse gagal untuk %s: %r", cad_id, refined_text[:200])
                # parsing gagal — pertahankan verdict Haiku awal, jangan timpa dengan data rusak

        recommendations: list[str] = []
        if verdict_data.get("verdict") == "genuine_threat":
            recommendations = await self._generate_recommendations(cad_id, signal_map)

        return {
            "cad_id": cad_id,
            "verdict": verdict_data.get("verdict", "needs_review"),
            "confidence_score": confidence,
            "evidence": verdict_data.get("key_evidence", []),
            "primary_reason": verdict_data.get("primary_reason", ""),
            "recommendations": recommendations,
            "signal_data": signal_map,
            "model_used": model_used,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _generate_recommendations(self, cad_id: str, signal_map: dict) -> list[str]:
        response = await asyncio.to_thread(
            self._get_client().messages.create,
            model=MODEL_HAIKU,
            max_tokens=300,
            system="""Berdasarkan signal data CAD Alert genuine threat, beri maksimal 3 rekomendasi
aksi singkat dan konkret dalam Bahasa Indonesia. Respond HANYA dengan JSON array string, contoh:
["Kunjungi toko prioritas tinggi dalam 3 hari", "..."]""",
            messages=[{"role": "user", "content": json.dumps(signal_map, ensure_ascii=False, default=str)}],
        )
        raw_text = "".join(b.text for b in response.content if b.type == "text")
        try:
            recs = json.loads(_strip_json_fence(raw_text))
            return recs if isinstance(recs, list) else []
        except json.JSONDecodeError:
            return []

    def _save_cad_verdict(self, result: dict) -> None:
        db = SessionLocal()
        try:
            existing = db.query(OracleCadVerdict).filter_by(cad_id=result["cad_id"]).first()
            if existing:
                existing.verdict = result["verdict"]
                existing.confidence_score = result["confidence_score"]
                existing.evidence_json = result.get("evidence", [])
                existing.recommendations_json = result.get("recommendations", [])
                existing.model_used = result.get("model_used")
                existing.analyzed_at = datetime.now(timezone.utc)
            else:
                db.add(OracleCadVerdict(
                    id=str(uuid.uuid4()), cad_id=result["cad_id"], verdict=result["verdict"],
                    confidence_score=result["confidence_score"], evidence_json=result.get("evidence", []),
                    recommendations_json=result.get("recommendations", []), model_used=result.get("model_used"),
                ))
            db.commit()
        finally:
            db.close()

    # ──────────────────────────────────────────────────────────────────────
    # DRAFT CREATION — TIDAK PERNAH ditulis ke tabel produksi langsung
    # ──────────────────────────────────────────────────────────────────────

    async def create_draft(self, draft_type: str, context: dict, user_request: str) -> dict:
        input_check = self.guard.validate_input(user_request)
        if not input_check["allowed"]:
            return {"status": "blocked", "reply": input_check["response"]}

        response = await asyncio.to_thread(
            self._get_client().messages.create,
            model=MODEL_SONNET,
            max_tokens=2000,
            system=(
                f"Kamu adalah ORACLE, AI analyst CORE Platform. Buat draft {draft_type} berdasarkan "
                "data aktual yang diberikan. Respond HANYA dengan JSON (tanpa markdown fence) berisi "
                "struktur draft yang relevan untuk tipe ini. Draft ini akan di-review user sebelum "
                "diterapkan — jangan klaim sudah diterapkan."
            ),
            messages=[{
                "role": "user",
                "content": f"Request: {user_request}\n\nData tersedia:\n{json.dumps(context, ensure_ascii=False, default=str, indent=2)}",
            }],
        )
        raw_text = "".join(b.text for b in response.content if b.type == "text")
        try:
            draft_content = json.loads(_strip_json_fence(raw_text))
        except json.JSONDecodeError:
            draft_content = {"raw_text": raw_text}

        draft_id = str(uuid.uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        db = SessionLocal()
        try:
            db.add(OracleDraft(
                id=draft_id, draft_type=draft_type,
                title=draft_content.get("title", user_request[:120]) if isinstance(draft_content, dict) else user_request[:120],
                content_json=draft_content, source_analysis=json.dumps(context, ensure_ascii=False, default=str)[:2000],
                expires_at=expires_at,
            ))
            db.commit()
        finally:
            db.close()

        return {
            "draft_id": draft_id, "draft_type": draft_type, "content": draft_content,
            "requires_approval": True, "approval_endpoint": f"/api/oracle/agent/drafts/{draft_id}/approve",
            "expires_at": expires_at.isoformat(),
        }

    # ──────────────────────────────────────────────────────────────────────
    # PROACTIVE MONITORING — dipanggil APScheduler, semua Haiku
    # ──────────────────────────────────────────────────────────────────────

    async def run_daily_monitoring(self) -> dict:
        findings: list[dict] = []

        deadlines = await asyncio.to_thread(self.toolkit.get_promo_deadlines, 7)
        if deadlines.get("status") == "ok" and deadlines.get("deadlines"):
            findings.append({"type": "deadline_warning", "severity": "warning", "data": deadlines["deadlines"]})

        roi_drops = await asyncio.to_thread(self.toolkit.get_roi_drops, -20.0, 7)
        if roi_drops.get("status") == "ok" and roi_drops.get("drops"):
            findings.append({
                "type": "performance_drop",
                "severity": "warning" if len(roi_drops["drops"]) < 10 else "critical",
                "data": roi_drops["drops"],
            })

        new_cad = await asyncio.to_thread(self.toolkit.get_unvalidated_cad, 24)
        if new_cad.get("status") == "ok" and new_cad.get("unvalidated"):
            findings.append({"type": "new_alerts", "severity": "info", "data": new_cad["unvalidated"]})

        ms_movements = await asyncio.to_thread(self.toolkit.get_ms_movements, 2.0)
        if ms_movements.get("status") == "ok" and ms_movements.get("movements"):
            findings.append({"type": "market_share_alert", "severity": "warning", "data": ms_movements["movements"]})

        if not findings:
            briefing_text = "Tidak ada anomali signifikan ditemukan hari ini. Semua modul dalam kondisi normal."
        else:
            response = await asyncio.to_thread(
                self._get_client().messages.create,
                model=MODEL_HAIKU,
                max_tokens=800,
                system=(
                    "Buat daily briefing ringkas dalam Bahasa Indonesia dari findings yang diberikan. "
                    "Format: bullet points dengan emoji severity. Maksimal 300 kata. "
                    "Langsung ke poin, tidak perlu pembuka."
                ),
                messages=[{"role": "user", "content": json.dumps(findings, ensure_ascii=False, default=str)}],
            )
            briefing_text = "".join(b.text for b in response.content if b.type == "text")

        notif_id = str(uuid.uuid4())
        severity = "critical" if any(f["severity"] == "critical" for f in findings) else "info"
        db = SessionLocal()
        try:
            db.add(OracleNotification(
                id=notif_id, notif_type="daily_briefing",
                title=f"Daily Briefing — {datetime.now().strftime('%d %b %Y')}",
                summary=briefing_text, detail_json=findings, severity=severity,
            ))
            db.commit()
        finally:
            db.close()

        return {"briefing_id": notif_id, "findings_count": len(findings), "briefing": briefing_text}

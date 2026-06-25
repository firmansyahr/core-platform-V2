"""
ORACLE Phase 2.5 — endpoints agentic (multi-step analysis, CAD auto-validation,
draft, notifikasi, sessions, task tracking).

KEPUTUSAN PENTING — resolusi konflik dalam spesifikasi awal:
PRINSIP UTAMA brief secara eksplisit menyatakan "Write hanya ke tabel oracle_*
(isolated dari data produksi)" dan "Tidak ada autonomous commit ke data
produksi" — tapi komentar inline di pseudocode router brief bilang approve
draft adalah "satu-satunya cara draft masuk ke data produksi" (menulis ke
Promo/CADAlert). Dua pernyataan ini KONTRADIKTIF. Diikuti yang eksplisit dan
lebih aman: approve/reject HANYA mengubah status di tabel oracle_* (oracle_
drafts, oracle_cad_verdicts) — TIDAK PERNAH menulis ke promos/cad_alerts.
Draft yang di-approve jadi "siap diterapkan", aplikasinya tetap lewat flow
yang sudah ada (Buat Promo, dst), bukan auto-write yang belum tervalidasi
skemanya field-per-field.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.core.oracle_agent import OracleAgent
from api.database import SessionLocal
from api.models import OracleCadVerdict, OracleDraft, OracleNotification, OracleSession

router = APIRouter()

_agent = OracleAgent()


def _meta() -> dict:
    return {"generated_at": datetime.now(timezone.utc).isoformat()}


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


# ── Request models ───────────────────────────────────────────────────────────

class AnalysisRequest(BaseModel):
    task_name: str
    steps: list[dict[str, Any]]


class CadValidationRequest(BaseModel):
    cad_ids: list[str]


class BatchApprovalRequest(BaseModel):
    action: str  # dismiss_false_alarms | confirm_genuine
    cad_ids: list[str]
    decided_by: str | None = None
    notes: str | None = None


class CadDecisionRequest(BaseModel):
    decision: str  # confirmed | overridden | dismissed
    decided_by: str | None = None
    notes: str | None = None


class DraftRequest(BaseModel):
    draft_type: str
    context: dict[str, Any]
    user_request: str


class ApprovalRequest(BaseModel):
    reviewed_by: str | None = None
    notes: str | None = None


class RejectionRequest(BaseModel):
    reviewed_by: str | None = None
    notes: str | None = None


class SaveSessionRequest(BaseModel):
    title: str
    summary: str | None = None
    history: list[dict[str, Any]]
    page_context: dict[str, Any] | None = None
    model_stats: dict[str, Any] | None = None
    total_tokens_used: int = 0


# ── Multi-step analysis ──────────────────────────────────────────────────────

@router.post("/analyze")
async def run_analysis(request: AnalysisRequest) -> StreamingResponse:
    async def stream():
        async for event in _agent.run_multi_step_analysis(task_name=request.task_name, steps=request.steps):
            yield _sse(event)
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── CAD Validation ────────────────────────────────────────────────────────────

@router.post("/validate-cad")
async def validate_cad(request: CadValidationRequest) -> StreamingResponse:
    async def stream():
        async for event in _agent.validate_cad_alerts_batch(cad_ids=request.cad_ids):
            yield _sse(event)
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class CadLookupRequest(BaseModel):
    cad_ids: list[str]


@router.post("/validate-cad/lookup")
def lookup_cad_verdicts(request: CadLookupRequest) -> dict:
    """Bulk lookup verdict untuk badge kolom 'ORACLE Verdict' di list page —
    hindari N request individual per baris tabel."""
    db = SessionLocal()
    try:
        verdicts = db.query(OracleCadVerdict).filter(OracleCadVerdict.cad_id.in_(request.cad_ids)).all()
        data = {v.cad_id: _verdict_to_dict(v) for v in verdicts}
        return {"status": "ok", "data": data, "meta": _meta()}
    finally:
        db.close()


@router.get("/validate-cad/{cad_id}")
def get_cad_verdict(cad_id: str) -> dict:
    db = SessionLocal()
    try:
        v = db.query(OracleCadVerdict).filter_by(cad_id=cad_id).first()
        if not v:
            return {"status": "ok", "data": None, "meta": _meta()}
        return {"status": "ok", "data": _verdict_to_dict(v), "meta": _meta()}
    finally:
        db.close()


def _verdict_to_dict(v: OracleCadVerdict) -> dict:
    return {
        "id": v.id, "cad_id": v.cad_id, "verdict": v.verdict, "confidence_score": v.confidence_score,
        "evidence": v.evidence_json, "recommendations": v.recommendations_json, "model_used": v.model_used,
        "analyzed_at": v.analyzed_at.isoformat() if v.analyzed_at else None,
        "user_decision": v.user_decision, "user_notes": v.user_notes,
        "decided_at": v.decided_at.isoformat() if v.decided_at else None,
    }


@router.post("/validate-cad/{cad_id}/approve")
def approve_cad_verdict(cad_id: str, request: CadDecisionRequest) -> dict:
    """User confirm/override/dismiss verdict ORACLE untuk satu CAD — hanya
    mengubah oracle_cad_verdicts, TIDAK menyentuh cad_alerts produksi (lihat
    catatan resolusi konflik di docstring modul)."""
    db = SessionLocal()
    try:
        v = db.query(OracleCadVerdict).filter_by(cad_id=cad_id).first()
        if not v:
            raise HTTPException(404, f"Belum ada verdict ORACLE untuk CAD '{cad_id}'")
        v.user_decision = request.decision
        v.user_notes = request.notes
        v.decided_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "ok", "data": _verdict_to_dict(v), "meta": _meta()}
    finally:
        db.close()


@router.post("/validate-cad/batch-approve")
def batch_approve_verdicts(request: BatchApprovalRequest) -> dict:
    if request.action not in ("dismiss_false_alarms", "confirm_genuine"):
        raise HTTPException(400, "action harus 'dismiss_false_alarms' atau 'confirm_genuine'")
    decision = "dismissed" if request.action == "dismiss_false_alarms" else "confirmed"
    db = SessionLocal()
    try:
        verdicts = db.query(OracleCadVerdict).filter(OracleCadVerdict.cad_id.in_(request.cad_ids)).all()
        for v in verdicts:
            v.user_decision = decision
            v.user_notes = request.notes
            v.decided_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "ok", "data": {"updated": len(verdicts), "decision": decision}, "meta": _meta()}
    finally:
        db.close()


# ── Draft Management ──────────────────────────────────────────────────────────

@router.post("/drafts/create")
async def create_draft(request: DraftRequest) -> dict:
    result = await _agent.create_draft(draft_type=request.draft_type, context=request.context, user_request=request.user_request)
    return {"status": "ok", "data": result, "meta": _meta()}


def _draft_to_dict(d: OracleDraft) -> dict:
    return {
        "id": d.id, "draft_type": d.draft_type, "title": d.title, "content": d.content_json,
        "source_analysis": d.source_analysis, "status": d.status, "created_by": d.created_by,
        "reviewed_by": d.reviewed_by, "reviewed_at": d.reviewed_at.isoformat() if d.reviewed_at else None,
        "review_notes": d.review_notes, "created_at": d.created_at.isoformat() if d.created_at else None,
        "expires_at": d.expires_at.isoformat() if d.expires_at else None,
    }


@router.get("/drafts")
def list_drafts(status: str | None = None) -> dict:
    db = SessionLocal()
    try:
        q = db.query(OracleDraft)
        if status:
            q = q.filter_by(status=status)
        drafts = q.order_by(OracleDraft.created_at.desc()).all()
        return {"status": "ok", "data": [_draft_to_dict(d) for d in drafts], "meta": _meta()}
    finally:
        db.close()


@router.post("/drafts/{draft_id}/approve")
def approve_draft(draft_id: str, request: ApprovalRequest) -> dict:
    db = SessionLocal()
    try:
        d = db.query(OracleDraft).filter_by(id=draft_id).first()
        if not d:
            raise HTTPException(404, f"Draft '{draft_id}' tidak ditemukan")
        if d.status != "pending_review":
            raise HTTPException(400, f"Draft sudah berstatus '{d.status}', tidak bisa di-approve lagi")
        d.status = "approved"
        d.reviewed_by = request.reviewed_by
        d.reviewed_at = datetime.now(timezone.utc)
        d.review_notes = request.notes
        db.commit()
        return {"status": "ok", "data": _draft_to_dict(d), "meta": _meta()}
    finally:
        db.close()


@router.post("/drafts/{draft_id}/reject")
def reject_draft(draft_id: str, request: RejectionRequest) -> dict:
    db = SessionLocal()
    try:
        d = db.query(OracleDraft).filter_by(id=draft_id).first()
        if not d:
            raise HTTPException(404, f"Draft '{draft_id}' tidak ditemukan")
        d.status = "rejected"
        d.reviewed_by = request.reviewed_by
        d.reviewed_at = datetime.now(timezone.utc)
        d.review_notes = request.notes
        db.commit()
        return {"status": "ok", "data": _draft_to_dict(d), "meta": _meta()}
    finally:
        db.close()


# ── Notifications ─────────────────────────────────────────────────────────────

def _notif_to_dict(n: OracleNotification) -> dict:
    return {
        "id": n.id, "notif_type": n.notif_type, "title": n.title, "summary": n.summary,
        "detail": n.detail_json, "severity": n.severity, "is_read": bool(n.is_read),
        "is_dismissed": bool(n.is_dismissed), "related_module": n.related_module,
        "related_entity_id": n.related_entity_id, "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/notifications")
def get_notifications(unread_only: bool = False, limit: int = 50) -> dict:
    db = SessionLocal()
    try:
        q = db.query(OracleNotification).filter_by(is_dismissed=False)
        if unread_only:
            q = q.filter_by(is_read=False)
        notifs = q.order_by(OracleNotification.created_at.desc()).limit(limit).all()
        return {"status": "ok", "data": [_notif_to_dict(n) for n in notifs], "meta": _meta()}
    finally:
        db.close()


@router.post("/notifications/{notif_id}/read")
def mark_read(notif_id: str) -> dict:
    db = SessionLocal()
    try:
        n = db.query(OracleNotification).filter_by(id=notif_id).first()
        if not n:
            raise HTTPException(404, f"Notifikasi '{notif_id}' tidak ditemukan")
        n.is_read = True
        db.commit()
        return {"status": "ok", "data": _notif_to_dict(n), "meta": _meta()}
    finally:
        db.close()


@router.post("/notifications/{notif_id}/dismiss")
def dismiss_notification(notif_id: str) -> dict:
    db = SessionLocal()
    try:
        n = db.query(OracleNotification).filter_by(id=notif_id).first()
        if not n:
            raise HTTPException(404, f"Notifikasi '{notif_id}' tidak ditemukan")
        n.is_dismissed = True
        db.commit()
        return {"status": "ok", "data": _notif_to_dict(n), "meta": _meta()}
    finally:
        db.close()


@router.get("/notifications/unread-count")
def unread_count() -> dict:
    db = SessionLocal()
    try:
        count = db.query(OracleNotification).filter_by(is_read=False, is_dismissed=False).count()
        return {"status": "ok", "data": {"unread_count": count}, "meta": _meta()}
    finally:
        db.close()


# ── Sessions ───────────────────────────────────────────────────────────────────

def _session_to_dict(s: OracleSession, include_history: bool = True) -> dict:
    d = {
        "id": s.id, "title": s.title, "summary": s.summary,
        "page_context": s.page_context_json, "model_stats": s.model_stats_json,
        "total_tokens_used": s.total_tokens_used,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }
    if include_history:
        d["history"] = s.history_json
    return d


@router.get("/sessions")
def list_sessions() -> dict:
    db = SessionLocal()
    try:
        sessions = db.query(OracleSession).order_by(OracleSession.updated_at.desc()).all()
        return {"status": "ok", "data": [_session_to_dict(s, include_history=False) for s in sessions], "meta": _meta()}
    finally:
        db.close()


@router.post("/sessions")
def save_session(request: SaveSessionRequest) -> dict:
    import uuid
    db = SessionLocal()
    try:
        s = OracleSession(
            id=str(uuid.uuid4()), title=request.title, summary=request.summary,
            history_json=request.history, page_context_json=request.page_context,
            model_stats_json=request.model_stats, total_tokens_used=request.total_tokens_used,
        )
        db.add(s)
        db.commit()
        return {"status": "ok", "data": _session_to_dict(s), "meta": _meta()}
    finally:
        db.close()


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    db = SessionLocal()
    try:
        s = db.query(OracleSession).filter_by(id=session_id).first()
        if not s:
            raise HTTPException(404, f"Session '{session_id}' tidak ditemukan")
        return {"status": "ok", "data": _session_to_dict(s), "meta": _meta()}
    finally:
        db.close()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str) -> dict:
    db = SessionLocal()
    try:
        s = db.query(OracleSession).filter_by(id=session_id).first()
        if not s:
            raise HTTPException(404, f"Session '{session_id}' tidak ditemukan")
        db.delete(s)
        db.commit()
        return {"status": "ok", "data": {"deleted": session_id}, "meta": _meta()}
    finally:
        db.close()


# ── Task Status ────────────────────────────────────────────────────────────────

@router.get("/tasks/{task_id}")
def get_task_status(task_id: str) -> dict:
    task = _agent.get_task(task_id)
    if not task:
        raise HTTPException(404, f"Task '{task_id}' tidak ditemukan")
    return {"status": "ok", "data": task, "meta": _meta()}


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str) -> dict:
    ok = _agent.cancel_task(task_id)
    if not ok:
        raise HTTPException(400, "Task tidak ditemukan atau sudah tidak berjalan")
    return {"status": "ok", "data": {"cancelled": task_id}, "meta": _meta()}

"""ORACLE — Conversational AI Intelligence System. Pengganti /api/home/chat (lihat ChatBubble lama)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.core.oracle_engine import OracleEngine

router = APIRouter(prefix="/api/oracle", tags=["oracle"])

_engine = OracleEngine()


def _meta() -> dict:
    return {"generated_at": datetime.now(timezone.utc).isoformat()}


class PageContext(BaseModel):
    current_page:    str | None = None
    module:          str | None = None
    entity_type:     str | None = None
    entity_id:       str | None = None
    entity_name:     str | None = None
    entity_snapshot: dict[str, Any] | None = None
    task_type:       str | None = None  # hint opsional untuk OracleModelRouter (mis. "draft_creation")


class ChatRequest(BaseModel):
    message:              str
    conversation_history: list[dict[str, Any]] = []
    page_context:          PageContext | None = None
    session_id:            str | None = None


@router.post("/chat")
def oracle_chat(body: ChatRequest) -> dict:
    result = _engine.chat(
        message               = body.message,
        conversation_history  = body.conversation_history,
        page_context          = body.page_context.model_dump() if body.page_context else None,
    )
    return {"status": "ok", "data": result, "meta": _meta()}


@router.post("/chat/stream")
async def oracle_chat_stream(body: ChatRequest) -> StreamingResponse:
    """
    SSE streaming — pakai _engine module-level yang SAMA dengan /chat (BUKAN
    OracleEngine() baru per request), supaya cache di toolkit (LANGKAH 7)
    benar-benar dipakai bersama antar request, bukan dibuat ulang tiap kali.

    guard.validate_input dipanggil ulang di engine.chat_stream() sendiri —
    tidak ada cabang "blocked_stream" terpisah di sini, supaya hanya ada SATU
    jalur logic blocking (lebih mudah dijaga konsistensinya).
    """
    page_context = body.page_context.model_dump() if body.page_context else None

    async def generate():
        async for event in _engine.chat_stream(
            message=body.message,
            conversation_history=body.conversation_history,
            page_context=page_context,
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

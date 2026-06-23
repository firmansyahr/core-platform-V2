"""ORACLE — Conversational AI Intelligence System. Pengganti /api/home/chat (lihat ChatBubble lama)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
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

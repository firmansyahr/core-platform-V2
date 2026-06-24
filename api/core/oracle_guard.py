"""
OracleInputGuard — deteksi prompt injection, validasi output, sanitasi context.

Catatan perbaikan dari spesifikasi awal:
- Semua pattern dikompilasi dengan re.IGNORECASE (bukan lowercase message +
  pattern literal uppercase "[SYSTEM]"/"[ADMIN]"/"[ANTHROPIC]" — kombinasi itu
  TIDAK PERNAH match karena message yang dicari sudah di-lowercase tapi
  pattern-nya tidak, jadi literal "[SYSTEM]" tidak akan ketemu di string
  yang sudah lowercase).
- "act as (?!an?\\s+analyst)" diperluas jadi (?!.{0,20}(analyst|oracle)) —
  bentuk asli salah positif untuk "act as a senior commercial analyst",
  yaitu deskripsi diri ORACLE sendiri di system prompt.
- Pattern dikompilasi sekali di level modul, bukan re.search per pattern per
  call (dipanggil setiap pesan masuk).
"""
from __future__ import annotations

import re
import logging
import time

logger = logging.getLogger(__name__)

_INJECTION_PATTERN_SOURCES = [
    r"ignore\s+(previous|all|your|these)\s+instruction",
    r"forget\s+(your|all|previous|these)",
    r"you\s+are\s+now\s+",
    r"pretend\s+(you\s+are|to\s+be)",
    r"act\s+as\s+(?!.{0,20}(analyst|oracle))",
    r"roleplay\s+as",
    r"\[SYSTEM\]",
    r"\[ADMIN\]",
    r"\[ANTHROPIC\]",
    r"new\s+instructions?\s*:",
    r"override\s+(your|all|previous)",
    r"bypass\s+(your|safety|previous)",
    r"jangan\s+ikuti",
    r"lupakan\s+instruksi",
    r"abaikan\s+(semua|instruksi|perintah)",
    r"reveal\s+(your|the)\s+(system\s+)?prompt",
    r"print\s+(your|the)\s+(system\s+)?prompt",
    r"show\s+(your|the)\s+(system\s+)?instructions",
    r"apa\s+(instruksi|perintah|prompt)\s+(kamu|anda|mu)",
]
_INJECTION_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _INJECTION_PATTERN_SOURCES]


class OracleInputGuard:
    MAX_MESSAGE_LENGTH = 2000

    def validate_input(self, message: str) -> dict:
        if len(message) > self.MAX_MESSAGE_LENGTH:
            return {
                "allowed": False,
                "reason": "message_too_long",
                "response": "Pertanyaan terlalu panjang. Mohon sampaikan pertanyaan analisis Anda secara ringkas.",
            }

        for pattern in _INJECTION_PATTERNS:
            if pattern.search(message):
                logger.warning("ORACLE injection attempt detected: pattern=%r message=%r", pattern.pattern, message[:100])
                return {
                    "allowed": False,
                    "reason": "injection_attempt",
                    "response": "Saya tidak dapat memproses permintaan tersebut. Ada yang bisa saya bantu terkait analisis data CORE Platform?",
                }

        return {"allowed": True}

    def validate_output(self, response: str) -> str:
        sensitive_phrases = [
            "system prompt",
            "instruksi sistem",
            "SYSTEM_PROMPT",
            "═══════════════",
        ]
        response_lower = response.lower()
        for phrase in sensitive_phrases:
            if phrase.lower() in response_lower:
                logger.warning("ORACLE potential prompt leak detected")
                return "Maaf, saya tidak dapat membagikan informasi tersebut. Ada yang bisa saya bantu terkait analisis data platform?"
        return response

    def sanitize_context(self, entity_snapshot: dict | None) -> dict:
        """Sanitize entity_snapshot sebelum di-inject ke context — pastikan tidak
        ada instruction-like content dari data (mis. nama toko/catatan yang
        disengaja diisi teks seperti instruksi)."""
        if not entity_snapshot:
            return {}

        sanitized: dict = {}
        injection_keywords = [
            "ignore", "forget", "pretend", "system", "prompt",
            "instruction", "override", "bypass", "jangan ikuti",
        ]

        for key, value in entity_snapshot.items():
            if isinstance(value, str):
                value_lower = value.lower()
                if any(kw in value_lower for kw in injection_keywords):
                    sanitized[key] = "[SANITIZED]"
                    logger.warning("ORACLE sanitized suspicious field: %s", key)
                else:
                    sanitized[key] = value
            else:
                sanitized[key] = value

        return sanitized


# ── Response cache (LANGKAH 7) ──────────────────────────────────────────────
#
# Diletakkan di sini (bukan duplikat di oracle_toolkit.py) supaya satu
# implementasi dipakai bersama oleh tool manapun yang butuh cache.

class _CacheEntry:
    __slots__ = ("data", "expires_at")

    def __init__(self, data, ttl_seconds: float) -> None:
        self.data = data
        self.expires_at = time.time() + ttl_seconds


class TTLCache:
    """Cache in-memory sederhana, per-proses (Railway start --workers 1, jadi
    tidak ada masalah konsistensi antar-proses)."""

    def __init__(self) -> None:
        self._store: dict[str, _CacheEntry] = {}

    def get(self, key: str):
        entry = self._store.get(key)
        if entry and time.time() < entry.expires_at:
            return entry.data
        if entry:
            del self._store[key]
        return None

    def set(self, key: str, data, ttl: float) -> None:
        self._store[key] = _CacheEntry(data, ttl)

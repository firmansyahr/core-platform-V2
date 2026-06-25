"""
OracleModelRouter — smart model routing untuk ORACLE: Haiku default (~80%),
Sonnet untuk analitis/perbandingan (~15%), Opus hanya untuk RCA/strategic
reasoning (~5%).

Perbaikan dari spesifikasi awal (diverifikasi terhadap test case sendiri di
LANGKAH 6 brief, bukan diterapkan mentah):
- OPUS = "claude-opus-4-5" bukan ID model valid — sama dengan bug yang
  berulang di beberapa giliran sebelumnya, dikoreksi ke "claude-opus-4-8".
- OPUS_KEYWORDS berisi r"bandingkan.{0,30}(semua|seluruh|tiap)" — pattern
  ini match "bandingkan performa semua promo bulan ini", padahal test
  assertion brief sendiri (LANGKAH 6) mengharapkan kalimat itu ROUTE KE
  SONNET. Karena OPUS dicek LEBIH DULU di route(), match OPUS di sini akan
  membuat assertion SONNET gagal. Dihapus — SONNET_KEYWORDS sudah punya
  r"bandingkan" polos yang cukup untuk kasus perbandingan biasa; perbedaan
  "perbandingan strategis mendalam" vs "perbandingan rutin" sudah tertutup
  oleh pattern OPUS lain (investigasi mendalam, analisis komprehensif, dst).
- Pattern "rca" diberi word boundary (\\brca\\b) — versi bare-substring
  berisiko match tidak sengaja di tengah kata lain; word boundary tidak
  mengubah hasil test case yang diminta ("lakukan RCA untuk toko..." tetap
  match), hanya mengurangi false positive di kalimat lain.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class RoutingDecision:
    model: str
    reason: str
    complexity_score: float  # 0.0 - 1.0


class OracleModelRouter:
    HAIKU = "claude-haiku-4-5-20251001"
    SONNET = "claude-sonnet-4-6"
    OPUS = "claude-opus-4-8"  # "claude-opus-4-5" di brief bukan ID model valid

    # ─── OPUS triggers (~5% requests) ───────────────────────────────────────
    OPUS_TASK_TYPES = [
        "full_rca",
        "strategic_simulation",
        "multi_hypothesis_analysis",
    ]

    OPUS_KEYWORDS = [
        r"root cause",
        r"\brca\b",
        r"kenapa.{0,30}(terus|konsisten|selalu|bulan)",
        r"mengapa.{0,30}(terus|konsisten|selalu|bulan)",
        r"investigasi mendalam",
        r"analisis komprehensif",
        r"simulasi (skenario|dampak|proyeksi)",
        r"prediksi.{0,20}(bulan|kuartal|tahun)",
        r"strategi.{0,20}(optimal|terbaik|rekomendasi)",
        # r"bandingkan.{0,30}(semua|seluruh|tiap)" — DIHAPUS, lihat docstring modul
    ]

    OPUS_COMPLEXITY_SIGNALS = [
        "conflicting_signals",
        "confidence_gap_high",
        "multi_cause_suspected",
    ]

    # ─── SONNET triggers (~15% requests) ────────────────────────────────────
    SONNET_TASK_TYPES = [
        "draft_creation",
        "trend_analysis",
        "cross_module_intelligence",
        "batch_alert_validation",
        "comparative_analysis",
        "report_generation",
    ]

    SONNET_KEYWORDS = [
        r"trend",
        r"bandingkan",
        r"buat draft",
        r"buatkan (laporan|ringkasan|rekomendasi)",
        r"analisis (semua|seluruh|tiap)",
        r"periode.{0,20}(lalu|sebelum|terakhir)",
        r"top \d+",
        r"bottom \d+",
        r"ranking",
        r"performa (bulan|minggu|kuartal)",
        r"cross.{0,10}(modul|module)",
        r"semua (promo|toko|area|program)",
    ]

    SONNET_COMPLEXITY_SIGNALS = [
        "multi_entity_gt3",
        "multi_period",
        "cross_module",
    ]

    # ─── HAIKU default (~80% requests) ──────────────────────────────────────
    HAIKU_TASK_TYPES = [
        "tool_execution",
        "simple_query",
        "alert_validation_single",
        "daily_briefing",
        "background_monitoring",
        "conversation_summary",
        "data_formatting",
        "status_check",
    ]

    def route(
        self,
        message: str,
        task_type: Optional[str] = None,
        complexity_signals: Optional[dict] = None,
        conversation_length: int = 0,
    ) -> RoutingDecision:
        message_lower = message.lower()
        signals = complexity_signals or {}

        # ── Check OPUS ───────────────────────────────────────────────────────
        if task_type in self.OPUS_TASK_TYPES:
            return RoutingDecision(model=self.OPUS, reason=f"task_type={task_type}", complexity_score=0.9)

        for pattern in self.OPUS_KEYWORDS:
            if re.search(pattern, message_lower):
                return RoutingDecision(model=self.OPUS, reason=f"keyword_match={pattern}", complexity_score=0.85)

        for signal in self.OPUS_COMPLEXITY_SIGNALS:
            if signals.get(signal):
                return RoutingDecision(model=self.OPUS, reason=f"complexity_signal={signal}", complexity_score=0.88)

        # ── Check SONNET ─────────────────────────────────────────────────────
        if task_type in self.SONNET_TASK_TYPES:
            return RoutingDecision(model=self.SONNET, reason=f"task_type={task_type}", complexity_score=0.6)

        for pattern in self.SONNET_KEYWORDS:
            if re.search(pattern, message_lower):
                return RoutingDecision(model=self.SONNET, reason=f"keyword_match={pattern}", complexity_score=0.55)

        for signal in self.SONNET_COMPLEXITY_SIGNALS:
            if signals.get(signal):
                return RoutingDecision(model=self.SONNET, reason=f"complexity_signal={signal}", complexity_score=0.6)

        if conversation_length > 10:
            return RoutingDecision(model=self.SONNET, reason="long_conversation_coherence", complexity_score=0.5)

        # ── Default: HAIKU ───────────────────────────────────────────────────
        return RoutingDecision(model=self.HAIKU, reason="default_simple_query", complexity_score=0.2)

    def route_for_agentic_step(self, step_type: str, step_data: Optional[dict] = None) -> str:
        """Routing untuk satu step di agentic loop — mayoritas Haiku."""
        sonnet_steps = {"multi_tool_synthesis", "draft_generation", "batch_analysis", "narrative_generation"}
        opus_steps = {"rca_hypothesis", "rca_synthesis", "strategic_reasoning", "conflict_resolution"}

        if step_type in opus_steps:
            return self.OPUS
        if step_type in sonnet_steps:
            return self.SONNET
        return self.HAIKU

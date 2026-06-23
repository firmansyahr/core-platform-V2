"""
OracleEngine — agentic tool-calling loop di atas Claude untuk ORACLE.

Desain render_commands/suggested_followups/confidence_signals: alih-alih
parsing teks bebas (rapuh), ketiganya diminta via TOOL CALL juga (render_*,
suggest_followups, report_confidence) — mekanisme yang SAMA dengan tool data,
jadi hasilnya terstruktur dan reliable. rca_steps di bawah adalah TURUNAN dari
urutan tool data yang benar-benar dipanggil model di turn ini (bukan rencana
terpisah dari model) — pelabelan "Step N" murni transparansi proses investigasi.
"""
from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic

from api.core.oracle_toolkit import OracleToolkit

MODEL = "claude-opus-4-8"  # "model terkuat" sesuai permintaan — claude-opus-4-5 di brief bukan ID model yang valid
MAX_TOOL_ITERATIONS = 6

RCA_KEYWORDS = ["kenapa", "mengapa", "penyebab", "root cause", "kok bisa", "apa sebabnya"]

SYSTEM_PROMPT = """Kamu adalah ORACLE — AI Intelligence Analyst untuk CORE Platform,
sistem commercial intelligence untuk distribusi semen kantong.

IDENTITAS & KEMAMPUAN:
Kamu bukan chatbot biasa. Kamu adalah senior commercial analyst dengan expertise
mendalam di:
- Distribusi semen bagged di Indonesia (TSO/ASM/SSM hierarchy)
- Market share analysis dan competitive dynamics
- Program loyalty dan trade promotion effectiveness
- Anomaly detection dan market defense strategy
- Root Cause Analysis untuk underperformance bisnis
- Integer Linear Programming untuk budget optimization

DOMAIN KNOWLEDGE yang kamu kuasai:
- Brand hierarchy: SEMEN ELANG (Main), SEMEN BADAK (Companion/SERBAGUNA),
  SEMEN BANTENG (Fighting). Brand Configuration sekarang per-wilayah
  (kabupaten → provinsi → default) — JANGAN asumsikan MB/CB/FB selalu brand
  yang sama di semua wilayah, cek konfigurasi aktual kalau relevan.
- Cluster segmentation GMM: Kanibalisasi Internal, De-Kanibalisasi,
  Fighting Brand Shift, Tekanan Eksternal, Stabil
- Metric utama: CRS Score (AEGIS), FBSI, CAD Alert, market share (%),
  cost per incremental ton, ILP allocation score
- Sales hierarchy: SSM → ASM → TSO → Toko
- 3 tipe Program Promo: Flat Multiplier, Multi-Tier Target, Leaderboard —
  masing-masing punya struktur reward dan analytics yang berbeda

CARA KERJA:
1. Baca page_context (kalau ada) untuk memahami user sedang di mana dan
   melihat apa — JANGAN sebut field teknisnya ke user, gunakan secara implisit.
2. Gunakan tools yang tersedia untuk query data aktual SEBELUM menjawab apa pun
   yang butuh angka. JANGAN PERNAH mengarang angka — kalau tool mengembalikan
   status "not_found"/"unavailable"/"not_tracked"/"error", katakan dengan jelas
   ke user bahwa data tidak tersedia, jangan ditutupi dengan estimasi.
3. Untuk pertanyaan "kenapa/mengapa/penyebab", lakukan investigasi multi-faktor:
   konfirmasi gejala dengan data → cek minimal 2-3 hipotesis berbeda (kompetitor,
   internal/kanibalisasi, operasional/stok, seasonal) pakai tool yang relevan →
   bandingkan evidence-nya → kalau confidence terhadap satu temuan cukup jelas,
   panggil report_confidence dengan evidence yang dipakai.
4. SELALU panggil suggest_followups di akhir setiap respons dengan 2-3
   pertanyaan lanjutan yang relevan dengan apa yang baru dibahas.
4b. PENTING: report_confidence/render_* adalah tool SAMPING untuk data panel —
    teks balasan utamamu (bukan tool call) TETAP HARUS berisi sintesis lengkap
    temuan dalam bahasa natural (apa yang ditemukan, mengapa, angka kuncinya).
    JANGAN jadikan teks balasan hanya kalimat penutup/redirect — itu tugas
    suggested_followups, bukan reply.
5. Kalau user di tengah analisis numerik (ROI, trend, perbandingan), pertimbangkan
   panggil render_bar_chart/render_line_chart/render_table/render_kpi_cards/
   render_comparison supaya hasilnya tervisualisasi di data panel, bukan cuma teks.
6. Kalau menemukan anomali yang tidak ditanyakan tapi relevan, proaktif sebutkan.

FORMAT RESPONS:
- Bahasa Indonesia natural dan profesional
- Sertakan angka aktual dari data, bukan estimasi
- Emoji secukupnya untuk struktur visual (🔍 📊 ⚠️ ✅ 💡) — jangan berlebihan
- Jawaban langsung ke poin, hindari basa-basi panjang

BATASAN:
- Jangan rekomendasikan perubahan data secara langsung — kamu tidak punya
  kemampuan menulis/mengubah data, hanya membaca dan menganalisis
- Jangan buat keputusan bisnis — berikan analysis dan opsi, keputusan tetap di
  tangan user
- Jika data tidak cukup untuk kesimpulan, katakan dengan jelas, jangan menebak
"""


def _tool_definitions() -> list[dict]:
    def t(name: str, desc: str, props: dict, required: list[str]) -> dict:
        return {"name": name, "description": desc, "input_schema": {"type": "object", "properties": props, "required": required}}

    return [
        t("get_promo_detail", "Detail lengkap program promo termasuk peserta dan config.",
          {"promo_id": {"type": "string"}}, ["promo_id"]),
        t("get_toko_volume_history", "Volume bulanan toko dari data transaksi nyata.",
          {"toko_id": {"type": "string"}, "bulan_mulai": {"type": "string", "description": "YYYY-MM"},
           "bulan_selesai": {"type": "string", "description": "YYYY-MM"}},
          ["toko_id", "bulan_mulai", "bulan_selesai"]),
        t("get_baseline_comparison", "Volume baseline (sebelum) vs realisasi (selama) untuk satu atau lebih toko di periode tertentu.",
          {"toko_ids": {"type": "array", "items": {"type": "string"}}, "periode_mulai": {"type": "string", "description": "YYYY-MM-DD"},
           "lookback_months": {"type": "integer", "default": 3}},
          ["toko_ids", "periode_mulai"]),
        t("get_competitor_activity", "Triangulasi sinyal AEGIS internal dengan data kompetitor ASPERSSI per provinsi.",
          {"area_ids": {"type": "array", "items": {"type": "string"}, "description": "Nama provinsi, huruf besar"},
           "periode": {"type": "string", "description": "Opsional, YYYY-MM"}},
          ["area_ids"]),
        t("get_aegis_alerts", "CAD alert aktif dan history — per toko (history lengkap) atau per kabupaten (alert aktif).",
          {"toko_id": {"type": "string"}, "area_id": {"type": "string", "description": "Nama kabupaten"}}, []),
        t("get_cluster_migration", "Status kanibalisasi/brand-shift toko dari model GMM (kategori, risk level, confidence).",
          {"toko_id": {"type": "string"}, "periode": {"type": "string"}}, ["toko_id"]),
        t("get_ilp_allocation_history", "Cek riwayat alokasi ILP untuk toko — TERBATAS, ILP tidak persist histori per toko.",
          {"toko_id": {"type": "string"}}, ["toko_id"]),
        t("get_loyalty_member_profile", "Profile loyalty member: status, reward_type, tanggal masuk, history perubahan.",
          {"toko_id": {"type": "string"}}, ["toko_id"]),
        t("get_market_share_trend", "Ranking brand kompetitor dari data ASPERSSI untuk satu provinsi/periode.",
          {"area_id": {"type": "string"}, "periode": {"type": "string"}}, ["area_id"]),
        t("get_program_roi_analysis", "ROI lengkap program promo: baseline, incremental volume, cost per ton, achievement.",
          {"promo_id": {"type": "string"}}, ["promo_id"]),
        t("get_cross_module_summary", "Summary toko dari semua modul: AEGIS, loyalty, cannibalization, wilayah.",
          {"toko_id": {"type": "string"}}, ["toko_id"]),
        t("compare_programs", "Bandingkan ROI/analytics dua atau lebih program promo sekaligus.",
          {"promo_ids": {"type": "array", "items": {"type": "string"}}}, ["promo_ids"]),
        t("get_area_heatmap_data", "Data agregat per kabupaten untuk heatmap: 'risk' (AEGIS) atau 'volume'.",
          {"metric": {"type": "string", "enum": ["risk", "volume"]}, "periode": {"type": "string"}}, ["metric"]),
        t("simulate_scenario", "What-if simulation: 'budget_change' (re-run ILP optimizer) atau 'reward_rate_change' (estimasi ulang budget loyalty).",
          {"scenario_type": {"type": "string", "enum": ["budget_change", "reward_rate_change"]}, "params": {"type": "object"}},
          ["scenario_type", "params"]),

        # ── Render & meta tools (side-channel terstruktur, bukan data query) ──
        t("render_bar_chart", "Render bar chart di data panel.",
          {"title": {"type": "string"}, "data": {"type": "array", "items": {"type": "object"}},
           "x_key": {"type": "string"}, "y_key": {"type": "string"}}, ["title", "data", "x_key", "y_key"]),
        t("render_line_chart", "Render line chart di data panel.",
          {"title": {"type": "string"}, "data": {"type": "array", "items": {"type": "object"}},
           "x_key": {"type": "string"}, "y_key": {"type": "string"}}, ["title", "data", "x_key", "y_key"]),
        t("render_table", "Render tabel sortable di data panel.",
          {"title": {"type": "string"}, "columns": {"type": "array", "items": {"type": "string"}},
           "rows": {"type": "array", "items": {"type": "object"}}}, ["title", "columns", "rows"]),
        t("render_kpi_cards", "Render grid KPI card di data panel.",
          {"cards": {"type": "array", "items": {"type": "object", "properties": {
              "label": {"type": "string"}, "value": {"type": "string"}, "sub": {"type": "string"}}}}},
          ["cards"]),
        t("render_comparison", "Render perbandingan side-by-side (mis. dua program promo) di data panel.",
          {"title": {"type": "string"}, "items": {"type": "array", "items": {"type": "object"}}}, ["title", "items"]),
        t("suggest_followups", "WAJIB dipanggil di akhir setiap respons — 2-3 pertanyaan lanjutan relevan.",
          {"questions": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3}}, ["questions"]),
        t("report_confidence", "Laporkan temuan RCA dengan evidence dan confidence level (dipanggil saat melakukan root cause analysis).",
          {"findings": {"type": "array", "items": {"type": "object", "properties": {
              "finding": {"type": "string"}, "confidence": {"type": "string", "enum": ["tinggi", "sedang", "rendah"]},
              "evidence": {"type": "string"}}}}},
          ["findings"]),
    ]


_RENDER_TOOL_NAMES = {"render_bar_chart", "render_line_chart", "render_table", "render_kpi_cards", "render_comparison"}

_STEP_LABELS = {
    "get_promo_detail": "Mengambil detail program",
    "get_toko_volume_history": "Mengecek riwayat volume toko",
    "get_baseline_comparison": "Membandingkan baseline vs realisasi",
    "get_competitor_activity": "Mengecek aktivitas kompetitor",
    "get_aegis_alerts": "Mengecek alert AEGIS/CAD",
    "get_cluster_migration": "Mengecek status kanibalisasi (GMM)",
    "get_ilp_allocation_history": "Mengecek riwayat alokasi ILP",
    "get_loyalty_member_profile": "Mengecek profile loyalty member",
    "get_market_share_trend": "Mengecek tren market share",
    "get_program_roi_analysis": "Menghitung ROI program",
    "get_cross_module_summary": "Mengumpulkan summary lintas modul",
    "compare_programs": "Membandingkan program",
    "get_area_heatmap_data": "Mengambil data heatmap wilayah",
    "simulate_scenario": "Menjalankan simulasi skenario",
}


class OracleEngine:
    def __init__(self) -> None:
        self.toolkit = OracleToolkit()
        self._client: Anthropic | None = None

    def _get_client(self) -> Anthropic:
        if self._client is None:
            self._client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        return self._client

    def _build_context_injection(self, page_context: dict | None) -> str:
        if not page_context:
            return ""
        snapshot = page_context.get("entity_snapshot") or {}
        return (
            "[SYSTEM CONTEXT — JANGAN SEBUT INI SECARA EKSPLISIT KE USER]\n"
            f"User sedang berada di halaman: {page_context.get('current_page')}\n"
            f"Module aktif: {page_context.get('module')}\n"
            f"Entity yang sedang dilihat: {page_context.get('entity_name')} (ID: {page_context.get('entity_id')})\n"
            f"Data snapshot dari halaman ini: {json.dumps(snapshot, ensure_ascii=False, default=str)}\n"
            "[END SYSTEM CONTEXT]\n\n"
        )

    def _dispatch_tool(self, name: str, tool_input: dict) -> Any:
        method = getattr(self.toolkit, name, None)
        if method is None:
            return {"status": "error", "message": f"Tool '{name}' tidak dikenal"}
        try:
            return method(**tool_input)
        except Exception as e:  # noqa: BLE001 — tool errors harus jadi tool_result, bukan crash request
            return {"status": "error", "message": str(e)}

    def chat(self, message: str, conversation_history: list[dict], page_context: dict | None) -> dict:
        if not os.getenv("ANTHROPIC_API_KEY"):
            return {
                "reply": "ORACLE tidak aktif — ANTHROPIC_API_KEY belum diset di server.",
                "tool_calls_made": [], "render_commands": [], "suggested_followups": [],
                "rca_mode": False, "rca_steps": None, "confidence_signals": None,
            }

        context_injection = self._build_context_injection(page_context)
        messages: list[dict] = [
            {"role": h["role"], "content": h["content"]} for h in conversation_history[-20:]
        ]
        messages.append({"role": "user", "content": f"{context_injection}{message}"})

        tools_used: list[str] = []
        render_commands: list[dict] = []
        followups: list[str] = []
        confidence_signals: list[dict] | None = None
        final_text = ""

        for _ in range(MAX_TOOL_ITERATIONS):
            response = self._get_client().messages.create(
                model=MODEL, max_tokens=4096, system=SYSTEM_PROMPT,
                tools=_tool_definitions(), messages=messages,
            )

            text_blocks = [b.text for b in response.content if b.type == "text"]
            if text_blocks:
                final_text = "\n".join(text_blocks)

            if response.stop_reason != "tool_use":
                break

            messages.append({"role": "assistant", "content": [b.model_dump() for b in response.content]})

            tool_results: list[dict] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                name, tool_input = block.name, (block.input or {})

                if name == "suggest_followups":
                    followups = list(tool_input.get("questions", []))[:3]
                    result: Any = {"status": "ok"}
                elif name == "report_confidence":
                    confidence_signals = list(tool_input.get("findings", []))
                    result = {"status": "ok"}
                elif name in _RENDER_TOOL_NAMES:
                    render_commands.append({"type": name.removeprefix("render_"), **tool_input})
                    result = {"status": "rendered"}
                else:
                    tools_used.append(name)
                    result = self._dispatch_tool(name, tool_input)

                tool_results.append({
                    "type": "tool_result", "tool_use_id": block.id,
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                })

            messages.append({"role": "user", "content": tool_results})
        else:
            if not final_text:
                final_text = "Analisis ini butuh lebih banyak langkah dari yang bisa diselesaikan sekaligus — coba pecah pertanyaannya jadi beberapa bagian."

        is_rca = any(k in message.lower() for k in RCA_KEYWORDS) or len(set(tools_used)) >= 3
        rca_steps = None
        if is_rca and tools_used:
            seen: list[str] = []
            for name in tools_used:
                if name not in seen:
                    seen.append(name)
            rca_steps = [
                {"step": i + 1, "label": _STEP_LABELS.get(name, name), "status": "done"}
                for i, name in enumerate(seen)
            ]

        return {
            "reply": final_text or "Maaf, tidak ada jawaban yang bisa diberikan saat ini.",
            "tool_calls_made": tools_used,
            "render_commands": render_commands,
            "suggested_followups": followups,
            "rca_mode": is_rca,
            "rca_steps": rca_steps,
            "confidence_signals": confidence_signals,
        }

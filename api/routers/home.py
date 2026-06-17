from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel

from api.core.aegis_engine import get_store_crs
from api.core.data_loader import load_data
from api.core.insight_engine import (
    answer_analytics_question,
    generate_home_insight,
    generate_monthly_report,
)

router = APIRouter(prefix="/api/home", tags=["home"])

FIGHTING_BRAND  = "SEMEN BANTENG"
MAIN_BRAND      = "SEMEN ELANG"
COMPANION_BRAND = "SEMEN BADAK"

_META = lambda: {"generated_at": datetime.now(timezone.utc).isoformat()}


class HomeSummary(BaseModel):
    volume_bulan_ini: float
    growth_mom_pct: float
    growth_yoy_pct: float | None
    toko_aktif: int
    fighting_brand_share_pct: float
    warning_merah: int
    warning_oranye: int
    warning_kuning: int
    cad_alert_count: int
    volume_at_risk: float
    volume_at_risk_pct: float


class HomeSummaryResponse(BaseModel):
    status: str
    data: HomeSummary
    meta: dict[str, str]


class TrendPoint(BaseModel):
    bulan: str
    volume: float


class TrendResponse(BaseModel):
    status: str
    data: list[TrendPoint]
    meta: dict[str, str]


@router.get("/insight")
def get_home_insight() -> dict:
    """Generate AI narrative insight for home dashboard."""
    summary_resp = get_home_summary()
    summary_dict = summary_resp.data.model_dump()
    result = generate_home_insight(summary_dict)
    return {"status": "ok", "data": result, "meta": _META()}


@router.get("/trend", response_model=TrendResponse)
def get_home_trend() -> TrendResponse:
    df = load_data()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()
    months = sorted([latest - i for i in range(12)])

    data = [
        TrendPoint(
            bulan=str(m),
            volume=round(float(df[period_col == m]["TON Quantity"].sum()), 2),
        )
        for m in months
    ]

    return TrendResponse(status="ok", data=data, meta=_META())


@router.get("/summary", response_model=HomeSummaryResponse)
def get_home_summary() -> HomeSummaryResponse:
    df = load_data()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()

    vol_current = float(df[period_col == latest]["TON Quantity"].sum())
    vol_prev    = float(df[period_col == latest - 1]["TON Quantity"].sum())
    vol_yoy     = float(df[period_col == latest - 12]["TON Quantity"].sum())

    growth_mom = (vol_current - vol_prev) / vol_prev * 100 if vol_prev > 0 else 0.0
    growth_yoy = (vol_current - vol_yoy) / vol_yoy * 100 if vol_yoy > 0 else None

    latest_mask = period_col == latest
    fb_mask     = df["Brands"] == FIGHTING_BRAND
    total_ton_latest = df[latest_mask]["TON Quantity"].sum()
    fight_ton_latest = df[latest_mask & fb_mask]["TON Quantity"].sum()
    fb_share    = float(fight_ton_latest / total_ton_latest * 100) if total_ton_latest > 0 else 0.0
    toko_aktif  = int(df[latest_mask]["ID Toko"].nunique())

    stores        = get_store_crs()
    warning_stores = stores[stores["alert"] != "Normal"]
    vol_at_risk   = round(float(warning_stores["ton_latest"].fillna(0).sum()), 1)
    vol_at_risk_pct = round(vol_at_risk / float(total_ton_latest) * 100, 2) if total_ton_latest > 0 else 0.0

    return HomeSummaryResponse(
        status="ok",
        data=HomeSummary(
            volume_bulan_ini=round(vol_current, 2),
            growth_mom_pct=round(growth_mom, 2),
            growth_yoy_pct=round(growth_yoy, 2) if growth_yoy is not None else None,
            toko_aktif=toko_aktif,
            fighting_brand_share_pct=round(fb_share, 2),
            warning_merah=int((stores["alert"] == "Merah").sum()),
            warning_oranye=int((stores["alert"] == "Oranye").sum()),
            warning_kuning=int((stores["alert"] == "Kuning").sum()),
            cad_alert_count=int(stores["cad"].sum()),
            volume_at_risk=vol_at_risk,
            volume_at_risk_pct=vol_at_risk_pct,
        ),
        meta=_META(),
    )


# ── Warning Trend (4 minggu terakhir) ─────────────────────────────────────────

@router.get("/warning-trend")
def get_warning_trend() -> dict:
    df = load_data()
    df["_week"] = df["Tanggal Transaksi"].dt.to_period("W")

    all_weeks = sorted(df["_week"].unique())
    # Take last 4 complete weeks (skip the most recent if data is incomplete)
    target_weeks = all_weeks[-4:]

    result = []
    for week in target_weeks:
        wdf = df[df["_week"] == week]

        # Per-store FBSI proxy (fighting brand share of total ton)
        store_total = wdf.groupby("ID Toko")["TON Quantity"].sum()
        store_fb    = (
            wdf[wdf["Brands"] == FIGHTING_BRAND]
            .groupby("ID Toko")["TON Quantity"]
            .sum()
            .reindex(store_total.index, fill_value=0.0)
        )
        fb_pct = (store_fb / store_total.replace(0, float("nan")) * 100).fillna(0)

        merah  = int((fb_pct >= 15.0).sum())
        oranye = int(((fb_pct >= 7.5) & (fb_pct < 15.0)).sum())
        kuning = int(((fb_pct >= 3.0) & (fb_pct < 7.5)).sum())

        # Label: start date of the week as "DD Mon"
        start_ts = week.start_time
        months_id = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"]
        label = f"{start_ts.day} {months_id[start_ts.month - 1]}"

        result.append({
            "minggu": label,
            "merah": merah,
            "oranye": oranye,
            "kuning": kuning,
            "total": merah + oranye + kuning,
        })

    return {"status": "ok", "data": result, "meta": _META()}


# ── Brand Mix (bulan terakhir) ─────────────────────────────────────────────────

@router.get("/brand-mix")
def get_brand_mix() -> dict:
    df = load_data()
    period_col = df["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col.max()
    ldf = df[period_col == latest]

    total_ton    = float(ldf["TON Quantity"].sum())
    main_ton     = float(ldf[ldf["Brands"] == MAIN_BRAND]["TON Quantity"].sum())
    companion_ton = float(ldf[ldf["Brands"] == COMPANION_BRAND]["TON Quantity"].sum())
    fighting_ton = float(ldf[ldf["Brands"] == FIGHTING_BRAND]["TON Quantity"].sum())

    def pct(v: float) -> float:
        return round(v / total_ton * 100, 1) if total_ton > 0 else 0.0

    return {
        "status": "ok",
        "data": {
            "main_brand_ton":   round(main_ton, 1),
            "companion_ton":    round(companion_ton, 1),
            "fighting_ton":     round(fighting_ton, 1),
            "total_ton":        round(total_ton, 1),
            "main_pct":         pct(main_ton),
            "companion_pct":    pct(companion_ton),
            "fighting_pct":     pct(fighting_ton),
        },
        "meta": _META(),
    }


# ── Warning Heatmap per Provinsi ───────────────────────────────────────────────

@router.get("/warning-heatmap")
def get_warning_heatmap() -> dict:
    stores = get_store_crs()
    df     = load_data()

    # Build kabupaten → provinsi mapping
    kab_prov = (
        df[["Kabupaten Toko", "Provinsi Toko"]]
        .drop_duplicates()
        .set_index("Kabupaten Toko")["Provinsi Toko"]
        .to_dict()
    )
    stores = stores.copy()
    stores["provinsi"] = stores["Kabupaten Toko"].map(kab_prov).fillna("LAINNYA")

    warning_stores = stores[stores["alert"] != "Normal"]

    result = []
    for prov, grp in warning_stores.groupby("provinsi"):
        total   = len(grp)
        merah   = int((grp["alert"] == "Merah").sum())
        oranye  = int((grp["alert"] == "Oranye").sum())
        kuning  = int((grp["alert"] == "Kuning").sum())
        ton     = round(float(grp["ton_latest"].fillna(0).sum()), 1)
        result.append({
            "provinsi":      str(prov),
            "total_warning": total,
            "merah":         merah,
            "oranye":        oranye,
            "kuning":        kuning,
            "pct_merah":     round(merah / total * 100, 1) if total > 0 else 0.0,
            "total_ton":     ton,
        })

    result.sort(key=lambda x: x["total_warning"], reverse=True)
    return {"status": "ok", "data": result, "meta": _META()}


# ── Chat (Conversational Analytics) ──────────────────────────────────────────

class ChatRequest(BaseModel):
    question: str
    conversation_history: list[dict[str, Any]] = []


def _suggested_questions(question: str) -> list[str]:
    q = question.lower()
    if any(w in q for w in ["loyalty", "peserta", "achievement", "efektivitas", "program"]):
        return [
            "Berapa efektivitas program bulan ini?",
            "Toko mana yang achievement-nya terendah?",
            "Berapa estimasi budget program?",
        ]
    if any(w in q for w in ["warning", "merah", "kritis", "aegis", "pola", "toko"]):
        return [
            "Kabupaten mana yang paling kritis?",
            "Berapa toko Pola B bulan ini?",
            "Wilayah mana yang perlu dikunjungi segera?",
        ]
    if any(w in q for w in ["volume", "growth", "tren", "mom", "yoy"]):
        return [
            "Bagaimana tren volume 3 bulan terakhir?",
            "Berapa porsi produk murah bulan ini?",
            "Berapa toko aktif bulan ini?",
        ]
    return [
        "Berapa toko warning hari ini?",
        "Wilayah mana yang paling kritis?",
        "Bagaimana efektivitas program loyalty?",
    ]


@router.post("/chat")
def chat_analytics(body: ChatRequest) -> dict:
    summary_resp = get_home_summary()
    summary_dict = summary_resp.data.model_dump()

    stores = get_store_crs()
    warning_stores = stores[stores["alert"] != "Normal"]

    # Top 10 warning kabupaten
    top_kab: list[dict] = []
    if "Kabupaten Toko" in warning_stores.columns:
        kab_counts = (
            warning_stores.groupby("Kabupaten Toko")["ID Toko"]
            .count()
            .sort_values(ascending=False)
            .head(10)
        )
        top_kab = [{"kabupaten": str(k), "jumlah_toko": int(v)} for k, v in kab_counts.items()]

    # Pola distribution
    pola_dist: dict[str, int] = {}
    if "pola_kode" in warning_stores.columns:
        for p, cnt in warning_stores["pola_kode"].value_counts().items():
            pola_dist[str(p)] = int(cnt)

    # Loyalty data
    loyalty_summary: dict = {}
    try:
        from api.routers.loyalty import get_summary as loyalty_get_summary  # type: ignore[import]
        lres = loyalty_get_summary()
        loyalty_summary = lres.get("data", {})
    except Exception:
        pass

    data_context = {
        "kpi_bulan_ini": summary_dict,
        "top_10_kabupaten_warning": top_kab,
        "distribusi_pola_warning": pola_dist,
        "total_warning_stores": int(len(warning_stores)),
        "loyalty": loyalty_summary,
    }

    result = answer_analytics_question(
        question=body.question,
        conversation_history=body.conversation_history,
        data_context=data_context,
    )
    result["suggested_questions"] = _suggested_questions(body.question)

    return {"status": "ok", "data": result, "meta": _META()}


# ── AI Report: generate + PDF ─────────────────────────────────────────────────

_report_cache: dict[str, Any] = {}


@router.post("/report/generate")
def generate_report() -> dict:
    summary_resp = get_home_summary()
    summary_dict = summary_resp.data.model_dump()

    stores    = get_store_crs()
    warning   = stores[stores["alert"] != "Normal"]

    top_kab: list[dict] = []
    if "Kabupaten Toko" in warning.columns:
        kab_counts = (
            warning.groupby("Kabupaten Toko")["ID Toko"]
            .count().sort_values(ascending=False).head(5)
        )
        top_kab = [{"kabupaten": str(k), "jumlah": int(v)} for k, v in kab_counts.items()]

    pola_dist: dict[str, int] = {}
    if "pola_kode" in warning.columns:
        for p, cnt in warning["pola_kode"].value_counts().items():
            pola_dist[str(p)] = int(cnt)

    loyalty_summary: dict = {}
    try:
        from api.routers.loyalty import get_summary as loyalty_get_summary  # type: ignore[import]
        lres = loyalty_get_summary()
        loyalty_summary = lres.get("data", {})
    except Exception:
        pass

    # Determine current periode
    df = load_data()
    latest_p = df["Tanggal Transaksi"].dt.to_period("M").max()
    periode  = str(latest_p)

    report_data = {
        "periode": periode,
        "summary": summary_dict,
        "aegis": {
            "total_warning": int(len(warning)),
            "merah":   int((warning["alert"] == "Merah").sum()),
            "oranye":  int((warning["alert"] == "Oranye").sum()),
            "kuning":  int((warning["alert"] == "Kuning").sum()),
            "top_kabupaten": top_kab,
            "distribusi_pola": pola_dist,
        },
        "loyalty": loyalty_summary,
    }

    result = generate_monthly_report(report_data)

    # Cache the raw data for PDF generation
    _report_cache["latest"] = {"report_data": report_data, "result": result}

    return {"status": "ok", "data": result, "meta": _META()}


@router.get("/report/pdf")
def download_report_pdf(periode: str = Query(default="")) -> Response:
    from io import BytesIO as _BytesIO
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    )

    cached = _report_cache.get("latest", {})
    report_data: dict = cached.get("report_data", {})
    result: dict      = cached.get("result", {})

    if not result or result.get("status") != "ok":
        # Regenerate if cache miss — call the POST handler logic directly
        generate_report()
        cached    = _report_cache.get("latest", {})
        report_data = cached.get("report_data", {})
        result    = cached.get("result", {})

    sections = result.get("sections") or {}
    periode_label = report_data.get("periode", periode or "N/A")
    summary  = report_data.get("summary", {})
    aegis    = report_data.get("aegis", {})
    loyalty  = report_data.get("loyalty", {})

    buf = _BytesIO()
    _DARK   = colors.HexColor("#0f172a")
    _MUTED  = colors.HexColor("#64748b")
    _RED    = colors.HexColor("#DC2626")
    _BLUE   = colors.HexColor("#2563eb")
    _BORDER = colors.HexColor("#e2e8f0")
    _TH_BG  = colors.HexColor("#1e293b")
    _ROW_ALT= colors.HexColor("#f8fafc")

    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
        title=f"Laporan Bulanan CORE Platform — {periode_label}",
    )

    def _st(name: str, **kw) -> ParagraphStyle:
        s = ParagraphStyle(name, fontName="Helvetica", fontSize=10, textColor=_DARK,
                           leading=14, spaceAfter=0, spaceBefore=0)
        for k, v in kw.items():
            setattr(s, k, v)
        return s

    title_st   = _st("title",   fontSize=18, fontName="Helvetica-Bold", alignment=1, textColor=_DARK, spaceAfter=4)
    sub_st     = _st("sub",     fontSize=12, alignment=1, textColor=_MUTED, spaceAfter=2)
    meta_st    = _st("meta",    fontSize=8,  alignment=1, textColor=_MUTED, spaceAfter=0)
    h2_st      = _st("h2",      fontSize=13, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=4)
    body_st    = _st("body",    fontSize=9,  leading=13, spaceAfter=0)
    caption_st = _st("caption", fontSize=8,  textColor=_MUTED)

    def _tbl_style(rows: int) -> TableStyle:
        cmds = [
            ("BACKGROUND",  (0,0), (-1,0),  _TH_BG),
            ("TEXTCOLOR",   (0,0), (-1,0),  colors.white),
            ("FONTNAME",    (0,0), (-1,0),  "Helvetica-Bold"),
            ("FONTSIZE",    (0,0), (-1,-1), 8),
            ("GRID",        (0,0), (-1,-1), 0.4, _BORDER),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, _ROW_ALT]),
            ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
            ("PADDING",     (0,0), (-1,-1), 4),
        ]
        return TableStyle(cmds)

    story = []

    # ── Cover
    story.append(Spacer(1, 1*cm))
    story.append(Paragraph("LAPORAN BULANAN", title_st))
    story.append(Paragraph(f"Ringkasan Kinerja Distribusi — {periode_label}", sub_st))
    generated_at = result.get("generated_at", "")
    story.append(Paragraph(f"Generated by CORE Platform AI  •  {generated_at}", meta_st))
    story.append(HRFlowable(width="100%", thickness=1, color=_BORDER, spaceAfter=12, spaceBefore=8))

    # ── 1. Executive Summary
    story.append(Paragraph("1. Executive Summary", h2_st))
    for para in (sections.get("executive_summary") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    story.append(Spacer(1, 8))

    # ── 2. KPI Table
    story.append(Paragraph("2. KPI Utama Bulan Ini", h2_st))
    kpi_rows = [
        ["Metrik", "Nilai"],
        ["Volume Bulan Ini", f"{summary.get('volume_bulan_ini', 0):,.0f} TON"],
        ["Growth MoM", f"{summary.get('growth_mom_pct', 0):+.1f}%"],
        ["Growth YoY", f"{summary.get('growth_yoy_pct', 0):+.1f}%" if summary.get('growth_yoy_pct') is not None else "N/A"],
        ["Toko Aktif", f"{summary.get('toko_aktif', 0):,}"],
        ["Warning Merah", str(summary.get("warning_merah", 0))],
        ["Warning Oranye", str(summary.get("warning_oranye", 0))],
        ["Warning Kuning", str(summary.get("warning_kuning", 0))],
        ["Porsi Produk Murah", f"{summary.get('fighting_brand_share_pct', 0):.1f}%"],
        ["Volume Berisiko", f"{summary.get('volume_at_risk_pct', 0):.1f}% dari total"],
    ]
    kpi_tbl = Table(kpi_rows, colWidths=[9*cm, 7*cm])
    kpi_tbl.setStyle(_tbl_style(len(kpi_rows)-1))
    story.append(kpi_tbl)
    story.append(Spacer(1, 8))

    # ── 3. AEGIS Analysis
    story.append(Paragraph("3. Kondisi Pasar & AEGIS Warning", h2_st))
    for para in (sections.get("analisis_aegis") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    top_kab = aegis.get("top_kabupaten", [])
    if top_kab:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Top 5 Kabupaten Warning", caption_st))
        kab_rows = [["Kabupaten", "Jumlah Toko"]] + [
            [k["kabupaten"].replace("KABUPATEN ", "KAB. "), str(k["jumlah"])] for k in top_kab
        ]
        kab_tbl = Table(kab_rows, colWidths=[11*cm, 5*cm])
        kab_tbl.setStyle(_tbl_style(len(kab_rows)-1))
        story.append(kab_tbl)
    story.append(Spacer(1, 8))

    # ── 4. Loyalty
    story.append(Paragraph("4. Program Loyalty", h2_st))
    for para in (sections.get("analisis_loyalty") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    eff = loyalty.get("efektivitas_bulan_ini") or {}
    loy_rows = [
        ["Metrik", "Nilai"],
        ["Peserta Aktif", str(loyalty.get("total_aktif", "–"))],
        ["Efektivitas Program", f"{eff.get('efektivitas_pct', 0):.1f}%" if eff else "–"],
        ["Volume Achievement", f"{eff.get('volume_achievement_pct', 0):.1f}%" if eff else "–"],
        ["Estimasi Budget", f"Rp {loyalty.get('est_budget_bulan', 0):,.0f}"],
    ]
    loy_tbl = Table(loy_rows, colWidths=[9*cm, 7*cm])
    loy_tbl.setStyle(_tbl_style(len(loy_rows)-1))
    story.append(loy_tbl)
    story.append(Spacer(1, 8))

    # ── 5. Recommendations
    story.append(Paragraph("5. Rekomendasi Tindakan", h2_st))
    for line in (sections.get("rekomendasi") or "–").split("\n"):
        if line.strip():
            story.append(Paragraph(line.strip(), body_st))
            story.append(Spacer(1, 3))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=4))
    story.append(Paragraph("Generated by CORE Platform AI  •  Data berbasis transaksi internal", meta_st))

    doc.build(story)
    pdf_bytes = buf.getvalue()

    filename = f"Laporan_Bulanan_{periode_label.replace('-', '_')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

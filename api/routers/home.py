from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel

from api.core.aegis_engine import get_store_crs
from api.core.data_loader import load_data
from api.core.insight_engine import (
    generate_home_insight,
    generate_monthly_report,
)
from api.core.report_data_collector import (
    collect_competitor_data,
    collect_performance_tracker_data,
    collect_program_promo_breakdown,
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


# ── AI Report: generate + PDF ─────────────────────────────────────────────────

_report_cache: dict[str, Any] = {}


@router.post("/report/generate")
def generate_report() -> dict:
    summary_resp = get_home_summary()
    summary_dict = summary_resp.data.model_dump()

    stores  = get_store_crs()
    warning = stores[stores["alert"] != "Normal"]

    # ── AEGIS ────────────────────────────────────────────────────────────────
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

    cad_pending  = int((stores.get("cad", stores.get("cad_count", None)) == 1).sum()) if "cad" in stores.columns else 0

    # ── Loyalty ───────────────────────────────────────────────────────────────
    loyalty_summary: dict = {}
    try:
        from api.routers.loyalty import get_summary as loyalty_get_summary  # type: ignore[import]
        lres = loyalty_get_summary()
        loyalty_summary = lres.get("data", {})
    except Exception:
        pass

    # ── Periode ───────────────────────────────────────────────────────────────
    df = load_data()
    latest_p = df["Tanggal Transaksi"].dt.to_period("M").max()
    periode  = str(latest_p)

    # ── New sections (competitor, promo, performance) ─────────────────────────
    competitor_data     = collect_competitor_data()
    program_promo_data  = collect_program_promo_breakdown()
    performance_data    = collect_performance_tracker_data()

    report_data = {
        "periode": periode,
        "summary": summary_dict,
        "aegis": {
            "total_warning":     int(len(warning)),
            "merah":             int((warning["alert"] == "Merah").sum()),
            "oranye":            int((warning["alert"] == "Oranye").sum()),
            "kuning":            int((warning["alert"] == "Kuning").sum()),
            "top_kabupaten":     top_kab,
            "distribusi_pola":   pola_dist,
            "cad_alert_pending": cad_pending,
        },
        "loyalty":             loyalty_summary,
        "competitor":          competitor_data,
        "program_promo":       program_promo_data,
        "performance_tracker": performance_data,
    }

    result = generate_monthly_report(report_data)

    # Cache for PDF generation — result already contains raw_data
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

    sections         = result.get("sections") or {}
    raw_data         = result.get("raw_data") or report_data
    periode_label    = raw_data.get("periode", periode or "N/A")
    summary          = raw_data.get("summary", {})
    aegis            = raw_data.get("aegis", {})
    loyalty          = raw_data.get("loyalty", {})
    competitor       = raw_data.get("competitor", {})
    program_promo    = raw_data.get("program_promo", {})
    perf_tracker     = raw_data.get("performance_tracker", {})

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
        ["Porsi Produk Murah (FBSI)", f"{summary.get('fighting_brand_share_pct', 0):.1f}%"],
        ["Volume Berisiko", f"{summary.get('volume_at_risk_pct', 0):.1f}% dari total"],
        ["CAD Alert Aktif", str(summary.get("cad_alert_count", 0))],
    ]
    kpi_tbl = Table(kpi_rows, colWidths=[9*cm, 7*cm])
    kpi_tbl.setStyle(_tbl_style(len(kpi_rows) - 1))
    story.append(kpi_tbl)
    story.append(Spacer(1, 8))

    # ── 3. AEGIS Analysis
    story.append(Paragraph("3. Analisis AEGIS & Early Warning", h2_st))
    for para in (sections.get("analisis_aegis") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    top_kab_list = aegis.get("top_kabupaten", [])
    if top_kab_list:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Top 5 Kabupaten Warning", caption_st))
        kab_rows = [["Kabupaten", "Jumlah Toko"]] + [
            [k["kabupaten"].replace("KABUPATEN ", "KAB. "), str(k["jumlah"])]
            for k in top_kab_list
        ]
        kab_tbl = Table(kab_rows, colWidths=[11*cm, 5*cm])
        kab_tbl.setStyle(_tbl_style(len(kab_rows) - 1))
        story.append(kab_tbl)
    story.append(Spacer(1, 8))

    # ── 4. Competitor Intelligence (BARU)
    story.append(Paragraph("4. Competitor Intelligence", h2_st))
    for para in (sections.get("analisis_competitor") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    tri_sum = competitor.get("triangulation_summary", {})
    if tri_sum:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Triangulasi per Provinsi (AEGIS × ASPERSSI)", caption_st))
        comp_rows = [
            ["Status", "Jumlah Provinsi"],
            ["Konfirmasi Kompetitor", str(tri_sum.get("konfirmasi_kompetitor", 0))],
            ["Waspada Awal", str(tri_sum.get("waspada_awal", 0))],
            ["Internal/Seasonal", str(tri_sum.get("internal_seasonal", 0))],
            ["Data Tidak Cukup", str(tri_sum.get("tidak_cukup_data", 0))],
        ]
        comp_tbl = Table(comp_rows, colWidths=[11*cm, 5*cm])
        comp_tbl.setStyle(_tbl_style(len(comp_rows) - 1))
        story.append(comp_tbl)
    top_komp = competitor.get("top_5_kompetitor_asperssi", [])
    if top_komp:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Top 5 Kompetitor ASPERSSI (market share)", caption_st))
        komp_rows = [["Brand", "Avg MS%", "Tren (pp)", "Arah"]] + [
            [r["brand"], f"{r['avg_ms_pct']:.1f}%",
             f"{r['avg_trend_pp']:+.2f}", r["trend_label"]]
            for r in top_komp
        ]
        komp_tbl = Table(komp_rows, colWidths=[7*cm, 3*cm, 3*cm, 3*cm])
        komp_tbl.setStyle(_tbl_style(len(komp_rows) - 1))
        story.append(komp_tbl)
    story.append(Spacer(1, 8))

    # ── 5. Program Loyalty
    story.append(Paragraph("5. Program Loyalty — Overview", h2_st))
    for para in (sections.get("analisis_loyalty") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    eff = loyalty.get("efektivitas_bulan_ini") or {}
    loy_rows = [
        ["Metrik", "Nilai"],
        ["Peserta Aktif", str(loyalty.get("total_aktif", "–"))],
        ["Efektivitas Program", f"{eff.get('efektivitas_pct', 0):.1f}%" if eff else "–"],
        ["Volume Achievement", f"{eff.get('volume_achievement_pct', 0):.1f}%" if eff else "–"],
        ["Estimasi Budget/Bulan", f"Rp {loyalty.get('est_budget_bulan', 0):,.0f}"],
    ]
    loy_tbl = Table(loy_rows, colWidths=[9*cm, 7*cm])
    loy_tbl.setStyle(_tbl_style(len(loy_rows) - 1))
    story.append(loy_tbl)
    story.append(Spacer(1, 8))

    # ── 6. Breakdown Program Promo per Tipe (BARU)
    story.append(Paragraph("6. Breakdown Program Promo per Tipe", h2_st))
    for para in (sections.get("breakdown_program_promo") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    if program_promo:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Ringkasan Program Promo Aktif", caption_st))
        def _rp(x: int) -> str:
            return f"Rp {x:,.0f}"
        promo_rows = [
            ["Tipe Program", "Aktif", "Peserta", "Est. Budget"],
            ["Flat Multiplier",
             str(program_promo.get("flat_multiplier", {}).get("jumlah_aktif", 0)),
             str(program_promo.get("flat_multiplier", {}).get("total_peserta", 0)),
             _rp(program_promo.get("flat_multiplier", {}).get("total_rupiah", 0))],
            ["Multi-Tier Target",
             str(program_promo.get("multi_tier", {}).get("jumlah_aktif", 0)),
             str(program_promo.get("multi_tier", {}).get("total_peserta", 0)),
             _rp(program_promo.get("multi_tier", {}).get("total_rupiah", 0))],
            ["Leaderboard/Gamifikasi",
             str(program_promo.get("leaderboard", {}).get("jumlah_aktif", 0)),
             str(program_promo.get("leaderboard", {}).get("total_peserta", 0)),
             _rp(program_promo.get("leaderboard", {}).get("total_rupiah", 0))],
        ]
        promo_tbl = Table(promo_rows, colWidths=[6*cm, 2.5*cm, 2.5*cm, 5*cm])
        promo_tbl.setStyle(_tbl_style(len(promo_rows) - 1))
        story.append(promo_tbl)
    story.append(Spacer(1, 8))

    # ── 7. Performance Tracker Outcome (BARU)
    story.append(Paragraph("7. Performance Tracker — Outcome Measurement", h2_st))
    for para in (sections.get("performance_outcome") or "–").split("\n\n"):
        story.append(Paragraph(para.strip().replace("\n", " "), body_st))
        story.append(Spacer(1, 5))

    vd = perf_tracker.get("verdict_distribution", {})
    if vd:
        story.append(Spacer(1, 6))
        story.append(Paragraph(
            f"Success Rate: {perf_tracker.get('success_rate_pct', 0):.1f}% "
            f"({vd.get('membaik', 0)} dari {perf_tracker.get('total_dipantau', 0)} toko dipantau)",
            caption_st,
        ))
        perf_rows = [
            ["Verdict", "Jumlah Toko"],
            ["Membaik",          str(vd.get("membaik", 0))],
            ["Stabil",           str(vd.get("stabil", 0))],
            ["Perlu Perhatian",  str(vd.get("perlu_perhatian", 0))],
            ["Dalam Pemantauan", str(vd.get("dalam_pemantauan", 0))],
        ]
        perf_tbl = Table(perf_rows, colWidths=[11*cm, 5*cm])
        perf_tbl.setStyle(_tbl_style(len(perf_rows) - 1))
        story.append(perf_tbl)
    story.append(Spacer(1, 8))

    # ── 8. Recommendations
    story.append(Paragraph("8. Rekomendasi Tindakan Prioritas", h2_st))
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

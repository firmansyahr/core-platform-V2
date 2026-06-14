"""
PDF report generator using ReportLab Platypus.
Produces professional A4 reports for AEGIS Monitor and ILP Optimizer.
"""
from __future__ import annotations

from io import BytesIO
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# ── Brand colours (consistent with frontend) ──────────────────────────────────
_DARK    = colors.HexColor("#0f172a")
_MUTED   = colors.HexColor("#64748b")
_BORDER  = colors.HexColor("#e2e8f0")
_ROW_ALT = colors.HexColor("#f8fafc")
_TH_BG   = colors.HexColor("#1e293b")
_RED     = colors.HexColor("#DC2626")
_ORANGE  = colors.HexColor("#EA580C")
_YELLOW  = colors.HexColor("#CA8A04")
_GREEN   = colors.HexColor("#16a34a")
_VIOLET  = colors.HexColor("#7c3aed")
_BLUE    = colors.HexColor("#2563eb")

PAGE_W, PAGE_H = A4
MARGIN_L = MARGIN_R = 2.0 * cm
MARGIN_T = MARGIN_B = 1.8 * cm

# ── Style helpers ─────────────────────────────────────────────────────────────

def _style(name: str, **kw) -> ParagraphStyle:
    base = ParagraphStyle(name)
    base.fontName    = "Helvetica"
    base.fontSize    = 10
    base.textColor   = _DARK
    base.spaceAfter  = 0
    base.spaceBefore = 0
    base.leading     = 14
    for k, v in kw.items():
        setattr(base, k, v)
    return base


def _tbl_style(
    data_rows: int,
    *,
    header_bg: colors.Color = _TH_BG,
    extra: list[tuple] | None = None,
) -> TableStyle:
    cmds: list[tuple] = [
        ("BACKGROUND",   (0, 0), (-1, 0),  header_bg),
        ("TEXTCOLOR",    (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",     (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0),  8),
        ("FONTSIZE",     (0, 1), (-1, -1), 7.5),
        ("ALIGN",        (0, 0), (-1, -1), "LEFT"),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",   (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ("LEFTPADDING",  (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("GRID",         (0, 0), (-1, -1), 0.4, _BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _ROW_ALT]),
    ]
    if extra:
        cmds.extend(extra)
    return TableStyle(cmds)


def _fmt_rp(n: float) -> str:
    """Format number as abbreviated Rupiah."""
    if n >= 1_000_000_000:
        return f"Rp {n / 1_000_000_000:,.2f} M"
    if n >= 1_000_000:
        return f"Rp {n / 1_000_000:,.1f} jt"
    return f"Rp {n:,.0f}"


def _fmt_int(n: float | int) -> str:
    return f"{int(round(n)):,}".replace(",", ".")


# ── Shared page decoration ────────────────────────────────────────────────────

def _make_page_decorator(report_type: str, report_date: str):
    def _decorator(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(_MUTED)
        canvas.drawString(MARGIN_L, 1.1 * cm, f"CORE Platform v2 · {report_type}")
        canvas.drawRightString(
            PAGE_W - MARGIN_R,
            1.1 * cm,
            f"{report_date}   ·   Halaman {doc.page}",
        )
        canvas.restoreState()
    return _decorator


# ─────────────────────────────────────────────────────────────────────────────
# 1. AEGIS Report
# ─────────────────────────────────────────────────────────────────────────────

POLA_META: dict[str, str] = {
    "A": "Pergeseran produk — FBSI↑ HE↓ ORS stabil",
    "B": "Tiga sinyal aktif — FBSI↑ HE↓ ORS↑ (Prioritas)",
    "C": "Pre-warning — ORS tidak stabil",
    "D": "Pemulihan — semua sinyal membaik",
}

STATUS_ORDER = {"KRITIS": 0, "MERAH": 1, "KUNING": 2}


def generate_aegis_report(store_crs_df: pd.DataFrame) -> bytes:
    """Build AEGIS Monitor PDF report. Returns raw PDF bytes."""
    buf = BytesIO()
    today = date.today().isoformat()
    now   = datetime.now(timezone.utc).strftime("%d %B %Y %H:%M UTC")

    dec = _make_page_decorator("AEGIS Monitor", today)
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN_L, rightMargin=MARGIN_R,
        topMargin=MARGIN_T,  bottomMargin=2.4 * cm,
    )

    # ── Styles ────────────────────────────────────────────────────────────────
    H1      = _style("H1",  fontSize=22, fontName="Helvetica-Bold", textColor=_DARK, spaceAfter=4)
    H2      = _style("H2",  fontSize=11, fontName="Helvetica-Bold", textColor=_RED, spaceBefore=14, spaceAfter=4)
    CAPTION = _style("CAP", fontSize=7.5, textColor=_MUTED)
    BODY    = _style("BOD", fontSize=9,   textColor=_DARK)
    SMALL   = _style("SM",  fontSize=7.5, textColor=_MUTED)

    story: list = []

    # ── Header block ──────────────────────────────────────────────────────────
    story.append(Paragraph("CORE PLATFORM", _style("LOG", fontSize=10, fontName="Helvetica-Bold", textColor=_MUTED, spaceAfter=2)))
    story.append(Paragraph("Laporan AEGIS Monitor", H1))
    story.append(Paragraph(f"Dibuat: {now}", SMALL))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1.5, color=_RED, spaceAfter=12))

    # ── Compute base stats ────────────────────────────────────────────────────
    warning = store_crs_df[store_crs_df["alert"] != "Normal"].copy()
    merah   = warning[warning["alert"] == "Merah"]
    oranye  = warning[warning["alert"] == "Oranye"]
    kuning  = warning[warning["alert"] == "Kuning"]

    total_vol    = float(store_crs_df["ton_latest"].fillna(0).sum())
    vol_at_risk  = float(warning["ton_latest"].fillna(0).sum())
    vol_pct      = round(vol_at_risk / total_vol * 100, 1) if total_vol > 0 else 0.0

    # CAD alerts
    kab_cad      = warning.groupby("Kabupaten Toko")["cad"].any()
    kab_has_merah = (
        merah.groupby("Kabupaten Toko")["ID Toko"].count().gt(0)
        .reindex(kab_cad.index, fill_value=False)
    )
    kab_count = warning.groupby("Kabupaten Toko")["ID Toko"].count()
    kab_score = warning.groupby("Kabupaten Toko")["aegis_score"].mean().round(1)
    kab_df = pd.DataFrame(
        {"has_cad": kab_cad, "has_merah": kab_has_merah,
         "jumlah_toko": kab_count, "score_rata": kab_score}
    )
    kab_df["status"] = "KUNING"
    kab_df.loc[kab_df["has_merah"], "status"] = "MERAH"
    kab_df.loc[kab_df["has_cad"],   "status"] = "KRITIS"
    kab_df["_ord"] = kab_df["status"].map(STATUS_ORDER).fillna(9)
    kab_df = kab_df.sort_values(["_ord", "jumlah_toko"], ascending=[True, False])
    cad_kritis = int(kab_df["has_cad"].sum())

    # Pola distribution
    pola_counts: dict[str, int] = {}
    churn_sums:  dict[str, float] = {}
    for _, row in warning.iterrows():
        pk = str(row.get("pola_kode") or "N")
        pola_counts[pk] = pola_counts.get(pk, 0) + 1
        churn_sums[pk]  = churn_sums.get(pk, 0.0) + float(row.get("churn_prob") or 0)
    dominant_pola = max(pola_counts, key=lambda k: pola_counts[k]) if pola_counts else "—"

    # ── Section 1 — Summary Eksekutif ────────────────────────────────────────
    story.append(Paragraph("1 — Summary Eksekutif", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    sum_data = [
        ["Metrik", "Nilai", "Detail"],
        ["Total Toko Warning", _fmt_int(len(warning)),
         f"Merah: {len(merah)}   Oranye: {len(oranye)}   Kuning: {len(kuning)}"],
        ["Volume at Risk", f"{_fmt_int(vol_at_risk)} TON",
         f"{vol_pct:.1f}% dari total volume ({_fmt_int(total_vol)} TON)"],
        ["CAD Alert Aktif", f"{cad_kritis} kabupaten",
         f"Total {len(kab_df)} kabupaten dengan warning stores"],
        ["Pola Dominan", f"Pola {dominant_pola}",
         POLA_META.get(dominant_pola, "—")],
    ]
    sum_tbl = Table(sum_data, colWidths=[4.5*cm, 4*cm, None])
    sum_tbl.setStyle(_tbl_style(len(sum_data) - 1))
    story.append(sum_tbl)
    story.append(Spacer(1, 4))

    # ── Section 2 — Top 10 Kabupaten CAD Alert ───────────────────────────────
    story.append(Paragraph("2 — Top 10 Kabupaten CAD Alert", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    cad_hdr = ["Kabupaten", "Status", "Jumlah Toko", "Score Rata-rata"]
    cad_rows = []
    for kab, row in kab_df.head(10).iterrows():
        cad_rows.append([
            str(kab),
            str(row["status"]),
            _fmt_int(row["jumlah_toko"]),
            f"{row['score_rata']:.1f}",
        ])
    cad_data = [cad_hdr] + cad_rows

    # Colour status cells
    extra: list[tuple] = [("ALIGN", (2, 0), (3, -1), "RIGHT")]
    for i, row in enumerate(cad_rows):
        c = {"KRITIS": _RED, "MERAH": _ORANGE, "KUNING": _YELLOW}.get(row[1])
        if c:
            extra.append(("TEXTCOLOR", (1, i + 1), (1, i + 1), c))
            extra.append(("FONTNAME",  (1, i + 1), (1, i + 1), "Helvetica-Bold"))

    cad_tbl = Table(cad_data, colWidths=[None, 2.5*cm, 3*cm, 3.5*cm])
    cad_tbl.setStyle(_tbl_style(len(cad_rows), extra=extra))
    story.append(cad_tbl)
    story.append(Spacer(1, 4))

    # ── Section 3 — Top 20 Toko Prioritas TSO ────────────────────────────────
    story.append(Paragraph("3 — Top 20 Toko Prioritas TSO", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    top20 = warning.nlargest(20, "aegis_score")
    toko_hdr = ["Nama Toko", "Kabupaten", "Cluster", "TSO", "Score", "Level", "Pola"]
    toko_rows = []
    for _, r in top20.iterrows():
        toko_rows.append([
            str(r.get("Nama Toko") or "")[:30],
            str(r.get("Kabupaten Toko") or "").replace("KABUPATEN ", "KAB. ")[:22],
            str(r.get("Cluster Pareto") or ""),
            str(r.get("TSO") or "").replace(r"TSO-\d+ ", "")[:18],
            f"{float(r.get('aegis_score') or 0):.1f}",
            str(r.get("alert") or ""),
            str(r.get("pola_kode") or "N"),
        ])
    toko_data = [toko_hdr] + toko_rows

    level_extra: list[tuple] = []
    for i, row in enumerate(toko_rows):
        c = {"Merah": _RED, "Oranye": _ORANGE, "Kuning": _YELLOW}.get(row[5])
        if c:
            level_extra.append(("TEXTCOLOR", (5, i + 1), (5, i + 1), c))
            level_extra.append(("FONTNAME",  (5, i + 1), (5, i + 1), "Helvetica-Bold"))

    toko_tbl = Table(
        toko_data,
        colWidths=[5.5*cm, 3.5*cm, 2.5*cm, 3*cm, 1.5*cm, 1.5*cm, 1.2*cm],
    )
    toko_tbl.setStyle(_tbl_style(len(toko_rows), extra=level_extra))
    story.append(toko_tbl)
    story.append(Spacer(1, 4))

    # ── Section 4 — Distribusi Pola ──────────────────────────────────────────
    story.append(Paragraph("4 — Distribusi Pola", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    pola_hdr = ["Kode", "Deskripsi Pola", "Jumlah Toko", "% dari Total", "Rata-rata Churn"]
    pola_rows = []
    total_w = len(warning)
    for kode in ["A", "B", "C", "D"]:
        cnt = pola_counts.get(kode, 0)
        avg_churn = (churn_sums.get(kode, 0) / cnt) if cnt > 0 else 0.0
        pola_rows.append([
            kode,
            POLA_META.get(kode, "—"),
            _fmt_int(cnt),
            f"{cnt / total_w * 100:.1f}%" if total_w > 0 else "—",
            f"{avg_churn:.3f}",
        ])
    pola_data = [pola_hdr] + pola_rows
    pola_tbl  = Table(pola_data, colWidths=[1.2*cm, None, 2.5*cm, 2.5*cm, 3*cm])
    pola_tbl.setStyle(_tbl_style(len(pola_rows), extra=[
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
    ]))
    story.append(pola_tbl)
    story.append(Spacer(1, 18))

    # ── Footer note ───────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=6))
    story.append(Paragraph(
        "⚠  Sistem Early Warning AEGIS — Validasi lapangan TSO diperlukan untuk konfirmasi kondisi aktual. "
        "Laporan ini bersifat informatif dan tidak menggantikan penilaian lapangan.",
        _style("FN", fontSize=7.5, textColor=_MUTED, leading=11),
    ))

    doc.build(story, onFirstPage=dec, onLaterPages=dec)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────────────
# 2. ILP Report
# ─────────────────────────────────────────────────────────────────────────────

_CLUSTER_COLORS: dict[str, colors.Color] = {
    "Super Platinum": colors.HexColor("#f59e0b"),
    "Platinum":       colors.HexColor("#8b5cf6"),
    "Gold":           colors.HexColor("#f97316"),
    "Silver":         colors.HexColor("#6b7280"),
    "Bronze":         colors.HexColor("#92400e"),
}

CLUSTERS_ORDER = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"]


def generate_ilp_report(hasil_ilp: list[dict], params: dict[str, Any]) -> bytes:
    """Build ILP Store Selection PDF report. Returns raw PDF bytes."""
    buf   = BytesIO()
    today = date.today().isoformat()
    now   = datetime.now(timezone.utc).strftime("%d %B %Y %H:%M UTC")

    dec = _make_page_decorator("ILP Store Selection", today)
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN_L, rightMargin=MARGIN_R,
        topMargin=MARGIN_T,  bottomMargin=2.4 * cm,
    )

    H1   = _style("IH1", fontSize=22, fontName="Helvetica-Bold", textColor=_DARK, spaceAfter=4)
    H2   = _style("IH2", fontSize=11, fontName="Helvetica-Bold", textColor=_VIOLET, spaceBefore=14, spaceAfter=4)
    SMALL = _style("ISM", fontSize=7.5, textColor=_MUTED)

    story: list = []

    # ── Header block ──────────────────────────────────────────────────────────
    story.append(Paragraph("CORE PLATFORM", _style("ILOG", fontSize=10, fontName="Helvetica-Bold", textColor=_MUTED, spaceAfter=2)))
    story.append(Paragraph("Laporan ILP Store Selection", H1))
    story.append(Paragraph(f"Dibuat: {now}", SMALL))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1.5, color=_VIOLET, spaceAfter=12))

    # ── Compute stats ─────────────────────────────────────────────────────────
    budget_maks = float(params.get("budget_maks") or 0)
    maks_toko   = int(params.get("maks_toko") or 0)
    w_ratio     = float(params.get("weight_ratio_cluster") or 0)
    w_trx       = float(params.get("weight_avg_trx") or 0)
    w_growth    = float(params.get("weight_growth") or 0)

    total_toko   = len(hasil_ilp)
    total_cost   = sum(float(r.get("estimated_cost") or 0) for r in hasil_ilp)
    avg_score    = (sum(float(r.get("score") or 0) for r in hasil_ilp) / total_toko
                   ) if total_toko else 0.0
    util_pct     = (total_cost / budget_maks * 100) if budget_maks > 0 else 0.0

    # Cluster distribution
    cluster_counts: dict[str, int]   = {}
    cluster_costs:  dict[str, float] = {}
    for r in hasil_ilp:
        c = str(r.get("cluster_pareto") or "Unknown")
        cluster_counts[c] = cluster_counts.get(c, 0) + 1
        cluster_costs[c]  = cluster_costs.get(c, 0.0) + float(r.get("estimated_cost") or 0)

    # ── Section 1 — Parameter Optimasi ───────────────────────────────────────
    story.append(Paragraph("1 — Parameter Optimasi", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    param_data = [
        ["Parameter", "Nilai"],
        ["Budget Maks",         _fmt_rp(budget_maks)],
        ["Maks Toko",           _fmt_int(maks_toko)],
        ["Bobot Ratio vs Cluster", f"{w_ratio*100:.0f}%"],
        ["Bobot Avg Transaksi",    f"{w_trx*100:.0f}%"],
        ["Bobot Growth Trend",     f"{w_growth*100:.0f}%"],
    ]
    param_tbl = Table(param_data, colWidths=[7*cm, None])
    param_tbl.setStyle(_tbl_style(len(param_data) - 1, header_bg=colors.HexColor("#4c1d95")))
    story.append(param_tbl)
    story.append(Spacer(1, 4))

    # ── Section 2 — Summary Hasil ────────────────────────────────────────────
    story.append(Paragraph("2 — Summary Hasil Optimasi", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    res_data = [
        ["Metrik", "Nilai"],
        ["Toko Terpilih",    _fmt_int(total_toko)],
        ["Total Cost",        _fmt_rp(total_cost)],
        ["Utilisasi Budget",  f"{util_pct:.1f}%"],
        ["Rata-rata Score",   f"{avg_score:.2f}"],
    ]
    res_tbl = Table(res_data, colWidths=[7*cm, None])
    res_tbl.setStyle(_tbl_style(len(res_data) - 1, header_bg=colors.HexColor("#4c1d95")))
    story.append(res_tbl)
    story.append(Spacer(1, 4))

    # ── Section 3 — Distribusi per Cluster ───────────────────────────────────
    story.append(Paragraph("3 — Distribusi per Cluster", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    clus_hdr  = ["Cluster", "Jumlah", "%", "Total Cost (Rp)", "Rata Cost / Toko"]
    clus_rows = []
    for c in CLUSTERS_ORDER:
        cnt  = cluster_counts.get(c, 0)
        cost = cluster_costs.get(c, 0.0)
        avg_c = cost / cnt if cnt else 0.0
        clus_rows.append([
            c,
            _fmt_int(cnt),
            f"{cnt / total_toko * 100:.1f}%" if total_toko else "—",
            _fmt_rp(cost),
            _fmt_rp(avg_c),
        ])
    clus_data = [clus_hdr] + clus_rows

    clus_extra: list[tuple] = [("ALIGN", (1, 0), (-1, -1), "RIGHT")]
    for i, row in enumerate(clus_rows):
        c_col = _CLUSTER_COLORS.get(row[0])
        if c_col:
            clus_extra.append(("TEXTCOLOR", (0, i + 1), (0, i + 1), c_col))
            clus_extra.append(("FONTNAME",  (0, i + 1), (0, i + 1), "Helvetica-Bold"))

    clus_tbl = Table(clus_data, colWidths=[3.5*cm, 2*cm, 1.8*cm, 4*cm, 4*cm])
    clus_tbl.setStyle(_tbl_style(len(clus_rows), extra=clus_extra, header_bg=colors.HexColor("#4c1d95")))
    story.append(clus_tbl)
    story.append(Spacer(1, 4))

    # ── Section 4 — Top 30 Toko Terpilih ────────────────────────────────────
    story.append(Paragraph("4 — Top 30 Toko Terpilih", H2))
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=8))

    top30 = sorted(hasil_ilp, key=lambda r: float(r.get("score") or 0), reverse=True)[:30]
    toko_hdr  = ["#", "Nama Toko", "Kabupaten", "Cluster", "Avg TON", "Score", "Est. Cost"]
    toko_rows_ilp = []
    for i, r in enumerate(top30, 1):
        toko_rows_ilp.append([
            str(i),
            str(r.get("nama_toko") or "")[:28],
            str(r.get("kabupaten") or "").replace("KABUPATEN ", "KAB. ")[:22],
            str(r.get("cluster_pareto") or ""),
            _fmt_int(float(r.get("avg_ton") or 0)),
            f"{float(r.get('score') or 0):.1f}",
            _fmt_rp(float(r.get("estimated_cost") or 0)),
        ])
    toko_data_ilp = [toko_hdr] + toko_rows_ilp

    ilp_toko_extra: list[tuple] = [
        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
        ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
    ]
    for i, row in enumerate(toko_rows_ilp):
        c_col = _CLUSTER_COLORS.get(row[3])
        if c_col:
            ilp_toko_extra.append(("TEXTCOLOR", (3, i + 1), (3, i + 1), c_col))

    toko_tbl_ilp = Table(
        toko_data_ilp,
        colWidths=[0.8*cm, 5*cm, 3.5*cm, 2.8*cm, 2*cm, 1.5*cm, 3*cm],
    )
    toko_tbl_ilp.setStyle(_tbl_style(
        len(toko_rows_ilp), extra=ilp_toko_extra, header_bg=colors.HexColor("#4c1d95")
    ))
    story.append(toko_tbl_ilp)
    story.append(Spacer(1, 18))

    # ── Footer note ───────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=_BORDER, spaceAfter=6))
    story.append(Paragraph(
        "ILP Optimizer · CORE Platform v2.0 · "
        "Hasil optimasi berdasarkan data transaksi sintetis. "
        "Keputusan final memerlukan pertimbangan bisnis tambahan.",
        _style("IFN", fontSize=7.5, textColor=_MUTED, leading=11),
    ))

    doc.build(story, onFirstPage=dec, onLaterPages=dec)
    return buf.getvalue()

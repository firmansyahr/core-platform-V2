import streamlit as st

_CSS = """
/* ── Google Fonts ─────────────────────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* ── Base ─────────────────────────────────────────────────────────────────── */
html, body, [class*="css"] {
    font-family: 'Inter', sans-serif !important;
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
[data-testid="stSidebar"] {
    background: #0F1923 !important;
    border-right: 1px solid rgba(255,255,255,0.07);
}
[data-testid="stSidebar"] * {
    color: rgba(255,255,255,0.85) !important;
}
[data-testid="stSidebar"] h1,
[data-testid="stSidebar"] h2,
[data-testid="stSidebar"] h3,
[data-testid="stSidebar"] .stMarkdown strong {
    color: #ffffff !important;
    font-weight: 600;
}
/* Sidebar header label */
[data-testid="stSidebar"] [data-testid="stMarkdownContainer"] p {
    color: rgba(255,255,255,0.75) !important;
    font-size: 13px;
}
/* Sidebar CORE logo block */
.core-sidebar-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0 14px 0;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    margin-bottom: 12px;
}
.core-sidebar-logo .brand {
    font-size: 18px;
    font-weight: 700;
    color: #60A5FA !important;
    letter-spacing: -0.3px;
}
.core-sidebar-logo .sub {
    font-size: 10px;
    color: rgba(255,255,255,0.45) !important;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 1px;
}
/* Sidebar expander */
[data-testid="stSidebar"] [data-testid="stExpander"] {
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 8px !important;
    background: rgba(255,255,255,0.03) !important;
    margin-bottom: 6px;
}
[data-testid="stSidebar"] [data-testid="stExpander"] summary {
    color: rgba(255,255,255,0.9) !important;
    font-weight: 500;
    font-size: 13px;
}
/* Sidebar input widgets */
[data-testid="stSidebar"] input,
[data-testid="stSidebar"] [data-baseweb="select"] {
    background: rgba(255,255,255,0.07) !important;
    border-color: rgba(255,255,255,0.15) !important;
    color: white !important;
    border-radius: 6px !important;
}
[data-testid="stSidebar"] [data-baseweb="tag"] {
    background: rgba(37,99,235,0.4) !important;
}
/* Sidebar slider */
[data-testid="stSidebar"] [data-testid="stSlider"] [data-testid="stThumbValue"] {
    color: #60A5FA !important;
}
[data-testid="stSidebar"] [data-testid="stSlider"] [role="slider"] {
    background: #2563EB !important;
}
/* Sidebar button */
[data-testid="stSidebar"] .stButton > button[kind="primary"] {
    background: #2563EB !important;
    border: none !important;
    color: white !important;
    font-weight: 600;
    border-radius: 8px !important;
    font-size: 14px;
    letter-spacing: 0.3px;
    box-shadow: 0 2px 8px rgba(37,99,235,0.35);
    transition: all 0.2s;
}
[data-testid="stSidebar"] .stButton > button[kind="primary"]:hover {
    background: #1D4ED8 !important;
    box-shadow: 0 4px 12px rgba(37,99,235,0.45);
}
/* Sidebar caption */
[data-testid="stSidebar"] [data-testid="stCaptionContainer"] p {
    color: rgba(255,255,255,0.55) !important;
    font-size: 12px;
}
/* Sidebar hr */
[data-testid="stSidebar"] hr {
    border-color: rgba(255,255,255,0.1) !important;
}

/* ── Main area ────────────────────────────────────────────────────────────── */
[data-testid="stAppViewContainer"] > section:nth-child(2) {
    background: #FFFFFF;
}

/* ── KPI Metric cards ─────────────────────────────────────────────────────── */
[data-testid="stMetric"] {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 12px;
    padding: 18px 22px 16px !important;
    box-shadow: 0 1px 4px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04);
    transition: box-shadow 0.2s;
}
[data-testid="stMetric"]:hover {
    box-shadow: 0 2px 8px rgba(15,23,42,0.1), 0 6px 20px rgba(15,23,42,0.06);
}
[data-testid="stMetricLabel"] {
    font-size: 12px !important;
    font-weight: 600 !important;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #64748B !important;
}
[data-testid="stMetricValue"] {
    font-size: 26px !important;
    font-weight: 700 !important;
    color: #0F172A !important;
    letter-spacing: -0.5px;
}
[data-testid="stMetricDelta"] {
    font-size: 12px !important;
    font-weight: 500 !important;
}

/* ── Dataframe / Table ────────────────────────────────────────────────────── */
[data-testid="stDataFrame"] {
    border-radius: 10px !important;
    overflow: hidden;
    border: 1px solid #E2E8F0 !important;
    box-shadow: 0 1px 4px rgba(15,23,42,0.05);
}
/* Alternating rows handled by Styler in Python */

/* ── Warning badges (AEGIS) ───────────────────────────────────────────────── */
.badge-merah {
    display: inline-block;
    background: #DC2626;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 20px;
    letter-spacing: 0.5px;
    vertical-align: middle;
}
.badge-oranye {
    display: inline-block;
    background: #EA580C;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 20px;
    letter-spacing: 0.5px;
    vertical-align: middle;
}
.badge-kuning {
    display: inline-block;
    background: #CA8A04;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 20px;
    letter-spacing: 0.5px;
    vertical-align: middle;
}
.badge-kritis {
    display: inline-block;
    background: #7F1D1D;
    color: #FCA5A5;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 20px;
    letter-spacing: 0.5px;
    vertical-align: middle;
}

/* ── Top nav bar ──────────────────────────────────────────────────────────── */
.core-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #0F1923;
    border-radius: 10px;
    padding: 10px 20px;
    margin-bottom: 14px;
    border: 1px solid rgba(255,255,255,0.07);
}
.core-nav-brand {
    font-size: 17px;
    font-weight: 700;
    color: #60A5FA !important;
    text-decoration: none;
    letter-spacing: -0.3px;
}
.core-nav-links { display: flex; gap: 4px; }
.core-nav-links a {
    padding: 5px 13px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    color: rgba(255,255,255,0.72) !important;
    transition: all 0.15s ease;
}
.core-nav-links a:hover { background: rgba(96,165,250,0.15); color: #93C5FD !important; }
.nav-active { background: rgba(37,99,235,0.25) !important; color: #93C5FD !important; }

/* ── Divider ──────────────────────────────────────────────────────────────── */
hr { border-color: #E2E8F0 !important; }

/* ── Headings in main area ────────────────────────────────────────────────── */
h1 { font-weight: 700 !important; color: #0F172A !important; letter-spacing: -0.5px; }
h2, h3 { font-weight: 700 !important; color: #1E293B !important; }
h4, h5 { font-weight: 600 !important; color: #334155 !important; }

/* ── Info / warning boxes ─────────────────────────────────────────────────── */
[data-testid="stAlert"] {
    border-radius: 10px !important;
    border-width: 1px !important;
}

/* ── Download button ──────────────────────────────────────────────────────── */
[data-testid="stDownloadButton"] > button {
    border-radius: 8px !important;
    font-weight: 500 !important;
    border-color: #2563EB !important;
    color: #2563EB !important;
}
[data-testid="stDownloadButton"] > button:hover {
    background: #EFF6FF !important;
}

/* ── Spinner ──────────────────────────────────────────────────────────────── */
[data-testid="stSpinner"] { color: #2563EB !important; }
"""

_NAV_TEMPLATE = """
<div class="core-nav">
  <a class="core-nav-brand" href="/">🎯 CORE Platform</a>
  <div class="core-nav-links">
    <a href="/" class="{cls_home}">🏠 Home</a>
    <a href="/1_AEGIS" class="{cls_aegis}">🛡️ AEGIS</a>
    <a href="/2_ILP" class="{cls_ilp}">🏆 ILP</a>
  </div>
</div>
"""

_SIDEBAR_LOGO = """
<div class="core-sidebar-logo">
  <div>
    <div class="brand">🎯 CORE</div>
    <div class="sub">Commercial Optimization & Retention Engine</div>
  </div>
</div>
"""


def inject_css() -> None:
    """Inject shared CSS into any Streamlit page."""
    st.markdown(f"<style>{_CSS}</style>", unsafe_allow_html=True)


def render_nav(active: str = "home") -> None:
    """Render top navigation bar. active: 'home' | 'aegis' | 'ilp'"""
    st.markdown(
        _NAV_TEMPLATE.format(
            cls_home  = "nav-active" if active == "home"  else "",
            cls_aegis = "nav-active" if active == "aegis" else "",
            cls_ilp   = "nav-active" if active == "ilp"   else "",
        ),
        unsafe_allow_html=True,
    )


def render_sidebar_logo() -> None:
    """Render CORE brand block at top of sidebar."""
    st.sidebar.markdown(_SIDEBAR_LOGO, unsafe_allow_html=True)

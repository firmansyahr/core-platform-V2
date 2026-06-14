# STATUS CORE Platform v2 — Last updated Jun 2026

## SELESAI ✅
- FastAPI backend: /api/home/summary, /api/aegis/warnings, /api/aegis/cad-alert, /api/aegis/top-stores, /api/ilp/run, /api/settings
- Next.js frontend: Home Dashboard, AEGIS Monitor, ILP Optimizer, Settings
- Dark mode toggle di navbar
- Multi-criteria scoring ILP (Ratio/Trx/Growth slider)
- Constraint cluster per tier (SP/Platinum/Gold/Silver/Bronze)
- Filter Wilayah & Organisasi (SSM→ASM→TSO hierarchical)
- Distribusi pola A/B/C/D fix (pakai pola_kode)

## BELUM SELESAI ⏳
- Login page + JWT auth + protected routes
- About/Portfolio page
- AEGIS engine: Isolation Forest + XGBoost (POC gap)
- Volume at risk metric

## LANGKAH BERIKUTNYA
Tahap 4 — Login system (JWT + protected routes)

# STATUS CORE Platform v2 — Jun 2026

## SELESAI ✅
- FastAPI: semua endpoint + auth JWT + settings + reload cache
- Home Dashboard: KPI, Warning, Top TSO, tren chart, volume at risk
- AEGIS Monitor: filter, insight cards, CAD Alert chart, distribusi pola, tabel + churn_prob + if_label
- ILP Optimizer: multi-criteria scoring, constraint cluster, filter SSM→ASM→TSO
- Settings, About, Login page
- Dark mode
- AEGIS engine: CRS + Isolation Forest + XGBoost sesuai POC (W=0.50/0.20/0.30)
- Volume at risk metric

## LANGKAH TERSISA (urutan)
1. Polish UI — responsive mobile, spacing, typography konsisten
2. Deploy — Railway (FastAPI) + Vercel (Next.js) + Neon (PostgreSQL) + domain
3. Looker Studio + Power BI integrasi

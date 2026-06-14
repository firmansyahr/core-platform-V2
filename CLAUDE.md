# CORE Platform v2 — Claude CLI Context
FastAPI backend + Next.js frontend. Portfolio project analitik pasar semen kantong.

## Stack
- Backend : FastAPI + Uvicorn (Python 3.12)
- Frontend: Next.js 14 + TypeScript + Tailwind + shadcn/ui + Recharts
- Data    : data/transaksi_aegis_synthetic.parquet (2.148.655 baris, 36 kolom)

## Struktur folder
api/main.py          - FastAPI entry point, CORS, router include
api/routers/home.py  - GET /api/home/summary
api/routers/aegis.py - GET /api/aegis/warnings, /api/aegis/cad-alert
api/routers/ilp.py   - POST /api/ilp/run
api/core/data_loader.py - load_data() baca parquet
api/core/aegis_engine.py - compute_store_crs()
api/core/ilp_engine.py   - run_ilp_solver()
frontend/            - Next.js project
data/                - transaksi_aegis_synthetic.parquet

## Brand sintetis
Main Brand    : SEMEN ELANG (reward Rp 5.000/ton)
Companion     : SEMEN BADAK hanya SERBAGUNA (reward Rp 2.500/ton)
Fighting Brand: SEMEN BANTENG (AEGIS only, tidak masuk ILP)

## AEGIS config
fighting_brand: SEMEN BANTENG, main_brand: SEMEN ELANG
fbsi_window: 8, fbsi_threshold: 15.0
he_window: 8, he_threshold: -8.0
crs_kuning: 40, crs_oranye: 65, crs_merah: 85

## API response format
{ "status": "ok", "data": {...}, "meta": {"generated_at": "..."} }

## Aturan kode
- FastAPI: typing lengkap, Pydantic model untuk response
- Engine: copy logic dari src/ v1, jangan import langsung
- Next.js: App Router, Client Component hanya jika perlu interaktif
- Tailwind only, angka Rp format Intl.NumberFormat id-ID

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from api.core.limiter import limiter
from api.routers import action_center, aegis, auth, brand_config, cad_history, cannibalization, causal, competitor, export, health, home, ilp, loyalty, oracle, oracle_agent, performance, predictions, promo, settings

# Tanpa basicConfig, semua logging.getLogger(__name__).info/.warning di modul
# lain (oracle_guard injection warning, oracle_scheduler job status, token
# usage tracking) DIAM-DIAM tidak pernah keluar — root logger default WARNING
# tanpa handler. Ditemukan saat verifikasi token usage logging (LANGKAH 4
# smart routing) tidak muncul di log padahal kode-nya jalan.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s")
logger = logging.getLogger(__name__)


def _seed_brand_config_global(db) -> None:
    from api.models import BrandConfig
    try:
        row = db.query(BrandConfig).filter(
            BrandConfig.provinsi.is_(None),
            BrandConfig.kabupaten.is_(None),
        ).first()
        if row and not row.fb_brands:
            row.fb_brands = ["SEMEN BANTENG"]
            db.commit()
            logger.info("BrandConfig global: fb_brands seeded")
        elif not row:
            db.add(BrandConfig(
                mb_brands=["SEMEN ELANG"],
                cb_brands=["SEMEN BADAK"],
                fb_brands=["SEMEN BANTENG"],
            ))
            db.commit()
            logger.info("BrandConfig global: row created")
    except Exception as exc:
        logger.warning("BrandConfig seed error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from api.startup import ensure_data_files
    ensure_data_files()
    from api.database import init_db, SessionLocal
    init_db()
    _db = SessionLocal()
    try:
        _seed_brand_config_global(_db)
    finally:
        _db.close()
    print("[startup] Pre-loading data ke memory...", flush=True)
    from api.core.data_loader import preload_data
    preload_data()
    print("[startup] Data siap, server ready", flush=True)

    from api.core.oracle_scheduler import shutdown_scheduler, start_scheduler
    start_scheduler()

    yield

    shutdown_scheduler()


app = FastAPI(title="CORE Platform v2", version="2.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_frontend_url = os.getenv("FRONTEND_URL", "")
_origins = [
    "http://localhost:3000",
    "https://core-platform.vercel.app",
    *([_frontend_url] if _frontend_url else []),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(health.router)
app.include_router(home.router)
app.include_router(aegis.router)
app.include_router(cad_history.router)
app.include_router(export.router)
app.include_router(ilp.router)
app.include_router(settings.router)
app.include_router(loyalty.router)
app.include_router(brand_config.router)
app.include_router(promo.router)
app.include_router(performance.router)
app.include_router(competitor.router)
app.include_router(cannibalization.router)
app.include_router(causal.router)
app.include_router(oracle.router)
app.include_router(oracle_agent.router, prefix="/api/oracle/agent", tags=["oracle-agent"])
app.include_router(predictions.router, prefix="/api/predictions", tags=["predictions"])
app.include_router(action_center.router)

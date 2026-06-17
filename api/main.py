import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from api.core.limiter import limiter
from api.routers import aegis, auth, cad_history, export, health, home, ilp, loyalty, performance, promo, settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    from api.startup import ensure_data_files
    ensure_data_files()
    print("[startup] Pre-loading data ke memory...", flush=True)
    from api.core.data_loader import preload_data
    preload_data()
    print("[startup] Data siap, server ready", flush=True)
    yield


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
app.include_router(promo.router)
app.include_router(performance.router)

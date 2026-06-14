import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from api.core.limiter import limiter
from api.routers import aegis, auth, cad_history, export, health, home, ilp, loyalty, performance, promo, settings

app = FastAPI(title="CORE Platform v2", version="2.0.0")

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


@app.on_event("startup")
async def _startup() -> None:
    """Pre-warm expensive caches in background threads so first API calls are fast."""
    import asyncio
    from api.core.cad_storage import initialize_cad_history
    from api.core.aegis_engine import get_store_crs
    from api.core.ilp_engine import get_ilp_features
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, initialize_cad_history)
    loop.run_in_executor(None, get_store_crs)    # warms load_data + compute_store_crs
    loop.run_in_executor(None, get_ilp_features)  # warms compute_ilp_features

import json
import os

from fastapi import APIRouter, Depends, HTTPException

from api.core.aegis_engine import get_store_crs
from api.core.auth import get_current_user
from api.core.data_loader import load_data
from api.core.performance_engine import get_performance_overview, get_store_journey

router = APIRouter(prefix="/api/performance", tags=["performance"])

LOYALTY_MEMBERS_PATH = "api/data/loyalty_members.json"


def _load_loyalty_members() -> list[dict]:
    if os.path.exists(LOYALTY_MEMBERS_PATH):
        with open(LOYALTY_MEMBERS_PATH) as f:
            return json.load(f)
    return []


@router.get("/overview")
async def performance_overview(user=Depends(get_current_user)):
    df      = load_data()
    crs     = get_store_crs()
    members = _load_loyalty_members()
    result  = get_performance_overview(df, crs, members)
    return {"status": "ok", "data": result}


@router.get("/store/{id_toko}")
async def store_performance(id_toko: str, user=Depends(get_current_user)):
    df      = load_data()
    crs     = get_store_crs()
    members = _load_loyalty_members()
    result  = get_store_journey(df, crs, members, id_toko)
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail=f"Store '{id_toko}' not found")
    return {"status": "ok", "data": result}

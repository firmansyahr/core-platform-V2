from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from api.core.auth import UserInfo, get_current_admin_user
from api.core.limiter import limiter
from api.core.ilp_engine import (
    W_GROWTH_DEFAULT,
    W_RATIO_DEFAULT,
    W_TRX_DEFAULT,
    apply_ilp_scoring,
    get_ilp_features,
    get_ilp_hierarchy,
    solve_ilp,
)

router = APIRouter(prefix="/api/ilp", tags=["ilp"])


class ClusterConstraints(BaseModel):
    super_platinum: float = Field(default=0.0, ge=0.0, le=100.0)
    platinum:       float = Field(default=0.0, ge=0.0, le=100.0)
    gold:           float = Field(default=0.0, ge=0.0, le=100.0)
    silver:         float = Field(default=0.0, ge=0.0, le=100.0)
    bronze:         float = Field(default=0.0, ge=0.0, le=100.0)

    def to_dict(self) -> dict[str, float]:
        return {
            "Super Platinum": self.super_platinum,
            "Platinum":       self.platinum,
            "Gold":           self.gold,
            "Silver":         self.silver,
            "Bronze":         self.bronze,
        }


class ILPRequest(BaseModel):
    budget_maks:          float = Field(gt=0)
    maks_toko:            int   = Field(gt=0)
    cluster_constraints:  ClusterConstraints = Field(default_factory=ClusterConstraints)
    provinsi_filter:      list[str] = Field(default_factory=list)
    ssm_filter:           list[str] = Field(default_factory=list)
    asm_filter:           list[str] = Field(default_factory=list)
    tso_filter:           list[str] = Field(default_factory=list)
    weight_ratio_cluster: float = Field(default=W_RATIO_DEFAULT,  ge=0.0, le=1.0)
    weight_avg_trx:       float = Field(default=W_TRX_DEFAULT,    ge=0.0, le=1.0)
    weight_growth:        float = Field(default=W_GROWTH_DEFAULT,  ge=0.0, le=1.0)


class SelectedStore(BaseModel):
    id_toko:        str
    nama_toko:      str
    kabupaten:      str
    provinsi:       str
    cluster_pareto: str
    ssm:            str
    asm:            str
    tso:            str
    score:          float
    estimated_cost: float
    brand_category: str
    avg_ton:        float
    ton_growth:     float
    efficiency:     float   # score per juta rupiah
    ratio_score:    float   # MinMax-normalized ratio_vs_cluster (0–100)
    trx_score:      float   # MinMax-normalized avg_trx (0–100)
    growth_score:   float   # MinMax-normalized ton_growth (0–100)


class ILPResponse(BaseModel):
    status: str
    data:   list[SelectedStore]
    meta:   dict[str, Any]


class HierarchyResponse(BaseModel):
    status: str
    data:   dict[str, Any]
    meta:   dict[str, str]


@router.get("/metadata", response_model=HierarchyResponse)
def get_metadata() -> HierarchyResponse:
    hier = get_ilp_hierarchy()
    return HierarchyResponse(
        status="ok",
        data=hier,
        meta={"generated_at": datetime.now(timezone.utc).isoformat()},
    )


@router.post("/run", response_model=ILPResponse)
@limiter.limit("10/minute")
def run_ilp(
    request: Request,
    req: ILPRequest,
    _user: UserInfo = Depends(get_current_admin_user),
) -> ILPResponse:
    # Feature computation is cached; scoring is applied per-request with user weights
    features_df = get_ilp_features()
    scored_df = apply_ilp_scoring(
        features_df,
        weight_ratio=req.weight_ratio_cluster,
        weight_trx=req.weight_avg_trx,
        weight_growth=req.weight_growth,
    )

    selected, method = solve_ilp(
        scored_df,
        budget=req.budget_maks,
        n_max=req.maks_toko,
        cluster_max_pct=req.cluster_constraints.to_dict(),
        provinsi_filter=req.provinsi_filter or None,
        ssm_filter=req.ssm_filter or None,
        asm_filter=req.asm_filter or None,
        tso_filter=req.tso_filter or None,
    )

    data: list[SelectedStore] = []
    for _, row in selected.iterrows():
        cost  = float(row["estimated_cost"])
        score = round(float(row["score"]), 4)
        data.append(
            SelectedStore(
                id_toko=str(row["ID Toko"]),
                nama_toko=str(row.get("Nama Toko") or ""),
                kabupaten=str(row.get("Kabupaten Toko") or ""),
                provinsi=str(row.get("Provinsi Toko") or ""),
                cluster_pareto=str(row.get("Cluster Pareto") or ""),
                ssm=str(row.get("SSM") or ""),
                asm=str(row.get("ASM") or ""),
                tso=str(row.get("TSO") or ""),
                score=score,
                estimated_cost=round(cost, 0),
                brand_category=str(row.get("brand_category") or ""),
                avg_ton=round(float(row["avg_ton"]), 2),
                ton_growth=round(float(row["ton_growth"]), 2),
                efficiency=round(score / (cost / 1_000_000), 4) if cost > 0 else 0.0,
                ratio_score=round(float(row["ratio_score"]), 2),
                trx_score=round(float(row["trx_score"]), 2),
                growth_score=round(float(row["growth_score"]), 2),
            )
        )

    total_cost = sum(s.estimated_cost for s in data)

    return ILPResponse(
        status="ok",
        data=data,
        meta={
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "method": method,
            "total_toko": len(data),
            "total_cost": total_cost,
            "budget_utilization_pct": (
                round(total_cost / req.budget_maks * 100, 2) if req.budget_maks > 0 else 0.0
            ),
            "weights": {
                "ratio_cluster": req.weight_ratio_cluster,
                "avg_trx":       req.weight_avg_trx,
                "growth":        req.weight_growth,
            },
        },
    )

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from api.core.auth import UserInfo, get_current_admin_user
from api.core.limiter import limiter
from api.core.ilp_engine import (
    W_GROWTH_DEFAULT,
    W_RATIO_DEFAULT,
    W_TRX_DEFAULT,
    apply_cannibalization_adjustment,
    apply_competitor_adjustment,
    apply_ilp_scoring,
    get_ilp_features,
    get_ilp_hierarchy,
    load_cannibalization_results,
    load_competitor_triangulation,
    solve_ilp,
)

router = APIRouter(prefix="/api/ilp", tags=["ilp"])


def _safe_str(v: Any) -> str | None:
    """pandas .map()/.where() can leave missing values as float NaN instead
    of None depending on column dtype — Pydantic rejects NaN for str | None,
    so normalize explicitly at this DataFrame→API boundary."""
    return v if pd.notna(v) else None

_MEMBERS_PATH = Path(__file__).parent.parent / "data" / "loyalty_members.json"


def _read_active_loyalty_ids() -> set[str]:
    if not _MEMBERS_PATH.exists():
        return set()
    with open(_MEMBERS_PATH, encoding="utf-8") as f:
        members: list[dict] = json.load(f)
    return {str(m["id_toko"]) for m in members if m.get("status") == "Aktif"}


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
    budget_maks:               float = Field(gt=0)
    maks_toko:                 int   = Field(gt=0)
    cluster_constraints:       ClusterConstraints = Field(default_factory=ClusterConstraints)
    provinsi_filter:           list[str] = Field(default_factory=list)
    ssm_filter:                list[str] = Field(default_factory=list)
    asm_filter:                list[str] = Field(default_factory=list)
    tso_filter:                list[str] = Field(default_factory=list)
    weight_ratio_cluster:           float = Field(default=W_RATIO_DEFAULT,  ge=0.0, le=1.0)
    weight_avg_trx:                 float = Field(default=W_TRX_DEFAULT,    ge=0.0, le=1.0)
    weight_growth:                  float = Field(default=W_GROWTH_DEFAULT,  ge=0.0, le=1.0)
    exclude_existing_loyalty:       bool  = False
    use_cannibalization_adjustment: bool  = True
    use_competitor_adjustment:      bool  = True


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
    score_adjusted: float
    estimated_cost: float
    brand_category: str
    avg_ton:        float
    ton_growth:     float
    efficiency:     float         # score_adjusted per juta rupiah
    ratio_score:    float         # MinMax-normalized ratio_vs_cluster (0–100)
    trx_score:      float         # MinMax-normalized avg_trx (0–100)
    growth_score:   float         # MinMax-normalized ton_growth (0–100)
    adjustment_factor:           float        = 1.0
    cannibalization_category:    str | None   = None
    cannibalization_label:       str | None   = None
    score_final:                 float        = 0.0
    combined_adjustment_factor:  float        = 1.0
    competitor_verdict:          str | None   = None
    competitor_top_brand:        str | None   = None
    sinyal_bertentangan:         bool         = False
    conflict_note:               str | None   = None


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

    toko_dikecualikan = 0
    total_kandidat = len(scored_df)
    if req.exclude_existing_loyalty:
        active_ids = _read_active_loyalty_ids()
        before = len(scored_df)
        scored_df = scored_df[~scored_df["ID Toko"].isin(active_ids)].copy()
        toko_dikecualikan = before - len(scored_df)
        total_kandidat = len(scored_df)
        print(
            f"[ILP] Exclude existing loyalty: {before} → {total_kandidat} kandidat "
            f"({toko_dikecualikan} toko di-exclude)"
        )

    # Layer 1 — GMM cannibalization adjustment
    gmm_result = (
        load_cannibalization_results() if req.use_cannibalization_adjustment else None
    )
    scored_df  = apply_cannibalization_adjustment(scored_df, gmm_result)
    gmm_active = gmm_result is not None

    # Layer 2 — Competitor Intelligence adjustment (triangulasi ASPERSSI).
    # Sinyal bertentangan dengan GMM ditandai untuk validasi manual TSO,
    # bukan auto-resolve — lihat apply_competitor_adjustment().
    triangulation_results = (
        load_competitor_triangulation() if req.use_competitor_adjustment else None
    )
    scored_df         = apply_competitor_adjustment(scored_df, triangulation_results)
    competitor_active = triangulation_results is not None
    n_conflicting      = int(scored_df["sinyal_bertentangan"].sum())
    print(
        f"[ILP] Competitor Intel adjustment {'applied' if competitor_active else 'skipped (data tidak tersedia atau toggle off)'}"
    )
    print(f"[ILP] Sinyal bertentangan ditemukan: {n_conflicting} toko")

    # Solver objective = score_final, yang sudah merangkum GMM + Competitor
    # Intel (atau degradasi ke score_adjusted / score saat layer nonaktif).
    solver_df = scored_df.copy()
    solver_df["score"] = solver_df["score_final"]

    selected, method = solve_ilp(
        solver_df,
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
        cost         = float(row["estimated_cost"])
        score_orig   = round(float(row.get("score_original", row["score"])), 4)
        score_adj    = round(float(row.get("score_adjusted", row["score"])), 4)
        score_final  = round(float(row.get("score_final", score_adj)), 4)
        eff_score    = score_final
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
                score=score_orig,
                score_adjusted=score_adj,
                estimated_cost=round(cost, 0),
                brand_category=str(row.get("brand_category") or ""),
                avg_ton=round(float(row["avg_ton"]), 2),
                ton_growth=round(float(row["ton_growth"]), 2),
                efficiency=round(eff_score / (cost / 1_000_000), 4) if cost > 0 else 0.0,
                ratio_score=round(float(row["ratio_score"]), 2),
                trx_score=round(float(row["trx_score"]), 2),
                growth_score=round(float(row["growth_score"]), 2),
                adjustment_factor=round(float(row.get("adjustment_factor", 1.0)), 3),
                cannibalization_category=_safe_str(row.get("cannibalization_category")),
                cannibalization_label=_safe_str(row.get("cannibalization_label")),
                score_final=score_final,
                combined_adjustment_factor=round(float(row.get("combined_adjustment_factor", 1.0)), 3),
                competitor_verdict=_safe_str(row.get("competitor_verdict")),
                competitor_top_brand=_safe_str(row.get("competitor_top_brand")),
                sinyal_bertentangan=bool(row.get("sinyal_bertentangan", False)),
                conflict_note=_safe_str(row.get("conflict_note")),
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
            "exclude_existing_loyalty":        req.exclude_existing_loyalty,
            "toko_dikecualikan":               toko_dikecualikan,
            "total_kandidat_dianalisis":       total_kandidat,
            "cannibalization_adjustment_used": gmm_active,
            "competitor_adjustment_used":      competitor_active,
            "n_sinyal_bertentangan":           sum(1 for s in data if s.sinyal_bertentangan),
            "weights": {
                "ratio_cluster": req.weight_ratio_cluster,
                "avg_trx":       req.weight_avg_trx,
                "growth":        req.weight_growth,
            },
        },
    )

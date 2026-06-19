"""Promo program management — CRUD + monitoring endpoints."""
from __future__ import annotations

import io
import json
import os
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.styles import Font, PatternFill
import pandas as pd
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.core.data_loader import load_data
from api.core.aegis_engine import get_store_crs
from api.core.promo_engine import (
    PRICE_PER_TON_ESTIMATE,
    calculate_promo_achievement,
    estimate_budget,
    get_cluster_comparison,
    get_daily_trend,
    get_promo_summary,
)
from api.core import promo_calculator as pc

router = APIRouter(prefix="/api/promo", tags=["promo"])

_LOCK = threading.Lock()


def _get_data_dir() -> Path:
    vol = Path("/mnt/data")
    if vol.exists() and os.access(vol, os.W_OK):
        d = vol / "app_data"
        d.mkdir(parents=True, exist_ok=True)
        return d
    d = Path(__file__).parent.parent / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


_DATA_DIR     = _get_data_dir()
_PROMOS_PATH  = _DATA_DIR / "promos.json"
_MEMBERS_PATH = _DATA_DIR / "loyalty_members.json"


# ── File I/O ──────────────────────────────────────────────────────────────────

def _rp(path: Path) -> Any:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _wp(path: Path, data: Any) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _meta(**kw: Any) -> dict:
    return {"generated_at": _now(), **kw}


# ── Business helpers ──────────────────────────────────────────────────────────

def _generate_id(existing: list[dict]) -> str:
    today  = date.today().strftime("%Y%m%d")
    prefix = f"PROMO-{today}-"
    n      = sum(1 for p in existing if p["id"].startswith(prefix)) + 1
    return f"{prefix}{n:03d}"


def _infer_jenis(cfg: dict) -> str:
    rr  = cfg.get("reward_rate",  {}).get("enabled", False)
    tb  = cfg.get("target_bonus", {}).get("enabled", False)
    cb  = cfg.get("cashback",     {}).get("enabled", False)
    n   = sum([rr, tb, cb])
    if n > 1:  return "kombinasi"
    if rr:     return "reward_rate"
    if tb:     return "target_bonus"
    if cb:     return "cashback"
    return "reward_rate"


def _rebuild_summary(peserta: list[dict], konfigurasi: dict) -> dict:
    per_cluster: dict[str, int] = {}
    for p in peserta:
        cl = str(p.get("cluster", "Unknown"))
        per_cluster[cl] = per_cluster.get(cl, 0) + 1
    return {
        "total_toko":            len(peserta),
        "per_cluster":           per_cluster,
        "estimasi_budget_total": estimate_budget(peserta, konfigurasi),
    }


# ── Pydantic models ───────────────────────────────────────────────────────────

class RewardRateCfg(BaseModel):
    enabled:           bool  = False
    mode:              str   = "flat"
    flat_rate:         float = 10000
    per_cluster_rates: dict  = {}


class TargetBonusCfg(BaseModel):
    enabled:       bool  = False
    threshold_pct: float = 100
    bonus_rate:    float = 2000


class CashbackCfg(BaseModel):
    enabled:      bool  = False
    cashback_pct: float = 2.0


class KonfigurasiPromo(BaseModel):
    reward_rate:  RewardRateCfg  = RewardRateCfg()
    target_bonus: TargetBonusCfg = TargetBonusCfg()
    cashback:     CashbackCfg    = CashbackCfg()


class CreatePromoBody(BaseModel):
    nama_promo:        str
    deskripsi:         str              = ""
    periode_mulai:     str
    periode_selesai:   str
    konfigurasi_promo: KonfigurasiPromo = KonfigurasiPromo()
    created_by:        str              = "admin"


class UpdatePromoBody(BaseModel):
    nama_promo:        str | None              = None
    deskripsi:         str | None              = None
    periode_mulai:     str | None              = None
    periode_selesai:   str | None              = None
    konfigurasi_promo: KonfigurasiPromo | None = None


class CancelBody(BaseModel):
    alasan: str = ""


class AddPesertaBody(BaseModel):
    id_toko:       str
    target_ton:    float | None = None
    rate_override: float | None = None
    catatan:       str          = ""


# ── Multi-tier reward models ──────────────────────────────────────────────────

class TierConfig(BaseModel):
    tier_id:       int
    label:         str
    threshold_pct: float
    multiplier:    float
    keterangan:    str = ""


class RewardConfigMultiTier(BaseModel):
    type:                str        = "multi_tier_points"
    tiers:               list[TierConfig]
    reguler_multiplier:  float      = 1.0
    overflow_multiplier: float      = 1.0
    catatan:             str        = ""


class CreatePromoBodyV2(BaseModel):
    nama_promo:       str
    deskripsi:        str               = ""
    periode_mulai:    str
    periode_selesai:  str
    reward_config:    RewardConfigMultiTier
    created_by:       str               = "admin"


class UpdatePromoBodyV2(BaseModel):
    nama_promo:      str | None               = None
    deskripsi:       str | None               = None
    periode_mulai:   str | None               = None
    periode_selesai: str | None               = None
    reward_config:   RewardConfigMultiTier | None = None


class PreviewCalcBody(BaseModel):
    volume_realisasi: float
    volume_target:    float
    brand:            str
    tiers: list[TierConfig]
    reguler_multiplier:  float = 1.0
    overflow_multiplier: float = 1.0


# ── POST /api/promo/preview-calc ─────────────────────────────────────────────
# Static routes — must be registered before /{promo_id}

@router.post("/preview-calc")
def preview_calc(body: PreviewCalcBody) -> dict:
    """Kalkulasi reward langsung dari tiers tanpa simpan ke DB (untuk form preview)."""
    bpv = pc.get_brand_point_values()
    reward_config = {
        "tiers": [t.model_dump() for t in body.tiers],
        "reguler_multiplier":  body.reguler_multiplier,
        "overflow_multiplier": body.overflow_multiplier,
    }
    result = pc.calculate_tier_reward(
        volume_realisasi   = body.volume_realisasi,
        volume_target      = body.volume_target,
        reward_config      = reward_config,
        brand_name         = body.brand,
        brand_point_values = bpv,
    )
    return {"status": "ok", "data": result, "meta": _meta()}


# ── POST /api/promo/create-v2 (multi-tier reward) ─────────────────────────────

@router.post("/create-v2", status_code=201)
def create_promo_v2(body: CreatePromoBodyV2) -> dict:
    """Buat program promo dengan reward_config multi-tier."""
    rc_dict = body.reward_config.model_dump()

    # Validate tiers ordering
    tiers = sorted(rc_dict["tiers"], key=lambda x: x["threshold_pct"])
    if not tiers:
        raise HTTPException(400, "Minimal 1 tier harus didefinisikan")

    thresholds   = [t["threshold_pct"] for t in tiers]
    multipliers  = [t["multiplier"]    for t in tiers]

    if len(set(thresholds)) != len(thresholds):
        raise HTTPException(400, "threshold_pct harus unik, tidak boleh duplikat")
    if any(t <= 0 for t in thresholds):
        raise HTTPException(400, "threshold_pct harus lebih dari 0")
    if any(m <= 1 for m in multipliers):
        raise HTTPException(400, "multiplier setiap tier harus lebih dari 1")
    if multipliers != sorted(multipliers):
        raise HTTPException(400, "multiplier harus naik mengikuti urutan threshold tier")

    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        new_id = _generate_id(promos)
        promo: dict = {
            "id":             new_id,
            "nama_promo":     body.nama_promo,
            "deskripsi":      body.deskripsi,
            "jenis_promo":    "multi_tier_points",
            "status":         "Draft",
            "periode_mulai":  body.periode_mulai,
            "periode_selesai": body.periode_selesai,
            "created_by":     body.created_by,
            "created_at":     _now(),
            "reward_config":  rc_dict,
            "peserta":        [],
            "summary_peserta": {"total_toko": 0, "per_cluster": {}, "estimasi_budget_total": 0},
        }
        promos.append(promo)
        _wp(_PROMOS_PATH, promos)

    return {"status": "ok", "data": promo}


# ── GET /api/promo/template/peserta ──────────────────────────────────────────

@router.get("/template/peserta")
def download_template() -> StreamingResponse:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Template Peserta"
    headers = ["ID Toko", "Target TON", "Rate Override", "Catatan"]
    ws.append(headers)
    ws.append(["TK001", 50.0, "", "Contoh peserta"])
    ws.append(["TK002", 45.0, 12000, "Rate override khusus"])

    hdr_fill = PatternFill("solid", fgColor="7C3AED")
    hdr_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.fill = hdr_fill
        cell.font = hdr_font

    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = (
            max(len(str(c.value or "")) for c in col) + 4
        )

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=template_peserta_promo.xlsx"},
    )


# ── GET /api/promo ────────────────────────────────────────────────────────────

@router.get("")
def list_promos(
    status: str | None = Query(None),
    limit:  int        = Query(50, ge=1, le=200),
    offset: int        = Query(0,  ge=0),
) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)

    if status:
        promos = [p for p in promos if p.get("status") == status]

    total = len(promos)
    page  = promos[offset: offset + limit]
    # Strip heavy arrays from list view
    slim  = [
        {k: v for k, v in p.items() if k not in ("peserta", "final_achievements")}
        for p in page
    ]
    return {"status": "ok", "data": slim, "meta": _meta(total=total, limit=limit, offset=offset)}


# ── POST /api/promo/create ────────────────────────────────────────────────────

@router.post("/create", status_code=201)
def create_promo(body: CreatePromoBody) -> dict:
    cfg  = body.konfigurasi_promo.model_dump()
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        new_id = _generate_id(promos)
        promo: dict = {
            "id":               new_id,
            "nama_promo":       body.nama_promo,
            "deskripsi":        body.deskripsi,
            "jenis_promo":      _infer_jenis(cfg),
            "status":           "Draft",
            "periode_mulai":    body.periode_mulai,
            "periode_selesai":  body.periode_selesai,
            "created_by":       body.created_by,
            "created_at":       _now(),
            "konfigurasi_promo": cfg,
            "peserta":          [],
            "summary_peserta":  {"total_toko": 0, "per_cluster": {}, "estimasi_budget_total": 0},
        }
        promos.append(promo)
        _wp(_PROMOS_PATH, promos)

    return {"status": "ok", "data": promo}


# ── GET /api/promo/{promo_id} ─────────────────────────────────────────────────

@router.get("/{promo_id}")
def get_promo(promo_id: str) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
    promo = next((p for p in promos if p["id"] == promo_id), None)
    if not promo:
        raise HTTPException(404, detail="Promo tidak ditemukan")
    return {"status": "ok", "data": promo, "meta": _meta()}


# ── PUT /api/promo/{promo_id}/update ─────────────────────────────────────────

@router.put("/{promo_id}/update")
def update_promo(promo_id: str, body: UpdatePromoBody) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] != "Draft":
            raise HTTPException(400, detail="Hanya promo Draft yang bisa diubah")

        if body.nama_promo is not None:
            promos[idx]["nama_promo"]    = body.nama_promo
        if body.deskripsi is not None:
            promos[idx]["deskripsi"]     = body.deskripsi
        if body.periode_mulai is not None:
            promos[idx]["periode_mulai"] = body.periode_mulai
        if body.periode_selesai is not None:
            promos[idx]["periode_selesai"] = body.periode_selesai
        if body.konfigurasi_promo is not None:
            cfg = body.konfigurasi_promo.model_dump()
            promos[idx]["konfigurasi_promo"] = cfg
            promos[idx]["jenis_promo"]       = _infer_jenis(cfg)
            promos[idx]["summary_peserta"]   = _rebuild_summary(promos[idx]["peserta"], cfg)

        _wp(_PROMOS_PATH, promos)
        updated = promos[idx]

    return {"status": "ok", "data": updated}


# ── POST /api/promo/{promo_id}/activate ──────────────────────────────────────

@router.post("/{promo_id}/activate")
def activate_promo(promo_id: str) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] != "Draft":
            raise HTTPException(400, detail="Hanya promo Draft yang bisa diaktifkan")
        if not promos[idx]["peserta"]:
            raise HTTPException(400, detail="Promo harus memiliki minimal satu peserta")

        promos[idx]["status"]       = "Aktif"
        promos[idx]["activated_at"] = _now()
        _wp(_PROMOS_PATH, promos)
        updated = promos[idx]

    return {"status": "ok", "data": updated}


# ── POST /api/promo/{promo_id}/complete ──────────────────────────────────────

@router.post("/{promo_id}/complete")
def complete_promo(promo_id: str) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] != "Aktif":
            raise HTTPException(400, detail="Hanya promo Aktif yang bisa diselesaikan")
        promo = promos[idx]

    df_trx  = load_data()
    ach_df  = calculate_promo_achievement(promo, df_trx)
    summary = get_promo_summary(promo, ach_df)

    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        promos[idx]["status"]             = "Selesai"
        promos[idx]["completed_at"]       = _now()
        promos[idx]["final_summary"]      = summary
        promos[idx]["final_achievements"] = ach_df.to_dict("records") if not ach_df.empty else []
        _wp(_PROMOS_PATH, promos)
        updated = promos[idx]

    return {"status": "ok", "data": updated, "meta": _meta(summary=summary)}


# ── POST /api/promo/{promo_id}/cancel ────────────────────────────────────────

@router.post("/{promo_id}/cancel")
def cancel_promo(promo_id: str, body: CancelBody) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] in ("Selesai", "Dibatalkan"):
            raise HTTPException(400, detail=f"Promo {promos[idx]['status']} tidak bisa dibatalkan")

        promos[idx]["status"]       = "Dibatalkan"
        promos[idx]["alasan_batal"] = body.alasan
        promos[idx]["cancelled_at"] = _now()
        _wp(_PROMOS_PATH, promos)
        updated = promos[idx]

    return {"status": "ok", "data": updated}


# ── POST /api/promo/{promo_id}/peserta/add-one ───────────────────────────────

@router.post("/{promo_id}/peserta/add-one")
def add_peserta(promo_id: str, body: AddPesertaBody) -> dict:
    members_raw = _rp(_MEMBERS_PATH)
    member      = next(
        (m for m in members_raw if str(m["id_toko"]) == body.id_toko and m.get("status") == "Aktif"),
        None,
    )
    if member:
        nama_toko = str(member["nama_toko"])
        cluster   = str(member["cluster_pareto"])
    else:
        crs     = get_store_crs()
        crs_row = crs[crs["ID Toko"].astype(str) == body.id_toko]
        if crs_row.empty:
            raise HTTPException(404, detail=f"Toko {body.id_toko} tidak ditemukan")
        row       = crs_row.iloc[0]
        nama_toko = str(row.get("Nama Toko", ""))
        cluster   = str(row.get("Cluster Pareto", "Bronze"))

    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] != "Draft":
            raise HTTPException(400, detail="Peserta hanya bisa ditambahkan saat status Draft")

        existing_ids = {str(p["id_toko"]) for p in promos[idx]["peserta"]}
        if body.id_toko in existing_ids:
            raise HTTPException(409, detail=f"Toko {body.id_toko} sudah terdaftar")

        promos[idx]["peserta"].append({
            "id_toko":       body.id_toko,
            "nama_toko":     nama_toko,
            "cluster":       cluster,
            "rate_override": body.rate_override,
            "target_ton":    body.target_ton or 0.0,
            "catatan":       body.catatan,
        })
        promos[idx]["summary_peserta"] = _rebuild_summary(
            promos[idx]["peserta"], promos[idx]["konfigurasi_promo"]
        )
        _wp(_PROMOS_PATH, promos)
        updated_peserta = promos[idx]["peserta"]

    return {"status": "ok", "data": updated_peserta}


# ── POST /api/promo/{promo_id}/peserta/upload-excel ──────────────────────────

@router.post("/{promo_id}/peserta/upload-excel")
def upload_peserta(promo_id: str, file: UploadFile = File(...)) -> dict:
    fname = file.filename or ""
    if not fname.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, detail="File harus berformat .xlsx atau .xls")

    raw = file.file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
    except Exception as exc:
        raise HTTPException(400, detail=f"File tidak dapat dibaca: {exc}") from exc

    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        raise HTTPException(400, detail="File kosong atau tidak ada baris data")

    header  = [str(c or "").strip() for c in rows[0]]
    col_idx = {name: i for i, name in enumerate(header)}

    if "ID Toko" not in col_idx:
        raise HTTPException(400, detail="Kolom 'ID Toko' tidak ditemukan di header")

    def gcol(row: tuple, name: str, default: str = "") -> str:
        i = col_idx.get(name)
        if i is None or i >= len(row):
            return default
        return str(row[i] or "").strip()

    members_raw = _rp(_MEMBERS_PATH)
    member_map  = {str(m["id_toko"]): m for m in members_raw if m.get("status") == "Aktif"}
    crs         = get_store_crs()
    crs_idx     = crs.set_index("ID Toko") if "ID Toko" in crs.columns else pd.DataFrame()

    berhasil = 0
    duplikat = 0
    errors: list[str] = []
    new_peserta: list[dict] = []

    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] != "Draft":
            raise HTTPException(400, detail="Upload hanya bisa saat status Draft")

        existing_ids = {str(p["id_toko"]) for p in promos[idx]["peserta"]}

        for row_num, row in enumerate(rows[1:], start=2):
            id_toko = gcol(row, "ID Toko")
            if not id_toko:
                errors.append(f"Baris {row_num}: ID Toko kosong")
                continue
            if id_toko in existing_ids:
                duplikat += 1
                continue

            try:
                target_ton = float(gcol(row, "Target TON", "0") or "0")
            except ValueError:
                target_ton = 0.0

            rate_str = gcol(row, "Rate Override", "")
            try:
                rate_override: float | None = float(rate_str) if rate_str else None
            except ValueError:
                rate_override = None

            catatan = gcol(row, "Catatan", "")

            if id_toko in member_map:
                m = member_map[id_toko]
                nama_toko = str(m["nama_toko"])
                cluster   = str(m["cluster_pareto"])
            elif not crs_idx.empty and id_toko in crs_idx.index:
                nama_toko = str(crs_idx.at[id_toko, "Nama Toko"] or "")
                cluster   = str(crs_idx.at[id_toko, "Cluster Pareto"] or "Bronze")
            else:
                errors.append(f"Baris {row_num} ({id_toko}): Toko tidak ditemukan di data")
                continue

            new_peserta.append({
                "id_toko":       id_toko,
                "nama_toko":     nama_toko,
                "cluster":       cluster,
                "rate_override": rate_override,
                "target_ton":    target_ton,
                "catatan":       catatan,
            })
            existing_ids.add(id_toko)
            berhasil += 1

        if new_peserta:
            promos[idx]["peserta"].extend(new_peserta)
            promos[idx]["summary_peserta"] = _rebuild_summary(
                promos[idx]["peserta"], promos[idx]["konfigurasi_promo"]
            )
            _wp(_PROMOS_PATH, promos)

    return {
        "status": "ok",
        "data":   {"berhasil": berhasil, "duplikat": duplikat, "errors": errors},
        "meta":   _meta(),
    }


# ── DELETE /api/promo/{promo_id}/peserta/{id_toko} ───────────────────────────

@router.delete("/{promo_id}/peserta/{id_toko}")
def remove_peserta(promo_id: str, id_toko: str) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
        idx = next((i for i, p in enumerate(promos) if p["id"] == promo_id), None)
        if idx is None:
            raise HTTPException(404, detail="Promo tidak ditemukan")
        if promos[idx]["status"] != "Draft":
            raise HTTPException(400, detail="Peserta hanya bisa dihapus saat status Draft")

        before = len(promos[idx]["peserta"])
        promos[idx]["peserta"] = [p for p in promos[idx]["peserta"] if str(p["id_toko"]) != id_toko]
        if len(promos[idx]["peserta"]) == before:
            raise HTTPException(404, detail=f"Toko {id_toko} tidak ditemukan di peserta")

        cfg = promos[idx].get("konfigurasi_promo", {})
        promos[idx]["summary_peserta"] = _rebuild_summary(promos[idx]["peserta"], cfg)
        _wp(_PROMOS_PATH, promos)
        updated = promos[idx]["peserta"]

    return {"status": "ok", "data": updated}


# ── GET /api/promo/{promo_id}/reward-preview ─────────────────────────────────

@router.get("/{promo_id}/reward-preview")
def reward_preview(
    promo_id:         str,
    volume_realisasi: float = 0.0,
    volume_target:    float = 100.0,
    brand:            str   = "Semen Elang",
) -> dict:
    """Preview kalkulasi reward menggunakan reward_config program yang tersimpan."""
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
    promo = next((p for p in promos if p["id"] == promo_id), None)
    if not promo:
        raise HTTPException(404, "Promo tidak ditemukan")

    reward_config = promo.get("reward_config")
    if not reward_config:
        raise HTTPException(400, "Program ini menggunakan konfigurasi lama (non-multi-tier)")

    bpv    = pc.get_brand_point_values()
    result = pc.calculate_tier_reward(
        volume_realisasi   = volume_realisasi,
        volume_target      = volume_target,
        reward_config      = reward_config,
        brand_name         = brand,
        brand_point_values = bpv,
    )
    return {"status": "ok", "data": result, "meta": _meta()}


# ── GET /api/promo/{promo_id}/monitoring ─────────────────────────────────────

@router.get("/{promo_id}/monitoring")
def get_monitoring(
    promo_id: str,
    sort_by:  str = Query("achievement", pattern="^(achievement|realisasi|reward)$"),
    order:    str = Query("desc",        pattern="^(asc|desc)$"),
) -> dict:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
    promo = next((p for p in promos if p["id"] == promo_id), None)
    if not promo:
        raise HTTPException(404, detail="Promo tidak ditemukan")
    if promo["status"] not in ("Aktif", "Selesai"):
        raise HTTPException(400, detail="Monitoring hanya tersedia untuk promo Aktif atau Selesai")

    df_trx = load_data()

    # Multi-tier program → use promo_calculator
    is_multi_tier = bool(promo.get("reward_config"))

    if is_multi_tier:
        loyalty_cfg = pc.load_loyalty_config()
        mt_result   = pc.calculate_program_reward_summary(
            promo         = promo,
            peserta_data  = promo.get("peserta", []),
            transaksi_df  = df_trx,
            loyalty_config = loyalty_cfg,
        )
        return {
            "status": "ok",
            "data": {
                "is_multi_tier":    True,
                "program_id":       promo["id"],
                "program_nama":     promo.get("nama_promo", ""),
                "total_peserta":    mt_result["total_peserta"],
                "total_poin":       mt_result["total_poin"],
                "total_rupiah":     mt_result["total_rupiah"],
                "tier_distribution": mt_result["tier_distribution"],
                "peserta_detail":   mt_result["peserta_detail"],
            },
            "meta": _meta(),
        }
    else:
        # Legacy konfigurasi_promo flow
        if promo["status"] == "Selesai" and "final_achievements" in promo:
            ach_df = pd.DataFrame(promo["final_achievements"])
        else:
            ach_df = calculate_promo_achievement(promo, df_trx)
        summary = get_promo_summary(promo, ach_df)

    daily_trend = get_daily_trend(promo, df_trx)
    cluster_cmp = get_cluster_comparison(promo, df_trx) if promo["status"] == "Selesai" else []

    # Sort achievements
    sort_col = {"achievement": "achievement_pct", "realisasi": "realisasi_ton", "reward": "total_reward"}
    asc      = order == "asc"
    if not ach_df.empty:
        ach_df = ach_df.sort_values(sort_col.get(sort_by, "achievement_pct"), ascending=asc)

    # Distribution buckets
    if not ach_df.empty:
        pct = ach_df["achievement_pct"]
        distribution = [
            {"label": "0–50%",   "count": int((pct <= 50).sum()),                            "color": "#DC2626"},
            {"label": "51–70%",  "count": int(((pct > 50) & (pct <= 70)).sum()),              "color": "#EA580C"},
            {"label": "71–90%",  "count": int(((pct > 70) & (pct <= 90)).sum()),              "color": "#D97706"},
            {"label": "91–100%", "count": int(((pct > 90) & (pct <= 100)).sum()),             "color": "#16a34a"},
            {"label": ">100%",   "count": int((pct > 100).sum()),                             "color": "#059669"},
        ]
    else:
        distribution = []

    # Auto-recommendations for Selesai
    recommendations: list[str] = []
    if promo["status"] == "Selesai" and not ach_df.empty:
        melampaui = int((ach_df["achievement_pct"] > 100).sum())
        tidak_trx = int((ach_df["realisasi_ton"] == 0).sum())
        low_ach   = int((ach_df["achievement_pct"] < 80).sum())
        if melampaui > 0:
            recommendations.append(
                f"{melampaui} toko melampaui target — kandidat kuat untuk program promo berikutnya."
            )
        if tidak_trx > 0:
            recommendations.append(
                f"{tidak_trx} toko tidak bertransaksi selama periode promo — perlu evaluasi relevansi program."
            )
        if low_ach > 0:
            recommendations.append(
                f"{low_ach} toko achievement < 80% — pertimbangkan follow-up atau penyesuaian target."
            )

    return {
        "status": "ok",
        "data": {
            "is_multi_tier":      False,
            "achievements":       ach_df.where(pd.notna(ach_df), None).to_dict("records") if not ach_df.empty else [],
            "summary":            summary,
            "daily_trend":        daily_trend,
            "distribution":       distribution,
            "cluster_comparison": cluster_cmp,
            "recommendations":    recommendations,
        },
        "meta": _meta(),
    }


# ── GET /api/promo/{promo_id}/monitoring/export ──────────────────────────────

@router.get("/{promo_id}/monitoring/export")
def export_monitoring(promo_id: str) -> StreamingResponse:
    with _LOCK:
        promos = _rp(_PROMOS_PATH)
    promo = next((p for p in promos if p["id"] == promo_id), None)
    if not promo:
        raise HTTPException(404, detail="Promo tidak ditemukan")
    if promo["status"] not in ("Aktif", "Selesai"):
        raise HTTPException(400, detail="Export hanya untuk promo Aktif atau Selesai")

    df_trx = load_data()
    if promo["status"] == "Selesai" and "final_achievements" in promo:
        ach_df = pd.DataFrame(promo["final_achievements"])
    else:
        ach_df = calculate_promo_achievement(promo, df_trx)

    summary = get_promo_summary(promo, ach_df)

    wb = openpyxl.Workbook()

    # Sheet 1: Summary
    ws1 = wb.active
    ws1.title = "Summary"
    ws1.append(["LAPORAN MONITORING PROMO"])
    ws1.append([promo["nama_promo"]])
    ws1.append(["Periode", f"{promo['periode_mulai']} s/d {promo['periode_selesai']}"])
    ws1.append(["Status", promo["status"]])
    ws1.append([])
    ws1.append(["Total Peserta", summary["total_peserta"]])
    ws1.append(["Peserta Bertransaksi", summary["peserta_aktif_transaksi"]])
    ws1.append(["Total Target TON", summary["total_target_ton"]])
    ws1.append(["Total Realisasi TON", summary["total_realisasi_ton"]])
    ws1.append(["Overall Achievement", f"{summary['overall_achievement_pct']:.1f}%"])
    ws1.append(["Total Reward Earned (Rp)", summary["total_reward_earned"]])
    ws1.append(["Estimasi Budget Sisa (Rp)", summary["estimasi_budget_sisa"]])

    # Sheet 2: Achievement per toko
    ws2 = wb.create_sheet("Achievement per Toko")
    hdr = ["ID Toko", "Nama Toko", "Cluster", "Target TON", "Realisasi TON",
           "Achievement %", "Reward Rate (Rp)", "Bonus (Rp)", "Cashback (Rp)",
           "Total Reward (Rp)", "Status"]
    ws2.append(hdr)

    hdr_fill = PatternFill("solid", fgColor="7C3AED")
    hdr_font = Font(bold=True, color="FFFFFF")
    for cell in ws2[1]:
        cell.fill = hdr_fill
        cell.font = hdr_font

    if not ach_df.empty:
        for _, row in ach_df.sort_values("achievement_pct", ascending=False).iterrows():
            ws2.append([
                row["id_toko"], row["nama_toko"], row["cluster"],
                float(row["target_ton"]), float(row["realisasi_ton"]),
                round(float(row["achievement_pct"]), 2),
                int(row["reward_rate_earned"]), int(row["bonus_earned"]),
                int(row["cashback_earned"]), int(row["total_reward"]),
                row["status"],
            ])

    for col in ws2.columns:
        ws2.column_dimensions[col[0].column_letter].width = (
            max(len(str(c.value or "")) for c in col) + 3
        )

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe = promo["nama_promo"].replace(" ", "_")[:30]
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=monitoring_{safe}.xlsx"},
    )

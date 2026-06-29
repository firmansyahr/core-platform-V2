"""Action Center — aggregates actionable items from all CORE modules."""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/action-center", tags=["action-center"])

_DISMISSED_PATH = Path("api/data/action_dismissed.json")
SEVERITY_ORDER = {"kritis": 0, "penting": 1, "info": 2}

# Simple in-memory cache: (items, timestamp)
_cache: tuple[list[dict], float] | None = None
_CACHE_TTL = 300  # 5 minutes


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_dismissed() -> set[str]:
    if _DISMISSED_PATH.exists():
        try:
            return set(json.loads(_DISMISSED_PATH.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()


def _save_dismissed(ids: set[str]) -> None:
    _DISMISSED_PATH.parent.mkdir(parents=True, exist_ok=True)
    _DISMISSED_PATH.write_text(json.dumps(sorted(ids), ensure_ascii=False), encoding="utf-8")


# ── Source: AEGIS CAD alerts ──────────────────────────────────────────────────

def _get_cad_actions(dismissed: set[str]) -> list[dict]:
    try:
        from api.core import cad_storage
        records, _ = cad_storage.get_records(status="OPEN", kabupaten="", limit=9999, offset=0)
    except Exception:
        return []

    now = datetime.now(timezone.utc)
    items: list[dict] = []
    for r in records:
        item_id = f"cad-{r['id']}"
        if item_id in dismissed:
            continue
        tgl = r.get("tanggal_alert") or r.get("tgl_alert") or ""
        try:
            tgl_dt = datetime.fromisoformat(tgl.replace("Z", "+00:00"))
            if tgl_dt.tzinfo is None:
                tgl_dt = tgl_dt.replace(tzinfo=timezone.utc)
            days_open = (now - tgl_dt).days
        except Exception:
            days_open = 0

        if days_open < 7:
            continue

        severity = "kritis" if days_open >= 14 else "penting"
        kabupaten = r.get("kabupaten", "")
        jumlah_toko = r.get("jumlah_toko", 0)
        status_alert = r.get("status_alert", "UNKNOWN")
        items.append({
            "id": item_id,
            "source": "AEGIS",
            "severity": severity,
            "title": f"CAD Alert {kabupaten} belum divalidasi",
            "description": f"{days_open} hari sejak alert · {jumlah_toko} toko · Status: {status_alert}",
            "action_label": "Buka CAD History",
            "action_url": "/aegis/cad-history",
            "meta": {"kabupaten": kabupaten, "days_open": days_open},
            "created_at": tgl,
        })

    return items


# ── Source: Loyalty churn risk ────────────────────────────────────────────────

def _get_churn_actions(dismissed: set[str]) -> list[dict]:
    try:
        from api.core.data_loader import load_data
        from api.core.aegis_engine import get_store_crs
        from api.core.performance_engine import get_performance_overview

        LOYALTY_PATH = "api/data/loyalty_members.json"
        members: list[dict] = []
        if os.path.exists(LOYALTY_PATH):
            with open(LOYALTY_PATH) as f:
                members = json.load(f)

        df = load_data()
        crs = get_store_crs()
        result = get_performance_overview(df, crs, members)
        stores = result.get("stores", [])
    except Exception:
        return []

    HIGH_CHURN_VERDICTS = {"Perlu Perhatian", "Dalam Pemantauan"}
    items: list[dict] = []
    for s in stores:
        vol_delta = float(s.get("vol_delta_pct", 0))
        verdict = s.get("verdict", "")
        if vol_delta >= -15 or verdict not in HIGH_CHURN_VERDICTS:
            continue
        item_id = f"churn-{s['id_toko']}"
        if item_id in dismissed:
            continue
        nama = s.get("nama_toko") or s["id_toko"]
        items.append({
            "id": item_id,
            "source": "Loyalty",
            "severity": "penting",
            "title": f"Toko {nama} berisiko churn",
            "description": f"Volume turun {abs(vol_delta):.1f}% · Verdict: {verdict}",
            "action_label": "Lihat Performance Tracker",
            "action_url": "/performance",
            "meta": {"id_toko": s["id_toko"], "vol_delta_pct": vol_delta, "verdict": verdict},
            "created_at": _now_iso(),
        })

    # return top 10 worst by vol_delta
    items.sort(key=lambda x: x["meta"]["vol_delta_pct"])
    return items[:10]


# ── Source: Competitor triangulation ─────────────────────────────────────────

def _get_competitor_actions(dismissed: set[str]) -> list[dict]:
    try:
        from api.core import competitor_engine as ce
        from api.core.cannibalization_engine import load_cached_result
        from api.core.aegis_engine import compute_store_crs
        from api.core.data_loader import load_data

        df = load_data()
        store_crs = compute_store_crs(df)
        if store_crs.empty:
            return []

        sp = ce.load_share_provinsi()
        ms = ce.load_marketshare_brand()
        results = ce.triangulate_aegis_with_asperssi(store_crs, sp, ms)

        gmm = load_cached_result()
        if gmm:
            results = ce.cross_check_gmm_with_triangulation(results, gmm, store_crs)
    except Exception:
        return []

    CRITICAL_VERDICTS = {"KONFIRMASI_KOMPETITOR", "ESKALASI_TINGGI"}
    items: list[dict] = []
    for prov in results:
        verdict = prov.get("verdict", "")
        if verdict not in CRITICAL_VERDICTS:
            continue
        provinsi = prov.get("provinsi", "")
        item_id = f"competitor-{provinsi.replace(' ', '_')}"
        if item_id in dismissed:
            continue
        insight = prov.get("insight", "Tekanan kompetitor terkonfirmasi")
        merah = prov.get("aegis_merah_count", 0)
        items.append({
            "id": item_id,
            "source": "Competitor Intelligence",
            "severity": "kritis",
            "title": f"Tekanan kompetitor terkonfirmasi — {provinsi}",
            "description": insight[:120] + ("…" if len(insight) > 120 else ""),
            "action_label": "Buka Competitor Intelligence",
            "action_url": "/competitor",
            "meta": {"provinsi": provinsi, "verdict": verdict, "aegis_merah_count": merah},
            "created_at": _now_iso(),
        })

    return items


# ── Source: Cannibalization GMM ───────────────────────────────────────────────

def _get_cannibalization_actions(dismissed: set[str]) -> list[dict]:
    item_id = "cannibalization-summary"
    if item_id in dismissed:
        return []

    try:
        from api.core.cannibalization_engine import load_cached_result
        result = load_cached_result()
        if not result:
            return []
        vs = result.get("validation_summary", {})
        kani_total = vs.get("kanibalisasi_total_toko", 0)
        fb_total   = vs.get("fighting_brand_total_toko", 0)
        if kani_total == 0 and fb_total == 0:
            return []
    except Exception:
        return []

    parts: list[str] = []
    if kani_total > 0:
        parts.append(f"{kani_total} toko kanibalisasi internal")
    if fb_total > 0:
        parts.append(f"{fb_total} toko pergeseran ke Fighting Brand")

    return [{
        "id": item_id,
        "source": "Cannibalization Detector",
        "severity": "info",
        "title": f"{kani_total + fb_total} toko terdeteksi pola berisiko (GMM)",
        "description": " · ".join(parts),
        "action_label": "Lihat Analisis ILP",
        "action_url": "/ilp",
        "meta": {"kanibalisasi_total_toko": kani_total, "fighting_brand_total_toko": fb_total},
        "created_at": _now_iso(),
    }]


# ── Aggregation ───────────────────────────────────────────────────────────────

def _build_items(dismissed: set[str]) -> list[dict]:
    items: list[dict] = []
    items.extend(_get_cad_actions(dismissed))
    items.extend(_get_competitor_actions(dismissed))
    items.extend(_get_churn_actions(dismissed))
    items.extend(_get_cannibalization_actions(dismissed))
    items.sort(key=lambda x: (SEVERITY_ORDER.get(x["severity"], 3), x.get("created_at", "")))
    return items


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/items")
def list_action_items() -> dict:
    global _cache
    dismissed = _load_dismissed()

    now_ts = time.time()
    if _cache is not None and (now_ts - _cache[1]) < _CACHE_TTL:
        cached_items = [i for i in _cache[0] if i["id"] not in dismissed]
    else:
        items = _build_items(dismissed)
        _cache = (items, now_ts)
        cached_items = items

    meta = {
        "total":  len(cached_items),
        "kritis": sum(1 for i in cached_items if i["severity"] == "kritis"),
        "penting": sum(1 for i in cached_items if i["severity"] == "penting"),
        "info":   sum(1 for i in cached_items if i["severity"] == "info"),
        "generated_at": _now_iso(),
    }
    return {"status": "ok", "data": cached_items, "meta": meta}


@router.post("/dismiss/{item_id:path}")
def dismiss_item(item_id: str) -> dict:
    global _cache
    dismissed = _load_dismissed()
    dismissed.add(item_id)
    _save_dismissed(dismissed)
    _cache = None  # invalidate cache
    return {"status": "ok", "dismissed": item_id}


@router.delete("/dismiss/{item_id:path}")
def undismiss_item(item_id: str) -> dict:
    global _cache
    dismissed = _load_dismissed()
    dismissed.discard(item_id)
    _save_dismissed(dismissed)
    _cache = None
    return {"status": "ok", "undismissed": item_id}


@router.post("/refresh")
def refresh_cache() -> dict:
    global _cache
    _cache = None
    dismissed = _load_dismissed()
    items = _build_items(dismissed)
    _cache = (items, time.time())
    meta = {
        "total":  len(items),
        "kritis": sum(1 for i in items if i["severity"] == "kritis"),
        "penting": sum(1 for i in items if i["severity"] == "penting"),
        "info":   sum(1 for i in items if i["severity"] == "info"),
        "generated_at": _now_iso(),
    }
    return {"status": "ok", "data": items, "meta": meta}

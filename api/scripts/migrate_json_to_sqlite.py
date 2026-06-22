"""
Migrasi JSON → SQLite — Tahap 3.

Sumber data dibaca dari --source-dir (default: _get_data_dir(), sama
seperti production — /mnt/data/app_data di Railway, api/data/ lokal):
  loyalty_members.json, loyalty_history.json, loyalty_config.json,
  promos.json, cad_history.json

DUA pengecualian yang TIDAK ikut --source-dir, karena kode aslinya
memang membaca dari path hardcoded (bukan asumsi — sudah diverifikasi
langsung dari competitor_engine.py, promo_calculator.py, routers/settings.py):
  - api/data/asperssi/share_provinsi.json & marketshare_brand.json
    (competitor_engine.py tidak lewat _get_data_dir() sama sekali)
  - api/data/loyalty_config.json untuk field brand_point_values/
    default_point_value (promo_calculator.py & routers/settings.py
    baca/tulis loyalty_config.json di path INI, BUKAN volume — file
    bernama sama tapi di lokasi berbeda dari yang dibaca routers/loyalty.py)

Script ini HANYA BACA file JSON sumber — tidak pernah menulis atau
menghapusnya. Aman dijalankan berulang kali (lihat --db-path untuk
mengarahkan ke file SQLite terpisah saat dry-run).

Strategi Promo (disepakati Tahap 3):
  (a) status Aktif + tipe_program terisi (skema v3)      → Promo + PromoPeserta penuh
  (b) status Aktif TAPI skema lama (tipe_program kosong)  → coba infer skema v3;
                                                              kalau tidak yakin,
                                                              flag perlu_review_manual
                                                              dan migrasi APA ADANYA
  (c) status bukan Aktif (Selesai/Dibatalkan), skema apa pun → PromoArchive (raw_json)

Usage:
  python api/scripts/migrate_json_to_sqlite.py [--source-dir DIR] [--db-path PATH]

  Default --source-dir : hasil _get_data_dir() (path production asli)
  Default --db-path    : api.database.DB_PATH (path production asli)

  Dry-run (WAJIB sebelum menyentuh production):
  python api/scripts/migrate_json_to_sqlite.py \\
      --source-dir /tmp/core_platform_prod_snapshot \\
      --db-path api/data/core_platform_DRYRUN.db
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from api.database import Base, _resolve_db_path  # noqa: E402
from api.models import (  # noqa: E402
    CADAlert,
    CADValidasiToko,
    LoyaltyConfig,
    LoyaltyHistory,
    LoyaltyMember,
    MarketShareBrand,
    MarketShareBrandDetail,
    Promo,
    PromoArchive,
    PromoPeserta,
    ShareProvinsi,
)

# Path hardcoded asli (lihat docstring modul) — TIDAK ikut --source-dir
_ASPERSSI_DIR        = _ROOT / "api" / "data" / "asperssi"
_LOYALTY_CFG_LOCAL   = _ROOT / "api" / "data" / "loyalty_config.json"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_json(path: Path, default):
    if not path.exists():
        print(f"  [!] {path} tidak ditemukan, pakai default kosong")
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date):
        return v
    return datetime.fromisoformat(str(v)[:10]).date()


def _parse_datetime(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v))


# ── 1. LoyaltyMember ──────────────────────────────────────────────────────────

def migrate_loyalty_members(source_dir: Path, db) -> tuple[int, int]:
    raw = _load_json(source_dir / "loyalty_members.json", [])
    n_input = len(raw)
    n_ok = 0
    for m in raw:
        db.merge(LoyaltyMember(
            id=str(m["id"]),
            id_toko=str(m["id_toko"]),
            nama_toko=str(m.get("nama_toko", "")),
            kabupaten=str(m.get("kabupaten", "")),
            cluster_pareto=str(m.get("cluster_pareto", "Bronze")),
            tso=str(m.get("tso", "")),
            reward_type=str(m.get("reward_type", "Standard")),
            catatan=m.get("catatan") or "",
            status=str(m.get("status", "Aktif")),
            tgl_masuk=_parse_date(m.get("tgl_masuk")),
            tgl_keluar=_parse_date(m.get("tgl_keluar")),
            alasan_keluar=m.get("alasan_keluar"),
        ))
        n_ok += 1
    db.commit()
    return n_input, n_ok


# ── 2. LoyaltyHistory ─────────────────────────────────────────────────────────

def migrate_loyalty_history(source_dir: Path, db) -> tuple[int, int]:
    raw = _load_json(source_dir / "loyalty_history.json", [])
    n_input = len(raw)
    n_ok = 0
    for h in raw:
        db.add(LoyaltyHistory(
            id_member=h.get("id_member"),
            id_toko=str(h.get("id_toko", "")),
            nama_toko=str(h.get("nama_toko", "")),
            tanggal=_parse_datetime(h.get("tanggal")) or datetime.utcnow(),
            perubahan=str(h.get("perubahan", "")),
            alasan=h.get("alasan"),
            catatan=h.get("catatan"),  # tidak selalu ada di JSON asli — nullable
            status_baru=str(h.get("status_baru", "")),
        ))
        n_ok += 1
    db.commit()
    return n_input, n_ok


# ── 3. LoyaltyConfig ──────────────────────────────────────────────────────────

def migrate_loyalty_config(source_dir: Path, db) -> dict:
    """
    DUA SUMBER berbeda digabung jadi satu row (lihat docstring modul):
    w1/w2/min_pct_*/growth_rates dari {source_dir}/loyalty_config.json
    (volume-backed, dibaca routers/loyalty.py); brand_point_values/
    default_point_value dari api/data/loyalty_config.json (path hardcoded,
    dibaca promo_calculator.py & routers/settings.py — TIDAK pernah lewat
    volume, jadi nilainya sama dengan apa pun yang ter-commit di git).
    """
    vol_cfg = _load_json(source_dir / "loyalty_config.json", {})
    local_cfg = _load_json(_LOYALTY_CFG_LOCAL, {})

    print(f"  [info] sumber volume (w1/w2/growth_rates)   : {source_dir / 'loyalty_config.json'}")
    print(f"  [info] sumber ephemeral (brand_point_values) : {_LOYALTY_CFG_LOCAL}")

    cfg = LoyaltyConfig(
        id="default",
        w1=float(vol_cfg.get("w1", 0.6)),
        w2=float(vol_cfg.get("w2", 0.4)),
        min_pct_sp=float(vol_cfg.get("min_pct_sp", 0.8)),
        min_pct_platinum=float(vol_cfg.get("min_pct_platinum", 0.7)),
        min_pct_gold=float(vol_cfg.get("min_pct_gold", 0.6)),
        min_pct_silver=float(vol_cfg.get("min_pct_silver", 0.5)),
        default_point_value=int(local_cfg.get("default_point_value", 5000)),
        growth_rates=vol_cfg.get("growth_rates", {"default": {"normal": 0.03, "warning": 0.01, "kritis": 0.0}, "overrides": []}),
        brand_point_values=local_cfg.get("brand_point_values", {}),
    )
    db.merge(cfg)
    db.commit()
    return {"w1": cfg.w1, "w2": cfg.w2, "brand_point_values": cfg.brand_point_values}


# ── 4. Promo (a/b/c) ──────────────────────────────────────────────────────────

def _infer_tipe_program_legacy(promo: dict) -> tuple[str | None, dict, bool]:
    """
    Coba infer tipe_program v3 dari skema lama (konfigurasi_promo v1, atau
    reward_config v2 tanpa tipe_program). Return (tipe_program, reward_config,
    confident). confident=False berarti TIDAK ditransformasi — dikembalikan
    apa adanya + flag perlu_review_manual di pemanggil.

    Saat ini tidak ada data kategori (b) yang memicu fungsi ini (audit Tahap 3:
    0 promo Aktif berskema lama) — logic tetap ditulis untuk jaga-jaga sebelum
    migrasi final dijalankan ulang nanti.
    """
    if promo.get("reward_config") and not promo.get("tipe_program"):
        # v2 (multi_tier_points) tanpa tipe_program eksplisit — ini SATU-SATUNYA
        # kasus yang bisa diinfer dengan confidence tinggi, karena strukturnya
        # (tiers/reguler_multiplier/overflow_multiplier) sudah identik dengan v3 multi_tier.
        rc = promo["reward_config"]
        if rc.get("type") == "multi_tier_points" and rc.get("tiers"):
            return "multi_tier", rc, True
        return None, rc, False

    cfg = promo.get("konfigurasi_promo")
    if not cfg:
        return None, {}, False

    rr = cfg.get("reward_rate", {})
    tb = cfg.get("target_bonus", {})
    cb = cfg.get("cashback", {})

    # Heuristik confidence-tinggi TUNGGAL yang masuk akal tanpa kehilangan makna:
    # target_bonus aktif SENDIRIAN (reward_rate & cashback nonaktif) bisa
    # direpresentasikan sebagai 1 tier multi_tier dengan threshold yang sama.
    # multiplier v3 butuh rasio, sedangkan bonus_rate v1 adalah Rp/ton absolut
    # — TIDAK ekuivalen secara matematis, jadi kita TIDAK memaksakan angka
    # multiplier yang menyesatkan. Confidence rendah → fallback manual review.
    if tb.get("enabled") and not rr.get("enabled") and not cb.get("enabled"):
        return None, cfg, False  # secara sengaja TIDAK diinfer — lihat alasan di atas

    return None, cfg, False


def migrate_promos(source_dir: Path, db) -> dict:
    raw = _load_json(source_dir / "promos.json", [])

    cat_a = cat_b_confident = cat_b_flagged = cat_c = 0
    peserta_a = peserta_b = peserta_c_archived = 0

    for p in raw:
        status = p.get("status")
        tipe_program = p.get("tipe_program")

        if status == "Aktif" and tipe_program:
            # (a) Aktif + skema v3 → migrasi penuh
            _insert_promo_full(db, p, p.get("reward_config", {}), perlu_review_manual=False)
            cat_a += 1
            peserta_a += len(p.get("peserta", []))

        elif status == "Aktif":
            # (b) Aktif tapi skema lama → coba infer, fallback manual review
            inferred_tipe, rc, confident = _infer_tipe_program_legacy(p)
            if confident:
                _insert_promo_full(db, p, rc, perlu_review_manual=False, tipe_program_override=inferred_tipe)
                cat_b_confident += 1
            else:
                rc_flagged = {**rc, "perlu_review_manual": True, "_original_schema": "konfigurasi_promo" if p.get("konfigurasi_promo") else "reward_config_v2"}
                _insert_promo_full(db, p, rc_flagged, perlu_review_manual=True)
                cat_b_flagged += 1
            peserta_b += len(p.get("peserta", []))

        else:
            # (c) Nonaktif/Selesai → arsip raw_json, tidak dinormalisasi
            db.merge(PromoArchive(
                id=str(p["id"]),
                nama_promo=str(p.get("nama_promo", "")),
                status=str(status),
                periode_mulai=_parse_date(p.get("periode_mulai")),
                periode_selesai=_parse_date(p.get("periode_selesai")),
                raw_json=p,
            ))
            cat_c += 1
            peserta_c_archived += len(p.get("peserta", []))

    db.commit()
    return {
        "cat_a": cat_a, "cat_b_confident": cat_b_confident, "cat_b_flagged": cat_b_flagged, "cat_c": cat_c,
        "peserta_a": peserta_a, "peserta_b": peserta_b, "peserta_c_archived": peserta_c_archived,
    }


def _insert_promo_full(db, p: dict, reward_config: dict, perlu_review_manual: bool, tipe_program_override: str | None = None) -> None:
    promo = Promo(
        id=str(p["id"]),
        nama_promo=str(p.get("nama_promo", "")),
        deskripsi=p.get("deskripsi", ""),
        jenis_promo=p.get("jenis_promo"),
        tipe_program=tipe_program_override or p.get("tipe_program"),
        status=str(p.get("status", "Aktif")),
        periode_mulai=_parse_date(p.get("periode_mulai")),
        periode_selesai=_parse_date(p.get("periode_selesai")),
        created_by=p.get("created_by", "admin"),
        created_at=_parse_datetime(p.get("created_at")) or datetime.utcnow(),
        activated_at=_parse_datetime(p.get("activated_at")),
        completed_at=_parse_datetime(p.get("completed_at")),
        cancelled_at=_parse_datetime(p.get("cancelled_at")),
        alasan_batal=p.get("alasan_batal"),
        reward_config=reward_config,
        summary_peserta=p.get("summary_peserta", {}),
        final_summary=p.get("final_summary"),
        final_achievements=p.get("final_achievements"),
    )
    db.merge(promo)

    for ps in p.get("peserta", []):
        db.merge(PromoPeserta(
            promo_id=promo.id,
            id_toko=str(ps["id_toko"]),
            nama_toko=str(ps.get("nama_toko", "")),
            cluster=str(ps.get("cluster", "Bronze")),
            target_ton=float(ps.get("target_ton") or 0.0),
            rate_override=ps.get("rate_override"),   # nullable — union 2 bentuk peserta, lihat models.py
            brand_utama=ps.get("brand_utama"),         # nullable — idem
            catatan=ps.get("catatan", ""),
        ))


# ── 5. CAD History ────────────────────────────────────────────────────────────

def migrate_cad_history(source_dir: Path, db) -> tuple[int, int, int]:
    """
    Field legacy/baru dipetakan ke SATU nama kanonik (lihat docstring
    CADAlert di models.py) — kolom legacy (tanggal_alert, tso_assigned, dst)
    DIBUANG, bukan disimpan dobel.
    """
    raw = _load_json(source_dir / "cad_history.json", [])
    n_input = len(raw)
    n_ok = 0
    n_toko_validasi = 0

    for r in raw:
        alert = CADAlert(
            id=str(r["id"]),
            kabupaten=str(r.get("kabupaten", "")),
            provinsi=r.get("provinsi"),
            tgl_alert=_parse_date(r.get("tgl_alert") or r.get("tanggal_alert")),
            status_alert=str(r.get("status_alert", "")),
            jumlah_toko=int(r.get("jumlah_toko", 0)),
            aegis_score_rata=float(r.get("aegis_score_rata") or 0.0),
            tgl_validasi=_parse_date(r.get("tgl_validasi") or r.get("tanggal_kunjungan")),
            validated_by=r.get("validated_by") or r.get("tso_assigned"),
            hasil_validasi=r.get("hasil_validasi"),
            hasil_validasi_detail=r.get("hasil_validasi_detail"),
            catatan=r.get("catatan"),
            status_resolusi=str(r.get("status_resolusi", "OPEN")),
            status=str(r.get("status", "Pending Validasi")),
            tanggal_resolved=_parse_date(r.get("tanggal_resolved")),
            created_at=_parse_datetime(r.get("created_at")) or datetime.utcnow(),
            kondisi_alert=r.get("kondisi_alert") or {},
            follow_up=r.get("follow_up") or {},
        )
        db.merge(alert)
        n_ok += 1

        for tv in (r.get("toko_validasi") or []):
            db.add(CADValidasiToko(
                cad_alert_id=alert.id,
                id_toko=str(tv.get("id_toko", "")),
                kondisi=tv.get("kondisi"),
                catatan=tv.get("catatan"),
                validated_by=tv.get("validated_by"),
                validated_at=_parse_datetime(tv.get("validated_at")),
                aegis_score=tv.get("aegis_score"),
            ))
            n_toko_validasi += 1

    db.commit()
    return n_input, n_ok, n_toko_validasi


# ── 6. ASPERSSI ───────────────────────────────────────────────────────────────

def migrate_asperssi(db) -> dict:
    """Dibaca dari api/data/asperssi/ langsung — TIDAK ikut --source-dir
    (lihat docstring modul: competitor_engine.py tidak lewat volume)."""
    sp_doc = _load_json(_ASPERSSI_DIR / "share_provinsi.json", {"data": []})
    ms_doc = _load_json(_ASPERSSI_DIR / "marketshare_brand.json", {"data": []})

    n_sp_input = len(sp_doc.get("data", []))
    n_sp_ok = 0
    for d in sp_doc.get("data", []):
        db.merge(ShareProvinsi(
            provinsi=str(d["provinsi"]),
            periode=str(d["periode"]),
            share_nasional_pct=float(d["share_nasional_pct"]),
            tersedia=bool(d.get("tersedia", True)),
        ))
        n_sp_ok += 1
    db.commit()

    n_ms_input = len(ms_doc.get("data", []))
    n_ms_ok = 0
    n_brand_detail = 0
    for d in ms_doc.get("data", []):
        entry = MarketShareBrand(
            provinsi=str(d["provinsi"]),
            periode=str(d["periode"]),
            tersedia=bool(d.get("tersedia", True)),
        )
        db.add(entry)
        db.flush()  # perlu entry.id sebelum insert detail anak
        for b in d.get("brands", []):
            db.add(MarketShareBrandDetail(
                marketshare_brand_id=entry.id,
                nama=str(b["nama"]),
                market_share_pct=float(b["market_share_pct"]),
                is_own_brand=bool(b.get("is_own_brand", False)),
                is_aggregate_others=bool(b.get("is_aggregate_others", False)),
            ))
            n_brand_detail += 1
        n_ms_ok += 1
    db.commit()

    return {
        "share_provinsi": (n_sp_input, n_sp_ok),
        "marketshare_brand": (n_ms_input, n_ms_ok),
        "marketshare_brand_detail": n_brand_detail,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Migrasi JSON → SQLite (Tahap 3)")
    parser.add_argument("--source-dir", type=str, default=None, help="Default: _get_data_dir() (path production)")
    parser.add_argument("--db-path", type=str, default=None, help="Default: api.database.DB_PATH (path production)")
    args = parser.parse_args()

    source_dir = Path(args.source_dir) if args.source_dir else Path(_resolve_db_path()).parent
    db_path = args.db_path or _resolve_db_path()

    print("=" * 72)
    print("MIGRASI JSON → SQLITE")
    print("=" * 72)
    print(f"Source dir : {source_dir}")
    print(f"DB path    : {db_path}")
    print()

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    print("[1/6] LoyaltyMember...")
    lm_in, lm_ok = migrate_loyalty_members(source_dir, db)
    print(f"      {lm_in} di JSON → {lm_ok} tersimpan")

    print("[2/6] LoyaltyHistory...")
    lh_in, lh_ok = migrate_loyalty_history(source_dir, db)
    print(f"      {lh_in} di JSON → {lh_ok} tersimpan")

    print("[3/6] LoyaltyConfig...")
    lc = migrate_loyalty_config(source_dir, db)
    print(f"      tersimpan 1 row (w1={lc['w1']}, w2={lc['w2']}, brand_point_values={len(lc['brand_point_values'])} brand)")

    print("[4/6] Promo (kategori a/b/c)...")
    pr = migrate_promos(source_dir, db)
    print(f"      (a) Aktif+v3            : {pr['cat_a']} promo, {pr['peserta_a']} peserta → Promo+PromoPeserta")
    print(f"      (b) Aktif+legacy,confident: {pr['cat_b_confident']} promo → ditransformasi ke v3")
    print(f"      (b) Aktif+legacy,flagged : {pr['cat_b_flagged']} promo → perlu_review_manual=True")
    print(f"      (c) Nonaktif/Selesai     : {pr['cat_c']} promo, {pr['peserta_c_archived']} peserta (di raw_json) → PromoArchive")

    print("[5/6] CAD History...")
    cad_in, cad_ok, tv_ok = migrate_cad_history(source_dir, db)
    print(f"      {cad_in} alert di JSON → {cad_ok} tersimpan ({tv_ok} toko_validasi)")

    print("[6/6] ASPERSSI...")
    asp = migrate_asperssi(db)
    sp_in, sp_ok = asp["share_provinsi"]
    ms_in, ms_ok = asp["marketshare_brand"]
    print(f"      share_provinsi    : {sp_in} di JSON → {sp_ok} tersimpan")
    print(f"      marketshare_brand : {ms_in} di JSON → {ms_ok} tersimpan ({asp['marketshare_brand_detail']} brand detail)")

    db.close()

    print()
    print("=" * 72)
    print("RINGKASAN VALIDASI")
    print("=" * 72)
    print(f"loyalty_members   : {lm_in} JSON → {lm_ok} SQLite  {'OK' if lm_in == lm_ok else 'MISMATCH!'}")
    print(f"loyalty_history   : {lh_in} JSON → {lh_ok} SQLite  {'OK' if lh_in == lh_ok else 'MISMATCH!'}")
    print(f"promo aktif (a+b) : {pr['cat_a'] + pr['cat_b_confident'] + pr['cat_b_flagged']} program, "
          f"{pr['peserta_a'] + pr['peserta_b']} peserta → Promo+PromoPeserta")
    print(f"promo arsip (c)   : {pr['cat_c']} program, {pr['peserta_c_archived']} peserta → PromoArchive")
    print(f"cad_history       : {cad_in} JSON → {cad_ok} SQLite  {'OK' if cad_in == cad_ok else 'MISMATCH!'}")
    print(f"share_provinsi    : {sp_in} JSON → {sp_ok} SQLite  {'OK' if sp_in == sp_ok else 'MISMATCH!'}")
    print(f"marketshare_brand : {ms_in} JSON → {ms_ok} SQLite  {'OK' if ms_in == ms_ok else 'MISMATCH!'}")
    print()
    print("File JSON sumber TIDAK diubah/dihapus — script ini hanya membaca.")


if __name__ == "__main__":
    main()

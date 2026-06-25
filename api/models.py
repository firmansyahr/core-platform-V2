"""
SQLAlchemy models — TAHAP DESAIN, belum dipakai router/endpoint apa pun.

Struktur berikut diverifikasi langsung dari kode penulis JSON yang
sebenarnya (api/routers/loyalty.py, promo.py, api/core/cad_storage.py,
competitor_engine.py) dan dari live API production — BUKAN dari asumsi.
Lihat catatan "PERBEDAAN DARI ASUMSI AWAL" di setiap model yang relevan.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from api.database import Base


# ── Loyalty ──────────────────────────────────────────────────────────────────

class LoyaltyMember(Base):
    """
    PERBEDAAN DARI ASUMSI: "id" BUKAN format "LYL-xxx" — production yang
    asli (180 member) pakai uuid4() polos (str(uuid.uuid4())), dikonfirmasi
    dari api/routers/loyalty.py add_one_member()/upload_excel() DAN live
    API. Tidak ada field nested/kompleks sama sekali di struktur asli —
    flat 12 kolom, tidak perlu kolom JSON untuk model ini.
    """
    __tablename__ = "loyalty_members"

    id             = Column(String, primary_key=True)  # uuid4 string
    id_toko        = Column(String, nullable=False, index=True)
    nama_toko      = Column(String, nullable=False)
    kabupaten      = Column(String, nullable=False)
    cluster_pareto = Column(String, nullable=False)
    tso            = Column(String, nullable=False)
    reward_type    = Column(String, nullable=False, default="Standard")
    catatan        = Column(String, default="")
    status         = Column(String, nullable=False, default="Aktif")  # "Aktif" | "Nonaktif"
    tgl_masuk      = Column(Date, nullable=False)
    tgl_keluar     = Column(Date, nullable=True)
    alasan_keluar  = Column(String, nullable=True)
    created_at     = Column(DateTime, server_default=func.now())
    updated_at     = Column(DateTime, server_default=func.now(), onupdate=func.now())

    history = relationship("LoyaltyHistory", back_populates="member")


class LoyaltyHistory(Base):
    """
    PERBEDAAN DARI ASUMSI: entry history TIDAK PUNYA id sama sekali di
    JSON asli (api/routers/loyalty.py _log() cuma append dict apa adanya)
    — pakai Integer autoincrement, bukan dipaksa string.

    PERBEDAAN: field "catatan" TIDAK KONSISTEN ADA — hanya muncul dari
    take-out (lihat take_out_member()), TIDAK ADA dari add-one/upload-excel/
    reward-type-change. Field ini sengaja nullable, bukan bug model.
    """
    __tablename__ = "loyalty_history"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    id_member    = Column(String, ForeignKey("loyalty_members.id"), nullable=True, index=True)
    id_toko      = Column(String, nullable=False, index=True)
    nama_toko    = Column(String, nullable=False)
    tanggal      = Column(DateTime, nullable=False)
    perubahan    = Column(String, nullable=False)
    alasan       = Column(String, nullable=True)
    catatan      = Column(String, nullable=True)   # tidak selalu ada — lihat catatan di atas
    status_baru  = Column(String, nullable=False)

    member = relationship("LoyaltyMember", back_populates="history")


class LoyaltyConfig(Base):
    """
    PERBEDAAN DARI ASUMSI: BUKAN "key-value sederhana" — loyalty_config.json
    adalah SATU dokumen config bersarang (growth_rates.default + .overrides,
    brand_point_values per-brand). Didesain sebagai singleton row (id tetap
    "default") dengan kolom skalar untuk field yang sering diakses individual,
    + 2 kolom JSON untuk bagian yang variable-shape (growth_rates punya list
    overrides yang panjangnya berubah-ubah; brand_point_values bisa bertambah
    brand baru) — sesuai prinsip "jangan over-normalisasi" untuk skala ini.
    """
    __tablename__ = "loyalty_config"

    id                  = Column(String, primary_key=True, default="default")
    w1                  = Column(Float, nullable=False, default=0.6)
    w2                  = Column(Float, nullable=False, default=0.4)
    min_pct_sp          = Column(Float, nullable=False, default=0.8)
    min_pct_platinum    = Column(Float, nullable=False, default=0.7)
    min_pct_gold        = Column(Float, nullable=False, default=0.6)
    min_pct_silver      = Column(Float, nullable=False, default=0.5)
    default_point_value = Column(Integer, nullable=False, default=5000)
    growth_rates        = Column(JSON, nullable=False, default=dict)   # {default:{...}, overrides:[...]}
    brand_point_values  = Column(JSON, nullable=False, default=dict)   # {"Semen Elang": 5000, ...}
    updated_at          = Column(DateTime, server_default=func.now(), onupdate=func.now())


class BrandConfig(Base):
    """
    Setting brand MB/CB/FB per wilayah (provinsi/kabupaten), dengan hierarki
    resolusi kabupaten → provinsi → default global (lihat brand_config_engine.py).
    provinsi=None & kabupaten=None merepresentasikan baris "default global"
    tersimpan di DB (berbeda dari DEFAULT_CONFIG hardcoded di engine, yang
    cuma fallback kalau TIDAK ADA baris apa pun yang cocok sama sekali).
    kabupaten tidak boleh terisi tanpa provinsi (selalu match sepasang).
    """
    __tablename__ = "brand_config"

    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    provinsi   = Column(String, nullable=True, index=True)
    kabupaten  = Column(String, nullable=True, index=True)

    mb_brands  = Column(JSON, nullable=False, default=lambda: ["SEMEN ELANG"])
    cb_brands  = Column(JSON, nullable=False, default=lambda: ["SEMEN BADAK"])
    fb_brands  = Column(JSON, nullable=False, default=lambda: ["SEMEN BANTENG"])

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("provinsi", "kabupaten", name="uq_brand_config_wilayah"),
    )


# ── Promo ────────────────────────────────────────────────────────────────────

class Promo(Base):
    """
    PERBEDAAN DARI ASUMSI — jauh lebih kompleks dari "Promo + PromoPeserta":
    TIGA generasi skema hidup berdampingan di promos.json yang sama
    (lihat api/routers/promo.py /create, /create-v2, /create-v3):
      v1 (legacy) : "konfigurasi_promo" (reward_rate/target_bonus/cashback),
                    jenis_promo di-infer otomatis
      v2          : "reward_config" (multi_tier_points), jenis_promo fixed
      v3 (unified): + "tipe_program" (flat_multiplier|multi_tier|leaderboard),
                    "reward_config" sebagai dict bebas-bentuk per tipe
    Field konfigurasi_promo (v1) dan reward_config (v2/v3) DISATUKAN ke
    SATU kolom JSON "reward_config" di model ini — mapping v1→v2/v3 jadi
    bagian kerja migrasi nanti (Tahap 3), BUKAN didesain ulang sebagai
    tabel per-tipe sesuai instruksi awal.
    activated_at/completed_at/cancelled_at/alasan_batal/final_summary/
    final_achievements HANYA ADA kalau promo sudah pernah ke status itu —
    semua nullable.
    """
    __tablename__ = "promos"

    id                 = Column(String, primary_key=True)  # "PROMO-YYYYMMDD-NNN"
    nama_promo         = Column(String, nullable=False)
    deskripsi          = Column(String, default="")
    jenis_promo        = Column(String, nullable=True)
    tipe_program       = Column(String, nullable=True)  # hanya terisi utk promo v3
    status             = Column(String, nullable=False, default="Draft")
    periode_mulai      = Column(Date, nullable=False)
    periode_selesai    = Column(Date, nullable=False)
    created_by         = Column(String, nullable=False, default="admin")
    created_at         = Column(DateTime, server_default=func.now())
    activated_at       = Column(DateTime, nullable=True)
    completed_at       = Column(DateTime, nullable=True)
    cancelled_at        = Column(DateTime, nullable=True)
    alasan_batal       = Column(String, nullable=True)
    reward_config      = Column(JSON, nullable=False, default=dict)  # union v1/v2/v3, lihat docstring
    summary_peserta    = Column(JSON, nullable=False, default=dict)  # {total_toko, per_cluster, estimasi_budget_total}
    final_summary      = Column(JSON, nullable=True)
    final_achievements = Column(JSON, nullable=True)  # snapshot list-of-dict, tidak dinormalisasi
    brand_selection_mode = Column(String, nullable=True)  # "wilayah" | "fighting" — null utk promo lama sebelum fitur ini
    brands               = Column(JSON, nullable=True)  # list[{id,nama,tipe}] hasil resolusi wilayah ATAU fighting-brand only

    peserta = relationship("PromoPeserta", back_populates="promo", cascade="all, delete-orphan")


class PromoArchive(Base):
    """
    Promo nonaktif/selesai (kategori c, hasil keputusan migrasi Tahap 3) —
    disimpan utuh sebagai raw_json TANPA di-parse ke PromoPeserta
    ternormalisasi. Tujuannya historis/referensi, bukan operasional aktif,
    jadi tidak perlu skema relasional penuh.
    """
    __tablename__ = "promo_archive"

    id              = Column(String, primary_key=True)  # id promo asli, "PROMO-xxx"
    nama_promo      = Column(String, nullable=False)
    status          = Column(String, nullable=False)
    periode_mulai   = Column(Date, nullable=True)
    periode_selesai = Column(Date, nullable=True)
    raw_json        = Column(JSON, nullable=False)  # dict promo lengkap apa adanya
    archived_at     = Column(DateTime, server_default=func.now())


class PromoPeserta(Base):
    """
    PERBEDAAN DARI ASUMSI: peserta TIDAK PUNYA bentuk konsisten — dua
    endpoint penulis berbeda menghasilkan shape berbeda:
      add-one / upload-excel  → punya "rate_override", TIDAK ADA "brand_utama"
      add (tab Monitoring)    → punya "brand_utama", TIDAK ADA "rate_override"
    Kolom ini union dari keduanya, keduanya nullable — bukan bug, memang
    begitu adanya di data sekarang. Tidak ada id di JSON asli → autoincrement.
    """
    __tablename__ = "promo_peserta"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    promo_id      = Column(String, ForeignKey("promos.id"), nullable=False, index=True)
    id_toko       = Column(String, nullable=False, index=True)
    nama_toko     = Column(String, nullable=False)
    cluster       = Column(String, nullable=False)
    target_ton    = Column(Float, nullable=False, default=0.0)
    rate_override = Column(Float, nullable=True)   # hanya dari add-one/upload-excel
    brand_utama   = Column(String, nullable=True)  # hanya dari tab Monitoring
    catatan       = Column(String, default="")

    promo = relationship("Promo", back_populates="peserta")

    __table_args__ = (UniqueConstraint("promo_id", "id_toko", name="uq_promo_peserta_toko"),)


# ── CAD Alert History ────────────────────────────────────────────────────────

class CADAlert(Base):
    """
    PERBEDAAN DARI ASUMSI — skema CAD jauh lebih "kotor" dari ekspektasi:
    api/core/cad_storage.py _ensure_new_fields() membuktikan field LEGACY
    dan BARU hidup berdampingan untuk konsep yang SAMA:
      tanggal_alert/tgl_alert, tanggal_kunjungan/tgl_validasi,
      tso_assigned/validated_by, hasil_validasi (string lama)/
      hasil_validasi_detail (dict baru), status_resolusi (OPEN/IN_PROGRESS/
      RESOLVED) vs status (label manusiawi "Pending Validasi"/dst).
    Model ini pakai SATU nama kanonik per konsep (kolom legacy DIBUANG,
    bukan disimpan dobel) — mapping dari JSON lama jadi kerja migrasi nanti.
    kondisi_alert, hasil_validasi_detail, follow_up: dict bersarang dengan
    banyak field opsional (termasuk detail_kompetitor bersarang lagi di
    dalam hasil_validasi_detail) → kolom JSON, tidak dinormalisasi.
    """
    __tablename__ = "cad_alerts"

    id                    = Column(String, primary_key=True)  # "CAD-YYYYMMDD-KABUPATEN"
    kabupaten             = Column(String, nullable=False)
    provinsi              = Column(String, nullable=True)
    tgl_alert             = Column(Date, nullable=False)
    status_alert          = Column(String, nullable=False)  # KUNING | MERAH | KRITIS
    jumlah_toko           = Column(Integer, nullable=False, default=0)
    aegis_score_rata      = Column(Float, nullable=False, default=0.0)
    tgl_validasi          = Column(Date, nullable=True)
    validated_by          = Column(String, nullable=True)
    hasil_validasi        = Column(String, nullable=True)   # legacy enum string, tetap disimpan utk backward display
    hasil_validasi_detail = Column(JSON, nullable=True)
    catatan               = Column(String, nullable=True)
    status_resolusi       = Column(String, nullable=False, default="OPEN")
    status                = Column(String, nullable=False, default="Pending Validasi")
    tanggal_resolved      = Column(Date, nullable=True)
    created_at            = Column(DateTime, server_default=func.now())
    kondisi_alert         = Column(JSON, nullable=False, default=dict)
    follow_up             = Column(JSON, nullable=False, default=dict)

    toko_validasi = relationship("CADValidasiToko", back_populates="alert", cascade="all, delete-orphan")


class CADValidasiToko(Base):
    """Validasi per-toko dalam satu CAD alert — relasional karena ada query
    lintas-alert per toko (get_toko_cad_history()). Tidak ada id di JSON asli.

    nama_toko ditambahkan Tahap 4c (audit cad_storage.py) — TokoValidasiBody
    di router menyertakan nama_toko tapi kolom ini sebelumnya tidak ada,
    akan hilang diam-diam saat SQLite aktif. 0 baris terdampak saat
    penambahan (toko_validasi masih kosong di semua 99 alert production)."""
    __tablename__ = "cad_validasi_toko"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    cad_alert_id  = Column(String, ForeignKey("cad_alerts.id"), nullable=False, index=True)
    id_toko       = Column(String, nullable=False, index=True)
    nama_toko     = Column(String, nullable=True)
    kondisi       = Column(String, nullable=True)
    catatan       = Column(String, nullable=True)
    validated_by  = Column(String, nullable=True)
    validated_at  = Column(DateTime, nullable=True)
    aegis_score   = Column(Float, nullable=True)

    alert = relationship("CADAlert", back_populates="toko_validasi")


# ── ASPERSSI (Competitor Intelligence) ───────────────────────────────────────
#
# PERBEDAAN PENTING (di luar pertanyaan schema, tapi relevan untuk migrasi):
# file-file ini TIDAK lewat _get_data_dir()/volume sama sekali —
# competitor_engine.py pakai path hardcoded "api/data/asperssi/" relatif ke
# repo. Artinya upload via admin endpoint saat ini HANYA bertahan sampai
# redeploy berikutnya (beda dari loyalty/promo/cad yang sudah persisten di
# volume). Pindah ke SQLite-di-volume justru MEMPERBAIKI ini, bukan migrasi
# netral. Struktur data itu sendiri SESUAI asumsi awal (tidak ada
# discrepancy), confirmed dari api/data/asperssi/*.json.

class ShareProvinsi(Base):
    """1 baris per (provinsi, periode). metadata-level (sumber/deskripsi/
    satuan) di file asli statis/re-derivable — tidak dipersist sebagai tabel."""
    __tablename__ = "share_provinsi"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    provinsi           = Column(String, nullable=False, index=True)
    periode            = Column(String, nullable=False)  # "YYYY-MM"
    share_nasional_pct = Column(Float, nullable=False)
    tersedia           = Column(Boolean, nullable=False, default=True)

    __table_args__ = (UniqueConstraint("provinsi", "periode", name="uq_share_provinsi_periode"),)


class MarketShareBrand(Base):
    """1 baris per (provinsi, periode) — banyak brand di dalamnya via
    MarketShareBrandDetail, sesuai struktur asli (data[].brands[])."""
    __tablename__ = "marketshare_brand"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    provinsi = Column(String, nullable=False, index=True)
    periode  = Column(String, nullable=False)  # "YYYY-MM"
    tersedia = Column(Boolean, nullable=False, default=True)

    brands = relationship("MarketShareBrandDetail", back_populates="entry", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("provinsi", "periode", name="uq_ms_brand_periode"),)


class MarketShareBrandDetail(Base):
    __tablename__ = "marketshare_brand_detail"

    id                    = Column(Integer, primary_key=True, autoincrement=True)
    marketshare_brand_id  = Column(Integer, ForeignKey("marketshare_brand.id"), nullable=False, index=True)
    nama                  = Column(String, nullable=False)
    market_share_pct      = Column(Float, nullable=False)
    is_own_brand          = Column(Boolean, nullable=False, default=False)
    is_aggregate_others   = Column(Boolean, nullable=False, default=False)

    entry = relationship("MarketShareBrand", back_populates="brands")


class AsperssiMeta(Base):
    """metadata.last_updated dari file asli (timestamp upload eksplisit,
    BUKAN derivable dari data — beda dari sumber/deskripsi/satuan yang
    statis dan periode_tersedia yang selalu di-derive ulang di
    get_asperssi_coverage()). 1 baris per dataset ('share_provinsi' atau
    'marketshare_brand'), ditambahkan Tahap 4d (audit competitor.py)."""
    __tablename__ = "asperssi_meta"

    dataset      = Column(String, primary_key=True)
    last_updated = Column(DateTime, nullable=True)


# ── ORACLE Phase 2.5 — Agentic (isolated dari tabel produksi) ────────────────
#
# Prinsip: write operations ORACLE HANYA ke tabel-tabel di bawah ini. Draft
# yang sudah di-approve user ditulis ke tabel produksi (Promo/CADAlert/dst)
# lewat endpoint router yang sudah ada — bukan dari sini langsung.

class OracleDraft(Base):
    """Draft hasil kerja ORACLE (program promo/skenario ILP/laporan/
    rekomendasi) — TIDAK PERNAH otomatis masuk ke tabel produksi, harus
    di-approve user dulu (lihat POST /api/oracle/agent/drafts/{id}/approve)."""
    __tablename__ = "oracle_drafts"

    id              = Column(String, primary_key=True)
    draft_type      = Column(String, nullable=False)  # program_promo | ilp_scenario | laporan | rekomendasi
    title           = Column(String, nullable=False)
    content_json    = Column(JSON, nullable=False)
    source_analysis = Column(String, nullable=True)
    status          = Column(String, nullable=False, default="pending_review")  # pending_review|approved|rejected|expired
    created_by      = Column(String, nullable=False, default="oracle")
    reviewed_by     = Column(String, nullable=True)
    reviewed_at     = Column(DateTime, nullable=True)
    review_notes    = Column(String, nullable=True)
    created_at      = Column(DateTime, server_default=func.now())
    expires_at      = Column(DateTime, nullable=True)


class OracleNotification(Base):
    """Notifikasi proaktif ORACLE (daily briefing, anomaly, deadline, dst)."""
    __tablename__ = "oracle_notifications"

    id                = Column(String, primary_key=True)
    notif_type        = Column(String, nullable=False)  # daily_briefing|anomaly_alert|deadline_warning|budget_warning|performance_drop
    title             = Column(String, nullable=False)
    summary           = Column(String, nullable=False)
    detail_json       = Column(JSON, nullable=True)
    severity          = Column(String, nullable=False, default="info")  # info|warning|critical
    is_read           = Column(Boolean, nullable=False, default=False)
    is_dismissed      = Column(Boolean, nullable=False, default=False)
    related_module    = Column(String, nullable=True)
    related_entity_id = Column(String, nullable=True)
    created_at        = Column(DateTime, server_default=func.now())


class OracleSession(Base):
    """Saved conversation session — riwayat percakapan ORACLE yang disimpan
    user secara eksplisit (bukan auto-save tiap percakapan)."""
    __tablename__ = "oracle_sessions"

    id                 = Column(String, primary_key=True)
    title              = Column(String, nullable=False)
    summary            = Column(String, nullable=True)
    history_json       = Column(JSON, nullable=False)
    page_context_json  = Column(JSON, nullable=True)
    model_stats_json   = Column(JSON, nullable=True)
    total_tokens_used  = Column(Integer, nullable=False, default=0)
    created_at         = Column(DateTime, server_default=func.now())
    updated_at         = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OracleTask(Base):
    """Tracking progress agentic task (multi-step analysis, validasi CAD
    batch, dll) — dipakai frontend untuk polling/streaming status."""
    __tablename__ = "oracle_tasks"

    id              = Column(String, primary_key=True)
    task_type       = Column(String, nullable=False)  # cad_validation|multi_step_analysis|daily_briefing|draft_creation
    task_name       = Column(String, nullable=False)
    status          = Column(String, nullable=False, default="running")  # running|completed|failed|cancelled|awaiting_approval
    steps_total     = Column(Integer, nullable=False, default=0)
    steps_completed = Column(Integer, nullable=False, default=0)
    current_step    = Column(String, nullable=True)
    result_json     = Column(JSON, nullable=True)
    error_message   = Column(String, nullable=True)
    triggered_by    = Column(String, nullable=False, default="user")  # user|scheduler|oracle_proactive
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OracleCadVerdict(Base):
    """Hasil validasi ORACLE untuk satu CAD Alert (kabupaten, bukan toko
    individual — lihat CADAlert.id format 'CAD-YYYYMMDD-KABUPATEN'). Verdict
    ini TIDAK otomatis mengubah CADAlert.status_resolusi — user_decision
    diisi lewat endpoint approve/override, baru itu yang menyentuh tabel
    cad_alerts produksi."""
    __tablename__ = "oracle_cad_verdicts"

    id                   = Column(String, primary_key=True)
    cad_id               = Column(String, ForeignKey("cad_alerts.id"), nullable=False, unique=True, index=True)
    verdict              = Column(String, nullable=False)  # genuine_threat|false_alarm|needs_review
    confidence_score     = Column(Float, nullable=False)
    evidence_json        = Column(JSON, nullable=False)
    recommendations_json = Column(JSON, nullable=True)
    model_used           = Column(String, nullable=True)
    analyzed_at          = Column(DateTime, server_default=func.now())
    user_decision        = Column(String, nullable=True)  # confirmed|overridden|dismissed
    user_notes           = Column(String, nullable=True)
    decided_at           = Column(DateTime, nullable=True)

"""
SQLAlchemy models — TAHAP DESAIN, belum dipakai router/endpoint apa pun.

Struktur berikut diverifikasi langsung dari kode penulis JSON yang
sebenarnya (api/routers/loyalty.py, promo.py, api/core/cad_storage.py,
competitor_engine.py) dan dari live API production — BUKAN dari asumsi.
Lihat catatan "PERBEDAAN DARI ASUMSI AWAL" di setiap model yang relevan.
"""
from __future__ import annotations

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

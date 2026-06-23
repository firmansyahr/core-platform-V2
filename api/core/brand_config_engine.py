"""
Resolusi Brand Configuration per wilayah untuk Loyalty Program.

Hierarki (paling spesifik → paling umum):
  1. Baris kabupaten   (provinsi=X, kabupaten=Y)
  2. Baris provinsi     (provinsi=X, kabupaten=None)
  3. Baris default global tersimpan di DB (provinsi=None, kabupaten=None)
  4. DEFAULT_CONFIG hardcoded — fallback terakhir kalau tidak ada baris
     apa pun yang cocok (termasuk kalau tabel masih kosong).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from api.models import BrandConfig

DEFAULT_CONFIG: dict = {
    # Casing harus sama dengan kolom "Brands" di data transaksi (semua
    # UPPERCASE — lihat aegis_engine.FIGHTING_BRAND = "SEMEN BANTENG"),
    # bukan title-case, supaya matching brand di get_brand_reward_multiplier()
    # tidak diam-diam gagal.
    "mb_brands": ["SEMEN ELANG"],
    "cb_brands": ["SEMEN BADAK"],
    "fb_brands": ["SEMEN BANTENG"],
    "source": "default",
}


def _row_to_config(row: BrandConfig, source: str) -> dict:
    config = {
        "mb_brands": row.mb_brands,
        "cb_brands": row.cb_brands,
        "fb_brands": row.fb_brands,
        "source": source,
    }
    if row.provinsi is not None:
        config["provinsi"] = row.provinsi
    if row.kabupaten is not None:
        config["kabupaten"] = row.kabupaten
    return config


def get_brand_config_for_toko(
    provinsi: str,
    kabupaten: str,
    db: Session | None = None,
) -> dict:
    """Resolve brand config untuk toko berdasarkan hierarki kabupaten → provinsi → default."""
    if db is None:
        return dict(DEFAULT_CONFIG)

    config_kab = db.query(BrandConfig).filter(
        BrandConfig.provinsi == provinsi,
        BrandConfig.kabupaten == kabupaten,
    ).first()
    if config_kab:
        return _row_to_config(config_kab, "kabupaten")

    config_prov = db.query(BrandConfig).filter(
        BrandConfig.provinsi == provinsi,
        BrandConfig.kabupaten.is_(None),
    ).first()
    if config_prov:
        return _row_to_config(config_prov, "provinsi")

    config_global = db.query(BrandConfig).filter(
        BrandConfig.provinsi.is_(None),
        BrandConfig.kabupaten.is_(None),
    ).first()
    if config_global:
        return _row_to_config(config_global, "default")

    return dict(DEFAULT_CONFIG)


def get_all_brands_for_toko(provinsi: str, kabupaten: str, db: Session | None = None) -> list[str]:
    """Return semua brand yang dihitung untuk toko ini (MB + CB + FB)."""
    config = get_brand_config_for_toko(provinsi, kabupaten, db)
    all_brands = config["mb_brands"] + config["cb_brands"] + config["fb_brands"]
    return list(dict.fromkeys(all_brands))  # dedupe, preserve order


def get_brand_reward_multiplier(
    brand: str,
    provinsi: str,
    kabupaten: str,
    db: Session | None = None,
) -> float:
    """
    Reward multiplier untuk brand tertentu di wilayah ini.
    MB = 1.0 (100%), CB = 0.5 (50%), FB = 0.5 (50%).
    Brand di luar ketiga kategori = 0.0 (tidak dihitung).
    """
    config = get_brand_config_for_toko(provinsi, kabupaten, db)

    if brand in config["mb_brands"]:
        return 1.0
    if brand in config["cb_brands"]:
        return 0.5
    if brand in config["fb_brands"]:
        return 0.5
    return 0.0

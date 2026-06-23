"""
Loyalty-only, BrandConfig-aware volume/cost calculation.

Sengaja DIPISAH dari compute_ilp_features() (ilp_engine.py) — optimizer ILP
(/api/ilp/run, solve_ilp(), apply_ilp_scoring()) TIDAK disentuh sama sekali
dan tetap memakai logic hardcoded Elang/Badak-Serbaguna miliknya sendiri.
Modul ini HANYA dikonsumsi oleh api/routers/loyalty.py dan
api/core/loyalty_engine.py.

Output kolom (avg_ton, avg_ton_elang, avg_ton_badak, estimated_cost) IDENTIK
dengan compute_ilp_features() supaya caller bisa swap sumber data tanpa
mengubah kode yang membaca hasilnya.

Known limitation: BrandConfig hanya mengontrol nama brand, bukan product
line — SEMEN BADAK tetap dibatasi ke varian SERBAGUNA sebagai special case
hardcoded di sini, sama seperti _ilp_mask() di ilp_engine.py.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy.orm import Session

from api.core.brand_config_engine import get_brand_config_for_toko
from api.models import LoyaltyConfig

_SERBAGUNA_FILTER = "SERBAGUNA"
_DEFAULT_BASE_RATE = 5_000.0
_WINDOW_MONTHS = 6  # selaras dengan ilp_engine.ILP_MONTHS

_EMPTY_COLUMNS = ["ID Toko", "avg_ton", "avg_ton_elang", "avg_ton_badak", "estimated_cost"]


def _get_base_rate(db: Session | None) -> float:
    """rate dasar (Rp/ton) untuk MB — CB/FB dapat persentase dari nilai ini
    (lihat get_brand_reward_multiplier). Sumber: LoyaltyConfig.default_point_value,
    fallback 5000 kalau db None atau row belum ada — sama dengan default kolomnya."""
    if db is not None:
        cfg = db.query(LoyaltyConfig).filter_by(id="default").first()
        if cfg is not None:
            return float(cfg.default_point_value)
    return _DEFAULT_BASE_RATE


def _is_badak_serbaguna(df: pd.DataFrame) -> pd.Series:
    return (
        df["Nama Produk"].str.upper().str.replace(" ", "", regex=False)
        .str.contains(_SERBAGUNA_FILTER, na=False)
    )


def compute_loyalty_features(
    df_transaksi: pd.DataFrame,
    store_ids: set[str] | list[str],
    db: Session | None = None,
) -> pd.DataFrame:
    """
    Hitung avg_ton/avg_ton_elang/avg_ton_badak/estimated_cost untuk store_ids
    yang diminta, berdasarkan brand config wilayah yang berlaku per toko
    (kabupaten -> provinsi -> default).

    Dikelompokkan per (Provinsi Toko, Kabupaten Toko) supaya resolusi brand
    config query DB sekali per kombinasi wilayah, bukan sekali per toko.

    Provinsi/kabupaten toko diambil dari TRANSAKSI APA PUN milik toko itu
    (bukan dari ilp_idx lama yang cuma mencakup toko dengan transaksi
    Elang/Badak) — toko yang wilayahnya pakai brand lain via BrandConfig
    tetap perlu resolusi region ini.
    """
    store_ids = {str(s) for s in store_ids}
    if not store_ids or df_transaksi is None or df_transaksi.empty:
        return pd.DataFrame(columns=_EMPTY_COLUMNS)

    # "latest" HARUS dari seluruh dataset (sama seperti compute_ilp_features()),
    # bukan dari df yang sudah difilter ke store_ids — toko tertentu bisa saja
    # transaksi terakhirnya lebih lama dari periode global, yang akan
    # menggeser window 6 bulannya secara diam-diam kalau dihitung per-toko.
    period_col_all = df_transaksi["Tanggal Transaksi"].dt.to_period("M")
    latest = period_col_all.max()
    window_periods = [latest - i for i in range(_WINDOW_MONTHS)]

    df = df_transaksi[
        df_transaksi["ID Toko"].isin(store_ids) & period_col_all.isin(window_periods)
    ].copy()
    if df.empty:
        return pd.DataFrame(columns=_EMPTY_COLUMNS)
    df["_period"] = period_col_all[df.index]

    meta = (
        df.sort_values("Tanggal Transaksi", ascending=False)
        .drop_duplicates("ID Toko")
        .set_index("ID Toko")[["Provinsi Toko", "Kabupaten Toko"]]
    )

    base_rate = _get_base_rate(db)
    results: list[dict] = []

    for (provinsi, kabupaten), group_meta in meta.groupby(["Provinsi Toko", "Kabupaten Toko"]):
        group_ids = group_meta.index.tolist()
        brand_config = get_brand_config_for_toko(provinsi, kabupaten, db)

        multiplier_by_brand: dict[str, float] = {}
        for b in brand_config["mb_brands"]:
            multiplier_by_brand[b] = 1.0
        for b in brand_config["cb_brands"]:
            multiplier_by_brand.setdefault(b, 0.5)
        for b in brand_config["fb_brands"]:
            multiplier_by_brand.setdefault(b, 0.5)

        if not multiplier_by_brand:
            results.extend(
                {"ID Toko": sid, "avg_ton": 0.0, "avg_ton_elang": 0.0, "avg_ton_badak": 0.0, "estimated_cost": 0.0}
                for sid in group_ids
            )
            continue

        sub = df[df["ID Toko"].isin(group_ids) & df["Brands"].isin(multiplier_by_brand.keys())]
        if "SEMEN BADAK" in multiplier_by_brand:
            is_badak = sub["Brands"] == "SEMEN BADAK"
            sub = sub[~is_badak | _is_badak_serbaguna(sub)]

        if sub.empty:
            results.extend(
                {"ID Toko": sid, "avg_ton": 0.0, "avg_ton_elang": 0.0, "avg_ton_badak": 0.0, "estimated_cost": 0.0}
                for sid in group_ids
            )
            continue

        # avg_ton (total) = rata-rata TON gabungan SEMUA brand per periode,
        # dibagi jumlah periode yang punya transaksi APA PUN (denominator
        # tunggal) — BUKAN sum dari avg_ton_elang+avg_ton_badak, karena
        # masing-masing brand bisa punya jumlah periode aktif yang berbeda
        # (sama seperti compute_ilp_features() lama: avg_ton dihitung dari
        # total gabungan per periode, avg_ton_elang/avg_ton_badak dihitung
        # terpisah per brand — dua denominator yang berbeda, intentional).
        combined_monthly = (
            sub.groupby(["ID Toko", "_period"])["TON Quantity"].sum()
            .groupby("ID Toko").mean()
            .reindex(index=group_ids, fill_value=0)
        )

        brand_mon = (
            sub.groupby(["ID Toko", "Brands", "_period"])["TON Quantity"]
            .sum()
            .groupby(["ID Toko", "Brands"])
            .mean()
            .unstack("Brands", fill_value=0)
            .reindex(index=group_ids, fill_value=0)
        )

        mb_brands    = [b for b in brand_config["mb_brands"] if b in brand_mon.columns]
        cb_fb_brands = [b for b in (brand_config["cb_brands"] + brand_config["fb_brands"]) if b in brand_mon.columns]

        avg_ton_total = combined_monthly
        avg_ton_elang = brand_mon[mb_brands].sum(axis=1) if mb_brands else pd.Series(0.0, index=brand_mon.index)
        avg_ton_badak = brand_mon[cb_fb_brands].sum(axis=1) if cb_fb_brands else pd.Series(0.0, index=brand_mon.index)

        cost = pd.Series(0.0, index=brand_mon.index)
        for brand, multiplier in multiplier_by_brand.items():
            if brand in brand_mon.columns:
                cost = cost + brand_mon[brand] * base_rate * multiplier

        for sid in group_ids:
            results.append({
                "ID Toko":        sid,
                "avg_ton":        round(float(avg_ton_total.get(sid, 0.0)), 2),
                "avg_ton_elang":  round(float(avg_ton_elang.get(sid, 0.0)), 2),
                "avg_ton_badak":  round(float(avg_ton_badak.get(sid, 0.0)), 2),
                "estimated_cost": round(float(cost.get(sid, 0.0)) * 12, 2),
            })

    return pd.DataFrame(results, columns=_EMPTY_COLUMNS)

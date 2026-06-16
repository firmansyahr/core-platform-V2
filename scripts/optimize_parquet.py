import pandas as pd
from pathlib import Path

INPUT = Path("data/transaksi_sample_deploy.parquet")
OUTPUT = Path("data/transaksi_sample_deploy.parquet")

print("Loading...")
df = pd.read_parquet(INPUT)
before = df.memory_usage(deep=True).sum() / 1024 / 1024
print(f"Sebelum: {before:.1f} MB")

CATEGORY_COLS = [
    'ID Toko', 'Nama Toko', 'Cluster Pareto', 'Tipe Customer',
    'Provinsi Toko', 'Area AP Toko', 'Area Toko', 'Kabupaten Toko',
    'Brands', 'Nama Produk', 'Kode Produk', 'UOM 1', 'UOM 2',
    'TSO', 'ASM', 'SSM'
]

for col in CATEGORY_COLS:
    if col in df.columns:
        df[col] = df[col].astype('category')

df['Harga'] = df['Harga'].astype('int32')
df['TON Quantity'] = df['TON Quantity'].astype('float32')
df['Zak Quantity'] = df['Zak Quantity'].astype('float32')

after = df.memory_usage(deep=True).sum() / 1024 / 1024
print(f"Sesudah: {after:.1f} MB")
print(f"Hemat  : {before - after:.1f} MB ({(before-after)/before*100:.1f}%)")

df.to_parquet(OUTPUT, compression='snappy', index=False)
print(f"File size: {OUTPUT.stat().st_size/1024/1024:.1f} MB")
print("Done!")

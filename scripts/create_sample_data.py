import pandas as pd
import numpy as np
from pathlib import Path

df = pd.read_parquet('data/transaksi_aegis_synthetic.parquet')
df['Tanggal Transaksi'] = pd.to_datetime(df['Tanggal Transaksi'])

toko_stats = df.groupby('ID Toko').agg(
    ton_total=('TON Quantity', 'sum'),
    ton_fighting=('TON Quantity', lambda x: x[
        df.loc[x.index, 'Brands'].str.contains('BANTENG', na=False)
    ].sum()),
    cluster_pareto=('Cluster Pareto', 'first'),
).reset_index()

toko_stats['fbsi'] = (toko_stats['ton_fighting'] /
    toko_stats['ton_total'].replace(0, np.nan) * 100).fillna(0)
toko_stats['kondisi'] = pd.cut(
    toko_stats['fbsi'],
    bins=[-1, 10, 20, 35, 100],
    labels=['Normal', 'Kuning', 'Oranye', 'Merah']
)

def safe_sample(x, frac=0.25):
    n = max(1, min(int(len(x) * frac), len(x)))
    return x.sample(n=n, random_state=42)

sampled_toko = (toko_stats
    .groupby(['cluster_pareto', 'kondisi'], group_keys=False)
    .apply(safe_sample)
    .reset_index(drop=True))

print(f'Toko setelah sampling: {len(sampled_toko):,}')

selected_ids = set(sampled_toko['ID Toko'])
df_sample = df[df['ID Toko'].isin(selected_ids)].reset_index(drop=True)

KEEP_COLS = [
    'Tanggal Transaksi', 'ID Toko', 'Nama Toko', 'Cluster Pareto',
    'Tipe Customer', 'Provinsi Toko', 'Area AP Toko', 'Area Toko',
    'Kabupaten Toko', 'Brands', 'Nama Produk', 'Kode Produk',
    'TON Quantity', 'Zak Quantity', 'Harga', 'UOM 1', 'UOM 2',
    'TSO', 'ASM', 'SSM', 'No Transaksi'
]
cols = [c for c in KEEP_COLS if c in df_sample.columns]
df_sample = df_sample[cols]

print(f'Baris     : {len(df_sample):,}')
print(f'Toko unik : {df_sample["ID Toko"].nunique():,}')
print(f'Memory    : {df_sample.memory_usage(deep=True).sum()/1024/1024:.1f} MB')

df_sample.to_parquet('data/transaksi_sample_deploy.parquet', compression='snappy')
print(f'File size : {Path("data/transaksi_sample_deploy.parquet").stat().st_size/1024/1024:.1f} MB')

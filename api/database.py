import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


def _resolve_db_path() -> str:
    """
    Logic SAMA seperti _get_data_dir() yang sudah dipakai loyalty.py,
    promo.py, dan cad_storage.py — cek /mnt/data (Railway Volume
    "web-volume") dulu, fallback ke api/data untuk development lokal.
    Subfolder "app_data" diverifikasi sama persis dengan ketiga file
    tersebut (bukan asumsi).
    """
    volume_path = "/mnt/data"
    if os.path.exists(volume_path) and os.access(volume_path, os.W_OK):
        db_dir = os.path.join(volume_path, "app_data")
        os.makedirs(db_dir, exist_ok=True)
        return os.path.join(db_dir, "core_platform.db")
    else:
        db_dir = "api/data"
        os.makedirs(db_dir, exist_ok=True)
        return os.path.join(db_dir, "core_platform.db")


DB_PATH = _resolve_db_path()
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_add_columns_if_missing() -> None:
    """Tambah kolom yang dibuat setelah skema awal (create_all tidak ALTER
    tabel yang sudah ada). Idempotent — aman dijalankan berulang kali.
    Tidak dipanggil otomatis di startup app (lihat init_db() — pola di
    proyek ini adalah migrasi dijalankan manual via script, bukan auto-run),
    jalankan manual lewat railway ssh saat kolom baru ditambahkan."""
    import sqlite3
    migrations = [
        ("cad_validasi_toko", "nama_toko", "TEXT"),
        ("promos", "brand_selection_mode", "TEXT"),
        ("promos", "brands", "JSON"),
        ("promos", "brand_selection_json", "TEXT"),
    ]
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        for table, column, col_type in migrations:
            cursor.execute(f"PRAGMA table_info({table})")
            existing_columns = [row[1] for row in cursor.fetchall()]
            if not existing_columns:
                # PRAGMA table_info() pada tabel yang tidak ada return EMPTY
                # (bukan error) — tanpa cek ini, ALTER TABLE di bawah akan
                # gagal dengan "no such table" dan menghentikan SISA migrasi
                # dalam list ini juga (satu connection, satu try block).
                print(f"[migration] Skip {table}.{column} — tabel {table} tidak ada")
                continue
            if column not in existing_columns:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
                print(f"[migration] Added column {column} to {table}")
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    import api.models  # noqa: F401  registers models on Base.metadata
    Base.metadata.create_all(bind=engine)
    migrate_add_columns_if_missing()
    print(f"[database] Initialized at {DB_PATH}")

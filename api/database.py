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


def init_db() -> None:
    import api.models  # noqa: F401  registers models on Base.metadata
    Base.metadata.create_all(bind=engine)
    print(f"[database] Initialized at {DB_PATH}")

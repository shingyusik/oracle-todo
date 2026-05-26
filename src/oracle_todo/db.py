from __future__ import annotations

from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from .paths import db_path, todo_home


def get_engine(path: Path | None = None):
    path = path or db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})


def init_db(path: Path | None = None) -> Path:
    path = path or db_path()
    todo_home().mkdir(parents=True, exist_ok=True)
    engine = get_engine(path)
    SQLModel.metadata.create_all(engine)
    _ensure_items_columns(engine)
    return path


def _ensure_items_columns(engine) -> None:
    """Add v1 additive columns when an existing SQLite DB predates them."""
    inspector = inspect(engine)
    if "items" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("items")}
    additions = {
        "materialization_policy": "TEXT NOT NULL DEFAULT 'single_open'",
        "occurrence_key": "TEXT",
        "last_materialized_at": "DATETIME",
    }
    with engine.begin() as conn:
        for name, ddl in additions.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE items ADD COLUMN {name} {ddl}"))


def session_for(path: Path | None = None) -> Session:
    init_db(path)
    return Session(get_engine(path))

from __future__ import annotations

from pathlib import Path

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
    return path


def session_for(path: Path | None = None) -> Session:
    init_db(path)
    return Session(get_engine(path))

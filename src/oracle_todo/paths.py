from __future__ import annotations

import os
from pathlib import Path


def todo_home() -> Path:
    return Path(os.environ.get("ORACLE_TODO_HOME", "~/.hermes/oracle-todo")).expanduser()


def db_path() -> Path:
    return todo_home() / "todo.sqlite"


def exports_dir() -> Path:
    return todo_home() / "exports"


def events_jsonl_path() -> Path:
    return todo_home() / "events.jsonl"

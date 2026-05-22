#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from sqlmodel import select

from oracle_todo.db import init_db, session_for
from oracle_todo.models import Actor, ItemType, TodoItem
from oracle_todo.service import TodoService

DEFAULT_SOURCE = Path("/Users/singyusig/Desktop/01_Obsidian/Main/01_Life_Planner/00_Todo_Master.md")
DEFAULT_HOME = Path("/Users/singyusig/.hermes/oracle-todo")

AREA_BY_TAG = {
    "일상": "생활/환경",
    "자기관리": "건강",
    "미용": "건강",
    "취미": "창작/취미",
    "자기개발": "지식/학습",
    "기록": "지식/학습",
    "e8ight": "일/커리어",
    "행정": "일/커리어",
}

AREA_BY_TITLE_KEYWORD = {
    "가계부": "재정",
    "연금": "재정",
    "돈": "재정",
    "월세": "재정",
    "관리비": "재정",
}

DEFAULT_AREAS = ["생활/환경", "건강", "창작/취미", "지식/학습", "일/커리어", "재정"]


@dataclass
class MigratedCandidate:
    kind: str
    title: str
    area: str
    recurrence_rule: str | None
    due: str | None
    priority: int | None
    raw: str


def unchecked_task_lines(text: str) -> list[str]:
    return [m.group(1).strip() for m in re.finditer(r"(?m)^\s*[-*]\s+\[ \]\s+(.*)$", text)]


def parse_priority(raw: str) -> int | None:
    if "⏫" in raw:
        return 1
    if "🔼" in raw:
        return 2
    if "🔽" in raw:
        return 4
    return None


def parse_due(raw: str) -> str | None:
    m = re.search(r"⏳\s*(\d{4}-\d{2}-\d{2})", raw)
    return m.group(1) if m else None


def parse_recurrence(raw: str) -> str | None:
    m = re.search(r"🔁\s*(.*?)(?:\s+[⏳🔼🔽⏫]|$)", raw)
    return m.group(1).strip() if m else None


def parse_tags(raw: str) -> list[str]:
    return [t for t in re.findall(r"(?<!\w)#([\w가-힣_/-]+)", raw) if t != "task"]


def clean_title(raw: str) -> str:
    title = re.sub(r"#task\b", "", raw).strip()
    title = re.sub(r"(?<!\w)#[\w가-힣_/-]+", "", title)
    title = re.sub(r"[⏫🔼🔽]", "", title)
    title = re.sub(r"🔁\s*.*", "", title)
    title = re.sub(r"⏳\s*\d{4}-\d{2}-\d{2}", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def infer_area(title: str, tags: Iterable[str]) -> str:
    for keyword, area in AREA_BY_TITLE_KEYWORD.items():
        if keyword in title:
            return area
    for tag in tags:
        if tag in AREA_BY_TAG:
            return AREA_BY_TAG[tag]
    return "생활/환경"


def parse_candidate(raw: str) -> MigratedCandidate | None:
    title = clean_title(raw)
    if not title:
        return None
    recurrence = parse_recurrence(raw)
    tags = parse_tags(raw)
    return MigratedCandidate(
        kind="routine" if recurrence else "task",
        title=title,
        area=infer_area(title, tags),
        recurrence_rule=recurrence,
        due=parse_due(raw),
        priority=parse_priority(raw),
        raw=raw,
    )


def parse_source(path: Path) -> list[MigratedCandidate]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    candidates = []
    seen: set[tuple[str, str, str | None]] = set()
    for raw in unchecked_task_lines(text):
        candidate = parse_candidate(raw)
        if not candidate:
            continue
        key = (candidate.kind, candidate.title, candidate.recurrence_rule)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(candidate)
    return candidates


def existing_titles(service: TodoService) -> set[tuple[str, str]]:
    stmt = select(TodoItem.type, TodoItem.title)
    return {(type_.value if hasattr(type_, "value") else str(type_), title) for type_, title in service.session.exec(stmt).all()}


def ensure_areas(service: TodoService, area_names: Iterable[str], *, apply: bool) -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for area in sorted(set(area_names)):
        try:
            result[area] = service.find_area(area)
        except KeyError:
            if apply:
                result[area] = service.create_area(area, actor=Actor.USER, review_cycle="weekly").id
            else:
                result[area] = None
    return result


def migrate(candidates: list[MigratedCandidate], *, home: Path, apply: bool, limit: int | None = None) -> dict:
    os.environ["ORACLE_TODO_HOME"] = str(home)
    init_db(home / "todo.sqlite")
    service = TodoService(session_for(home / "todo.sqlite"), events_path=home / "events.jsonl")
    selected = candidates[:limit] if limit else candidates
    areas = ensure_areas(service, [*DEFAULT_AREAS, *(c.area for c in selected)], apply=apply)
    exists = existing_titles(service)
    created = []
    skipped = []
    for candidate in selected:
        type_value = ItemType.ROUTINE.value if candidate.kind == "routine" else ItemType.TASK.value
        if (type_value, candidate.title) in exists:
            skipped.append({**asdict(candidate), "reason": "duplicate title/type"})
            continue
        if not apply:
            created.append(asdict(candidate))
            continue
        area_ref = areas.get(candidate.area) or candidate.area
        if candidate.kind == "routine":
            item = service.propose_routine(candidate.title, area=area_ref, actor=Actor.ORACLE, recurrence_rule=candidate.recurrence_rule)
        else:
            item = service.propose_task(candidate.title, area=area_ref, actor=Actor.ORACLE, due=candidate.due, priority=candidate.priority)
        created.append({**asdict(candidate), "id": item.id, "status": item.status.value})
        exists.add((type_value, candidate.title))
    run = {
        "mode": "apply" if apply else "dry-run",
        "at": datetime.now(timezone.utc).isoformat(),
        "home": str(home),
        "selected": len(selected),
        "areas": areas,
        "created_or_planned": created,
        "skipped": skipped,
        "counts": {
            "planned_or_created": len(created),
            "skipped": len(skipped),
            "routines": sum(1 for c in created if c["kind"] == "routine"),
            "tasks": sum(1 for c in created if c["kind"] == "task"),
        },
    }
    if apply:
        out_dir = home / "migration-runs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"main-todo-master-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        out.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
        run["manifest"] = str(out)
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate active unchecked Main vault Todo Master tasks through the oracle-todo service layer.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    candidates = parse_source(args.source)
    result = migrate(candidates, home=args.home, apply=args.apply, limit=args.limit)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

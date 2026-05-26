from __future__ import annotations

from datetime import date
from pathlib import Path

from .models import ItemStatus, ItemType, TodoItem
from .paths import exports_dir


def _checkbox(item: TodoItem) -> str:
    return "x" if item.status == ItemStatus.COMPLETED else " "


def render_items(title: str, items: list[TodoItem]) -> str:
    lines = [f"# {title}", ""]
    if not items:
        lines.append("_없음_")
        return "\n".join(lines) + "\n"
    for item in items:
        meta = [item.type.value, item.status.value]
        if item.due:
            meta.append(f"due:{item.due}")
        if item.scheduled:
            meta.append(f"scheduled:{item.scheduled}")
        if item.area_id:
            meta.append(f"area:{item.area_id}")
        location = item.metadata_.get("location")
        if location:
            meta.append(f"location:{location}")
        participants = item.metadata_.get("participants")
        if isinstance(participants, list) and participants:
            meta.append(f"with:{','.join(str(p) for p in participants)}")
        lines.append(f"- [{_checkbox(item)}] **{item.title}** `{' '.join(meta)}`")
        if item.description:
            lines.append(f"  - {item.description}")
    return "\n".join(lines) + "\n"


def _scheduled_day(value: str | None) -> date | None:
    if not value or value == "today":
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def today_tasks(items: list[TodoItem], *, today: date | None = None) -> list[TodoItem]:
    today = today or date.today()
    visible_statuses = {ItemStatus.PROPOSED, ItemStatus.APPROVED, ItemStatus.ACTIVE}
    out: list[TodoItem] = []
    for item in items:
        if item.type != ItemType.TASK or item.status not in visible_statuses:
            continue
        if item.scheduled in {None, "today"}:
            out.append(item)
            continue
        scheduled_day = _scheduled_day(item.scheduled)
        if scheduled_day is not None and scheduled_day <= today:
            out.append(item)
    return out


def write_exports(items: list[TodoItem], out_dir: Path | None = None, *, today: date | None = None) -> list[Path]:
    out_dir = out_dir or exports_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    activeish = [i for i in items if i.status not in {ItemStatus.ARCHIVED, ItemStatus.CANCELLED, ItemStatus.DROPPED}]
    views = {
        "today.md": today_tasks(activeish, today=today),
        "events.md": [i for i in activeish if i.type == ItemType.EVENT],
        "projects.md": [i for i in activeish if i.type == ItemType.PROJECT],
        "areas.md": [i for i in activeish if i.type == ItemType.AREA],
        "routines.md": [i for i in activeish if i.type == ItemType.ROUTINE],
        "proposed.md": [i for i in items if i.status == ItemStatus.PROPOSED],
        "archive.md": [i for i in items if i.status in {ItemStatus.ARCHIVED, ItemStatus.COMPLETED, ItemStatus.DROPPED, ItemStatus.CANCELLED, ItemStatus.SOMEDAY}],
    }
    written = []
    for name, view_items in views.items():
        path = out_dir / name
        path.write_text(render_items(name.removesuffix(".md").title(), view_items), encoding="utf-8")
        written.append(path)
    return written

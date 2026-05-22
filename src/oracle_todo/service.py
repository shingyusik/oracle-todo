from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Optional

from sqlmodel import Session, select

from .models import Actor, ItemStatus, ItemType, TodoEvent, TodoItem, new_id, now_utc
from .paths import events_jsonl_path


class PolicyError(ValueError):
    pass


TERMINAL_STATUSES = {
    ItemStatus.COMPLETED,
    ItemStatus.CANCELLED,
    ItemStatus.DROPPED,
    ItemStatus.ARCHIVED,
    ItemStatus.SOMEDAY,
    ItemStatus.REJECTED,
}


class TodoService:
    def __init__(self, session: Session, events_path: Path | None = None):
        self.session = session
        self.events_path = events_path or events_jsonl_path()

    def _snapshot(self, item: TodoItem | None) -> dict | None:
        if item is None:
            return None
        return item.model_dump(mode="json")

    def _record_event(self, *, actor: Actor, action: str, item: TodoItem, before: dict | None, reason: str | None = None) -> None:
        event = TodoEvent(
            actor=actor,
            action=action,
            object_type=item.type.value,
            object_id=item.id,
            before=before,
            after=self._snapshot(item),
            reason=reason,
        )
        self.session.add(event)
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        with self.events_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event.model_dump(mode="json"), ensure_ascii=False, sort_keys=True) + "\n")

    def _commit_event(self, *, actor: Actor, action: str, item: TodoItem, before: dict | None = None, reason: str | None = None) -> TodoItem:
        item.updated_at = now_utc()
        self.session.add(item)
        self._record_event(actor=actor, action=action, item=item, before=before, reason=reason)
        self.session.commit()
        self.session.refresh(item)
        return item

    def get(self, item_id: str) -> TodoItem:
        item = self.session.get(TodoItem, item_id)
        if not item:
            raise KeyError(f"Item not found: {item_id}")
        return item

    def find_area(self, name_or_id: str | None) -> str | None:
        if not name_or_id:
            return None
        direct = self.session.get(TodoItem, name_or_id)
        if direct:
            if direct.type != ItemType.AREA:
                raise PolicyError(f"Not an area: {name_or_id}")
            return direct.id
        stmt = select(TodoItem).where(TodoItem.type == ItemType.AREA, TodoItem.title == name_or_id)
        item = self.session.exec(stmt).first()
        if not item:
            raise KeyError(f"Area not found: {name_or_id}")
        return item.id

    def create_area(self, title: str, *, actor: Actor = Actor.USER, review_cycle: str | None = None, standard: str | None = None) -> TodoItem:
        item = TodoItem(
            id=new_id("area"),
            type=ItemType.AREA,
            title=title,
            status=ItemStatus.ACTIVE,
            review_cycle=review_cycle,
            standard=standard,
            proposed_by=actor,
            approved_by=actor,
            approved_at=now_utc(),
        )
        return self._commit_event(actor=actor, action="create_area", item=item)

    def propose_project(self, title: str, *, area: str | None = None, actor: Actor = Actor.ORACLE, definition_of_done: str | None = None, outcome: str | None = None, due: str | None = None) -> TodoItem:
        item = TodoItem(
            id=new_id("proj"),
            type=ItemType.PROJECT,
            title=title,
            status=ItemStatus.PROPOSED if actor != Actor.USER else ItemStatus.APPROVED,
            area_id=self.find_area(area),
            definition_of_done=definition_of_done,
            outcome=outcome,
            due=due,
            proposed_by=actor,
            approved_by=Actor.USER if actor == Actor.USER else None,
            approved_at=now_utc() if actor == Actor.USER else None,
        )
        return self._commit_event(actor=actor, action="propose_project", item=item)

    def propose_routine(self, title: str, *, area: str | None = None, actor: Actor = Actor.ORACLE, recurrence_rule: str | None = None) -> TodoItem:
        item = TodoItem(
            id=new_id("rtn"),
            type=ItemType.ROUTINE,
            title=title,
            status=ItemStatus.PROPOSED if actor != Actor.USER else ItemStatus.APPROVED,
            area_id=self.find_area(area),
            recurrence_rule=recurrence_rule,
            proposed_by=actor,
            approved_by=Actor.USER if actor == Actor.USER else None,
            approved_at=now_utc() if actor == Actor.USER else None,
        )
        return self._commit_event(actor=actor, action="propose_routine", item=item)

    def propose_task(self, title: str, *, area: str | None = None, project_id: str | None = None, routine_id: str | None = None, actor: Actor = Actor.ORACLE, due: str | None = None, scheduled: str | None = None, priority: int | None = None, description: str | None = None) -> TodoItem:
        item = TodoItem(
            id=new_id("task"),
            type=ItemType.TASK,
            title=title,
            status=ItemStatus.PROPOSED if actor != Actor.USER else ItemStatus.APPROVED,
            area_id=self.find_area(area),
            project_id=project_id,
            routine_id=routine_id,
            due=due,
            scheduled=scheduled,
            priority=priority,
            description=description,
            proposed_by=actor,
            approved_by=Actor.USER if actor == Actor.USER else None,
            approved_at=now_utc() if actor == Actor.USER else None,
        )
        return self._commit_event(actor=actor, action="propose_task", item=item)

    def approve(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        if item.status not in {ItemStatus.PROPOSED, ItemStatus.APPROVED}:
            raise PolicyError(f"Cannot approve item in status {item.status}")
        item.status = ItemStatus.APPROVED
        item.approved_by = actor
        item.approved_at = now_utc()
        return self._commit_event(actor=actor, action="approve", item=item, before=before, reason=reason)

    def activate(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        if item.proposed_by != Actor.USER and not item.approved_at:
            raise PolicyError("Agent-created items must be approved before activation")
        if item.type == ItemType.PROJECT and not item.definition_of_done:
            raise PolicyError("Project requires definition_of_done before activation")
        if item.type == ItemType.ROUTINE and not item.recurrence_rule:
            raise PolicyError("Routine requires recurrence_rule before activation")
        if item.type == ItemType.AREA:
            raise PolicyError("Areas are ongoing and are active at creation; do not activate as work")
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"Cannot activate terminal item: {item.status}")
        item.status = ItemStatus.ACTIVE
        return self._commit_event(actor=actor, action="activate", item=item, before=before, reason=reason)

    def complete(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        if item.type == ItemType.AREA:
            raise PolicyError("Areas cannot be completed; pause or archive them")
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"Already terminal: {item.status}")
        item.status = ItemStatus.COMPLETED
        item.completed_at = now_utc()
        return self._commit_event(actor=actor, action="complete", item=item, before=before, reason=reason)

    def archive(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        item.status = ItemStatus.ARCHIVED
        item.archived_at = now_utc()
        return self._commit_event(actor=actor, action="archive", item=item, before=before, reason=reason)

    def list_items(self, *, status: str | None = None, type_: str | None = None, include_archived: bool = False) -> list[TodoItem]:
        stmt = select(TodoItem)
        if status:
            stmt = stmt.where(TodoItem.status == ItemStatus(status))
        elif not include_archived:
            stmt = stmt.where(TodoItem.status.not_in([ItemStatus.ARCHIVED, ItemStatus.DROPPED, ItemStatus.CANCELLED]))
        if type_:
            stmt = stmt.where(TodoItem.type == ItemType(type_))
        stmt = stmt.order_by(TodoItem.created_at.desc())
        return list(self.session.exec(stmt).all())

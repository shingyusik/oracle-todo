from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy import not_
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

    def _ensure_type(self, item_id: str | None, expected: ItemType, label: str) -> str | None:
        if not item_id:
            return None
        item = self.session.get(TodoItem, item_id)
        if not item:
            raise KeyError(f"{label} not found: {item_id}")
        if item.type != expected:
            raise PolicyError(f"{label} must be {expected.value}: {item_id}")
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"{label} is terminal: {item.status}")
        return item.id

    def find_area(self, name_or_id: str | None) -> str | None:
        if not name_or_id:
            return None
        direct = self.session.get(TodoItem, name_or_id)
        if direct:
            if direct.type != ItemType.AREA:
                raise PolicyError(f"Not an area: {name_or_id}")
            if direct.status in TERMINAL_STATUSES:
                raise PolicyError(f"Area is terminal: {name_or_id}")
            return direct.id
        stmt = select(TodoItem).where(TodoItem.type == ItemType.AREA, TodoItem.title == name_or_id)
        item = self.session.exec(stmt).first()
        if not item:
            raise KeyError(f"Area not found: {name_or_id}")
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"Area is terminal: {name_or_id}")
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

    def propose_routine(
        self,
        title: str,
        *,
        area: str | None = None,
        actor: Actor = Actor.ORACLE,
        recurrence_rule: str | None = None,
        materialization_policy: str = "single_open",
    ) -> TodoItem:
        if materialization_policy not in {"single_open", "per_occurrence"}:
            raise PolicyError(f"Unsupported materialization_policy: {materialization_policy}")
        item = TodoItem(
            id=new_id("rtn"),
            type=ItemType.ROUTINE,
            title=title,
            status=ItemStatus.PROPOSED if actor != Actor.USER else ItemStatus.APPROVED,
            area_id=self.find_area(area),
            recurrence_rule=recurrence_rule,
            materialization_policy=materialization_policy,
            proposed_by=actor,
            approved_by=Actor.USER if actor == Actor.USER else None,
            approved_at=now_utc() if actor == Actor.USER else None,
        )
        return self._commit_event(actor=actor, action="propose_routine", item=item)

    def _parse_day(self, value: str | date | datetime | None) -> date:
        if value is None:
            return now_utc().date()
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        return date.fromisoformat(value)

    def _occurrences(self, recurrence_rule: str, start: date, end: date) -> list[date]:
        rule = recurrence_rule.strip().lower()
        if rule in {"daily", "every day", "매일"}:
            step = timedelta(days=1)
        elif rule in {"weekly", "every week", "매주"}:
            step = timedelta(days=7)
        elif rule in {"monthly", "every month", "매월"}:
            current = start.replace(day=1)
            out = []
            while current <= end:
                if current >= start:
                    out.append(current)
                year = current.year + (1 if current.month == 12 else 0)
                month = 1 if current.month == 12 else current.month + 1
                current = current.replace(year=year, month=month)
            return out
        else:
            raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")

        current = start
        out = []
        while current <= end:
            out.append(current)
            current += step
        return out

    def _open_task_exists_for_routine(self, routine_id: str) -> bool:
        stmt = select(TodoItem).where(
            TodoItem.type == ItemType.TASK,
            TodoItem.routine_id == routine_id,
            not_(TodoItem.status.in_(list(TERMINAL_STATUSES))),  # type: ignore[attr-defined]
        )
        return self.session.exec(stmt).first() is not None

    def _task_exists_for_occurrence(self, routine_id: str, occurrence_key: str) -> bool:
        stmt = select(TodoItem).where(
            TodoItem.type == ItemType.TASK,
            TodoItem.routine_id == routine_id,
            TodoItem.occurrence_key == occurrence_key,
        )
        return self.session.exec(stmt).first() is not None

    def _create_generated_task(self, routine: TodoItem, occurrence_key: str, scheduled: str | None) -> TodoItem:
        task = TodoItem(
            id=new_id("task"),
            type=ItemType.TASK,
            title=routine.title,
            status=ItemStatus.APPROVED,
            area_id=routine.area_id,
            routine_id=routine.id,
            scheduled=scheduled,
            occurrence_key=occurrence_key,
            proposed_by=Actor.SYSTEM,
            approved_by=Actor.USER,
            approved_at=now_utc(),
            metadata_={"generated_by": "routine"},
        )
        return self._commit_event(actor=Actor.SYSTEM, action="materialize_routine_task", item=task)

    def materialize_routines(self, *, now: str | date | datetime | None = None, lookahead_days: int = 7, catchup_days: int = 1) -> list[TodoItem]:
        anchor = self._parse_day(now)
        start = anchor - timedelta(days=catchup_days)
        end = anchor + timedelta(days=lookahead_days)
        routines = self.session.exec(
            select(TodoItem).where(TodoItem.type == ItemType.ROUTINE, TodoItem.status == ItemStatus.ACTIVE)
        ).all()
        created: list[TodoItem] = []

        for routine in routines:
            if not routine.recurrence_rule:
                continue
            if routine.materialization_policy == "single_open":
                if self._open_task_exists_for_routine(routine.id):
                    continue
                occurrence_key = "open"
                if self._task_exists_for_occurrence(routine.id, occurrence_key):
                    occurrence_key = anchor.isoformat()
                created.append(self._create_generated_task(routine, occurrence_key, anchor.isoformat()))
                routine.last_materialized_at = now_utc()
                self.session.add(routine)
                self.session.commit()
                continue
            if routine.materialization_policy == "per_occurrence":
                for occurrence in self._occurrences(routine.recurrence_rule, start, end):
                    occurrence_key = occurrence.isoformat()
                    if self._task_exists_for_occurrence(routine.id, occurrence_key):
                        continue
                    created.append(self._create_generated_task(routine, occurrence_key, occurrence_key))
                routine.last_materialized_at = now_utc()
                self.session.add(routine)
                self.session.commit()
                continue
            raise PolicyError(f"Unsupported materialization_policy: {routine.materialization_policy}")

        return created

    def propose_task(self, title: str, *, area: str | None = None, project_id: str | None = None, routine_id: str | None = None, actor: Actor = Actor.ORACLE, due: str | None = None, scheduled: str | None = None, priority: int | None = None, description: str | None = None) -> TodoItem:
        item = TodoItem(
            id=new_id("task"),
            type=ItemType.TASK,
            title=title,
            status=ItemStatus.PROPOSED if actor != Actor.USER else ItemStatus.APPROVED,
            area_id=self.find_area(area),
            project_id=self._ensure_type(project_id, ItemType.PROJECT, "Project"),
            routine_id=self._ensure_type(routine_id, ItemType.ROUTINE, "Routine"),
            due=due,
            scheduled=scheduled,
            priority=priority,
            description=description,
            proposed_by=actor,
            approved_by=Actor.USER if actor == Actor.USER else None,
            approved_at=now_utc() if actor == Actor.USER else None,
        )
        return self._commit_event(actor=actor, action="propose_task", item=item)

    def propose_event(
        self,
        title: str,
        *,
        area: str | None = None,
        project_id: str | None = None,
        actor: Actor = Actor.ORACLE,
        scheduled: str | None = None,
        due: str | None = None,
        priority: int | None = None,
        description: str | None = None,
        location: str | None = None,
        participants: list[str] | None = None,
        commitment_type: str = "appointment",
    ) -> TodoItem:
        if not scheduled:
            raise PolicyError("Event requires scheduled time")
        metadata: dict[str, Any] = {
            "commitment_type": commitment_type,
            "schedule_kind": "external_commitment",
        }
        if location:
            metadata["location"] = location
        if participants:
            metadata["participants"] = participants
        item = TodoItem(
            id=new_id("evt"),
            type=ItemType.EVENT,
            title=title,
            status=ItemStatus.PROPOSED if actor != Actor.USER else ItemStatus.APPROVED,
            area_id=self.find_area(area),
            project_id=self._ensure_type(project_id, ItemType.PROJECT, "Project"),
            due=due,
            scheduled=scheduled,
            priority=priority,
            description=description,
            metadata_=metadata,
            proposed_by=actor,
            approved_by=Actor.USER if actor == Actor.USER else None,
            approved_at=now_utc() if actor == Actor.USER else None,
        )
        return self._commit_event(actor=actor, action="propose_event", item=item)

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

    def drop(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        if item.type == ItemType.AREA:
            raise PolicyError("Areas cannot be dropped; archive or pause them")
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"Already terminal: {item.status}")
        item.status = ItemStatus.DROPPED
        item.archived_at = now_utc()
        return self._commit_event(actor=actor, action="drop", item=item, before=before, reason=reason)

    def cancel(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        if item.type == ItemType.AREA:
            raise PolicyError("Areas cannot be cancelled; archive or pause them")
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"Already terminal: {item.status}")
        item.status = ItemStatus.CANCELLED
        item.archived_at = now_utc()
        return self._commit_event(actor=actor, action="cancel", item=item, before=before, reason=reason)

    def update_item(
        self,
        item_id: str,
        *,
        actor: Actor = Actor.USER,
        title: str | None = None,
        description: str | None = None,
        outcome: str | None = None,
        definition_of_done: str | None = None,
        standard: str | None = None,
        review_cycle: str | None = None,
        recurrence_rule: str | None = None,
        materialization_policy: str | None = None,
        area: str | None = None,
        project_id: str | None = None,
        routine_id: str | None = None,
        due: str | None = None,
        scheduled: str | None = None,
        priority: int | None = None,
        reason: str | None = None,
    ) -> TodoItem:
        item = self.get(item_id)
        if item.status in TERMINAL_STATUSES:
            raise PolicyError(f"Cannot update terminal item: {item.status}")
        before = self._snapshot(item)
        if title is not None:
            item.title = title
        if description is not None:
            item.description = description
        if outcome is not None:
            item.outcome = outcome
        if definition_of_done is not None:
            item.definition_of_done = definition_of_done
        if standard is not None:
            item.standard = standard
        if review_cycle is not None:
            item.review_cycle = review_cycle
        if recurrence_rule is not None:
            item.recurrence_rule = recurrence_rule
        if materialization_policy is not None:
            if materialization_policy not in {"single_open", "per_occurrence"}:
                raise PolicyError(f"Unsupported materialization_policy: {materialization_policy}")
            item.materialization_policy = materialization_policy
        if area is not None:
            item.area_id = self.find_area(area)
        if project_id is not None:
            item.project_id = self._ensure_type(project_id, ItemType.PROJECT, "Project")
        if routine_id is not None:
            item.routine_id = self._ensure_type(routine_id, ItemType.ROUTINE, "Routine")
        if due is not None:
            item.due = due
        if scheduled is not None:
            item.scheduled = scheduled
        if priority is not None:
            item.priority = priority
        return self._commit_event(actor=actor, action="update_item", item=item, before=before, reason=reason)

    def list_items(
        self,
        *,
        status: str | None = None,
        type_: str | None = None,
        area_id: str | None = None,
        project_id: str | None = None,
        routine_id: str | None = None,
        query: str | None = None,
        include_archived: bool = False,
    ) -> list[TodoItem]:
        stmt = select(TodoItem)
        if status:
            stmt = stmt.where(TodoItem.status == ItemStatus(status))
        elif not include_archived:
            stmt = stmt.where(TodoItem.status.not_in([ItemStatus.ARCHIVED, ItemStatus.DROPPED, ItemStatus.CANCELLED]))
        if type_:
            stmt = stmt.where(TodoItem.type == ItemType(type_))
        if area_id:
            stmt = stmt.where(TodoItem.area_id == area_id)
        if project_id:
            stmt = stmt.where(TodoItem.project_id == project_id)
        if routine_id:
            stmt = stmt.where(TodoItem.routine_id == routine_id)
        if query:
            like = f"%{query}%"
            stmt = stmt.where((TodoItem.title.like(like)) | (TodoItem.description.like(like)))
        stmt = stmt.order_by(TodoItem.created_at.desc())
        return list(self.session.exec(stmt).all())

    def archive_items(self) -> list[TodoItem]:
        stmt = (
            select(TodoItem)
            .where(TodoItem.status.in_([ItemStatus.ARCHIVED, ItemStatus.COMPLETED, ItemStatus.DROPPED, ItemStatus.CANCELLED, ItemStatus.SOMEDAY]))
            .order_by(TodoItem.updated_at.desc())
        )
        return list(self.session.exec(stmt).all())

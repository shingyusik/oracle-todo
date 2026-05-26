from __future__ import annotations

import calendar
import json
import re
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

    def _add_months(self, value: date, months: int = 1) -> date:
        month_index = value.month - 1 + months
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        day = min(value.day, calendar.monthrange(year, month)[1])
        return value.replace(year=year, month=month, day=day)

    def _monthly_occurrences(self, start: date, end: date, day: int | str) -> list[date]:
        current = start.replace(day=1)
        out: list[date] = []
        while current <= end:
            last_day = calendar.monthrange(current.year, current.month)[1]
            occurrence_day = last_day if day == "last" else min(int(day), last_day)
            occurrence = current.replace(day=occurrence_day)
            if start <= occurrence <= end:
                out.append(occurrence)
            current = self._add_months(current)
        return out

    def _interval_occurrences(self, start: date, end: date, step: timedelta) -> list[date]:
        current = start
        out: list[date] = []
        while current <= end:
            out.append(current)
            current += step
        return out

    def _weekday_occurrences(self, start: date, end: date, weekday: int, *, interval_weeks: int = 1) -> list[date]:
        days_until_weekday = (weekday - start.weekday()) % 7
        current = start + timedelta(days=days_until_weekday)
        return self._interval_occurrences(current, end, timedelta(weeks=interval_weeks))

    def _yearly_occurrences(self, start: date, end: date, month: int = 1, day: int = 1) -> list[date]:
        out: list[date] = []
        for year in range(start.year, end.year + 1):
            last_day = calendar.monthrange(year, month)[1]
            occurrence = date(year, month, min(day, last_day))
            if start <= occurrence <= end:
                out.append(occurrence)
        return out

    def _occurrences(self, recurrence_rule: str, start: date, end: date) -> list[date]:
        raw_rule = recurrence_rule.strip().lower()
        aliases = {
            "daily": "every day",
            "weekly": "every week",
            "monthly": "every month",
            "yearly": "every year",
        }
        rule = aliases.get(raw_rule, raw_rule)
        weekday_aliases = {
            "mon": 0,
            "monday": 0,
            "tue": 1,
            "tuesday": 1,
            "wed": 2,
            "wednesday": 2,
            "thu": 3,
            "thursday": 3,
            "fri": 4,
            "friday": 4,
            "sat": 5,
            "saturday": 5,
            "sun": 6,
            "sunday": 6,
        }
        interval_match = re.fullmatch(r"every(?:\s+(\d+))?\s+(days?|weeks?|months?|years?)(?:\s+on\s+(.+))?", rule)
        if not interval_match:
            if rule == "매일":
                return self._interval_occurrences(start, end, timedelta(days=1))
            if rule == "매주":
                return self._interval_occurrences(start, end, timedelta(weeks=1))
            if rule == "매월":
                return self._monthly_occurrences(start, end, 1)
            if rule == "매년":
                return self._yearly_occurrences(start, end)
            raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")

        interval = int(interval_match.group(1) or "1")
        if interval < 1:
            raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")
        unit = interval_match.group(2)
        anchor = (interval_match.group(3) or "").strip()

        if unit.startswith("day"):
            if anchor:
                raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")
            return self._interval_occurrences(start, end, timedelta(days=interval))

        if unit.startswith("week"):
            if not anchor:
                return self._interval_occurrences(start, end, timedelta(weeks=interval))
            weekday_name = anchor
            if weekday_name not in weekday_aliases:
                raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")
            return self._weekday_occurrences(start, end, weekday_aliases[weekday_name], interval_weeks=interval)

        if unit.startswith("month"):
            if not anchor:
                return self._monthly_occurrences(start, end, 1)
            monthly_day_match = re.fullmatch(r"the\s+(\d+)(?:st|nd|rd|th)?", anchor)
            if monthly_day_match:
                day = int(monthly_day_match.group(1))
                if day < 1 or day > 31:
                    raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")
                if interval == 1:
                    return self._monthly_occurrences(start, end, day)
                current = start.replace(day=1)
                out: list[date] = []
                while current <= end:
                    last_day = calendar.monthrange(current.year, current.month)[1]
                    occurrence = current.replace(day=min(day, last_day))
                    if start <= occurrence <= end:
                        out.append(occurrence)
                    current = self._add_months(current, interval)
                return out
            if anchor == "the last":
                if interval == 1:
                    return self._monthly_occurrences(start, end, "last")
                current = start.replace(day=1)
                out = []
                while current <= end:
                    last_day = calendar.monthrange(current.year, current.month)[1]
                    occurrence = current.replace(day=last_day)
                    if start <= occurrence <= end:
                        out.append(occurrence)
                    current = self._add_months(current, interval)
                return out
            raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")

        if unit.startswith("year"):
            if anchor:
                raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")
            if interval == 1:
                return self._yearly_occurrences(start, end)
            out = []
            for occurrence in self._yearly_occurrences(start, end):
                if (occurrence.year - start.year) % interval == 0:
                    out.append(occurrence)
            return out

        raise PolicyError(f"Unsupported recurrence_rule: {recurrence_rule}")

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

    def _record_generated_task_occurrence(self, task: TodoItem, *, actor: Actor, reason: str | None = None) -> None:
        if task.type != ItemType.TASK or not task.routine_id or not task.occurrence_key:
            return
        if task.metadata_.get("generated_by") != "routine":
            return
        routine = self.session.get(TodoItem, task.routine_id)
        if not routine:
            return
        before = self._snapshot(routine)
        at = now_utc().isoformat()
        occurrence = {
            "status": task.status.value,
            "task_id": task.id,
            "at": at,
        }
        if task.scheduled:
            occurrence["scheduled"] = task.scheduled
        metadata = dict(routine.metadata_ or {})
        occurrences = dict(metadata.get("occurrences") or {})
        occurrences[task.occurrence_key] = occurrence
        metadata["occurrences"] = occurrences
        metadata["last_occurrence"] = {"occurrence_key": task.occurrence_key, **occurrence}
        routine.metadata_ = metadata
        routine.updated_at = now_utc()
        self.session.add(routine)
        self._record_event(
            actor=actor,
            action=f"routine_occurrence_{task.status.value}",
            item=routine,
            before=before,
            reason=reason,
        )

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
            occurrences = self._occurrences(routine.recurrence_rule, start, end)
            if routine.materialization_policy == "single_open":
                if self._open_task_exists_for_routine(routine.id):
                    continue
                for occurrence in occurrences:
                    occurrence_key = occurrence.isoformat()
                    if self._task_exists_for_occurrence(routine.id, occurrence_key):
                        continue
                    created.append(self._create_generated_task(routine, occurrence_key, occurrence_key))
                    break
                routine.last_materialized_at = now_utc()
                self.session.add(routine)
                self.session.commit()
                continue
            if routine.materialization_policy == "per_occurrence":
                for occurrence in occurrences:
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
        self._record_generated_task_occurrence(item, actor=actor, reason=reason)
        return self._commit_event(actor=actor, action="complete", item=item, before=before, reason=reason)

    def archive(self, item_id: str, *, actor: Actor = Actor.USER, reason: str | None = None) -> TodoItem:
        item = self.get(item_id)
        before = self._snapshot(item)
        item.status = ItemStatus.ARCHIVED
        item.archived_at = now_utc()
        self._record_generated_task_occurrence(item, actor=actor, reason=reason)
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
        self._record_generated_task_occurrence(item, actor=actor, reason=reason)
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
        self._record_generated_task_occurrence(item, actor=actor, reason=reason)
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

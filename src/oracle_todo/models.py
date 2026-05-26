from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Optional
from uuid import uuid4

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class ItemType(StrEnum):
    AREA = "area"
    PROJECT = "project"
    ROUTINE = "routine"
    TASK = "task"
    EVENT = "event"
    REVIEW = "review"
    ARCHIVE_ITEM = "archive_item"


class ItemStatus(StrEnum):
    PROPOSED = "proposed"
    APPROVED = "approved"
    ACTIVE = "active"
    WAITING = "waiting"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DROPPED = "dropped"
    ARCHIVED = "archived"
    SOMEDAY = "someday"
    REJECTED = "rejected"


class Actor(StrEnum):
    USER = "user"
    ORACLE = "oracle"
    SYSTEM = "system"


class TodoItem(SQLModel, table=True):
    __tablename__ = "items"

    id: str = Field(primary_key=True)
    type: ItemType = Field(index=True)
    title: str = Field(index=True)
    status: ItemStatus = Field(index=True, default=ItemStatus.PROPOSED)

    area_id: Optional[str] = Field(default=None, foreign_key="items.id", index=True)
    project_id: Optional[str] = Field(default=None, foreign_key="items.id", index=True)
    routine_id: Optional[str] = Field(default=None, foreign_key="items.id", index=True)
    parent_id: Optional[str] = Field(default=None, foreign_key="items.id", index=True)

    description: Optional[str] = None
    outcome: Optional[str] = None
    definition_of_done: Optional[str] = None
    standard: Optional[str] = None
    review_cycle: Optional[str] = None
    recurrence_rule: Optional[str] = None
    materialization_policy: str = Field(default="single_open", index=True)
    occurrence_key: Optional[str] = Field(default=None, index=True)
    priority: Optional[int] = Field(default=None, index=True)
    due: Optional[str] = Field(default=None, index=True)
    scheduled: Optional[str] = Field(default=None, index=True)
    horizon: Optional[str] = Field(default=None, index=True)

    proposed_by: Actor = Field(default=Actor.ORACLE, index=True)
    approved_by: Optional[Actor] = None
    approved_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    last_materialized_at: Optional[datetime] = None

    second_brain_refs: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    metadata_: dict = Field(default_factory=dict, sa_column=Column("metadata", JSON))

    created_at: datetime = Field(default_factory=now_utc, index=True)
    updated_at: datetime = Field(default_factory=now_utc, index=True)


class TodoEvent(SQLModel, table=True):
    __tablename__ = "events"

    id: str = Field(default_factory=lambda: new_id("evt"), primary_key=True)
    at: datetime = Field(default_factory=now_utc, index=True)
    actor: Actor = Field(index=True)
    action: str = Field(index=True)
    object_type: str = Field(index=True)
    object_id: str = Field(index=True)
    before: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    after: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    reason: Optional[str] = None

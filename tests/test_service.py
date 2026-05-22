from pathlib import Path

import pytest

from oracle_todo.db import init_db, session_for
from oracle_todo.models import Actor, ItemStatus, ItemType
from oracle_todo.service import PolicyError, TodoService


def svc(tmp_path: Path) -> TodoService:
    db = tmp_path / "todo.sqlite"
    init_db(db)
    return TodoService(session_for(db), events_path=tmp_path / "events.jsonl")


def test_oracle_task_starts_proposed_and_requires_approval(tmp_path):
    service = svc(tmp_path)
    item = service.propose_task("앱 열고 DB 확인", actor=Actor.ORACLE)
    assert item.status == ItemStatus.PROPOSED

    with pytest.raises(PolicyError):
        service.activate(item.id)

    service.approve(item.id)
    activated = service.activate(item.id)
    assert activated.status == ItemStatus.ACTIVE


def test_project_requires_definition_of_done_before_activation(tmp_path):
    service = svc(tmp_path)
    item = service.propose_project("가계부 자동화 안정화", actor=Actor.USER)
    service.approve(item.id)

    with pytest.raises(PolicyError):
        service.activate(item.id)


def test_routine_requires_recurrence_rule_before_activation(tmp_path):
    service = svc(tmp_path)
    item = service.propose_routine("매일 브리핑 확인", actor=Actor.USER)
    service.approve(item.id)

    with pytest.raises(PolicyError):
        service.activate(item.id)


def test_area_creation_is_active_and_cannot_complete(tmp_path):
    service = svc(tmp_path)
    area = service.create_area("재정", review_cycle="weekly")
    assert area.type == ItemType.AREA
    assert area.status == ItemStatus.ACTIVE

    with pytest.raises(PolicyError):
        service.complete(area.id)


def test_every_mutation_writes_jsonl_event(tmp_path):
    service = svc(tmp_path)
    item = service.propose_task("테스트")
    service.approve(item.id)
    lines = (tmp_path / "events.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert "propose_task" in lines[0]
    assert "approve" in lines[1]

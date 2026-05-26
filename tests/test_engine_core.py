from pathlib import Path

import pytest

from oracle_todo.db import init_db, session_for
from oracle_todo.exporters import write_exports
from oracle_todo.models import Actor, ItemStatus, ItemType
from oracle_todo.service import PolicyError, TodoService


def svc(tmp_path: Path) -> TodoService:
    db = tmp_path / "todo.sqlite"
    init_db(db)
    return TodoService(session_for(db), events_path=tmp_path / "events.jsonl")


def test_update_item_changes_core_todo_fields_and_records_event(tmp_path):
    service = svc(tmp_path)
    item = service.propose_task("옛 제목", actor=Actor.ORACLE)

    updated = service.update_item(
        item.id,
        actor=Actor.USER,
        title="새 제목",
        description="설명",
        due="2026-05-31",
        scheduled="today",
        priority=3,
        reason="정리",
    )

    assert updated.title == "새 제목"
    assert updated.description == "설명"
    assert updated.due == "2026-05-31"
    assert updated.scheduled == "today"
    assert updated.priority == 3
    lines = (tmp_path / "events.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert "update_item" in lines[-1]


def test_task_project_relationship_requires_project_type(tmp_path):
    service = svc(tmp_path)
    area = service.create_area("재정")

    with pytest.raises(PolicyError):
        service.propose_task("잘못된 연결", project_id=area.id)


def test_drop_item_soft_deletes_without_hard_deleting_record(tmp_path):
    service = svc(tmp_path)
    item = service.propose_task("내려놓을 일")

    dropped = service.drop(item.id, reason="더 이상 필요 없음")

    assert dropped.status == ItemStatus.DROPPED
    assert service.get(item.id).status == ItemStatus.DROPPED
    visible = service.list_items()
    assert dropped.id not in {i.id for i in visible}


def test_list_items_supports_area_project_and_text_filters(tmp_path):
    service = svc(tmp_path)
    area = service.create_area("재정")
    project = service.propose_project("가계부 안정화", area=area.id, actor=Actor.USER, definition_of_done="매일 정상 동작")
    task = service.propose_task("DB 확인", area=area.id, project_id=project.id, actor=Actor.ORACLE)
    service.propose_task("운동하기", actor=Actor.ORACLE)

    by_area = service.list_items(area_id=area.id)
    by_project = service.list_items(project_id=project.id)
    by_text = service.list_items(query="DB")

    assert {i.id for i in by_area} >= {project.id, task.id}
    assert [i.id for i in by_project] == [task.id]
    assert [i.id for i in by_text] == [task.id]


def test_archive_view_contains_dropped_cancelled_completed_and_archived(tmp_path):
    service = svc(tmp_path)
    completed = service.propose_task("완료", actor=Actor.USER)
    dropped = service.propose_task("폐기", actor=Actor.USER)
    cancelled = service.propose_task("취소", actor=Actor.USER)
    archived = service.propose_task("보관", actor=Actor.USER)

    service.complete(completed.id)
    service.drop(dropped.id)
    service.cancel(cancelled.id)
    service.archive(archived.id)

    archive = service.archive_items()
    assert {i.id for i in archive} == {completed.id, dropped.id, cancelled.id, archived.id}


def test_propose_event_distinguishes_external_commitments_from_solo_tasks(tmp_path):
    service = svc(tmp_path)

    event = service.propose_event(
        "병원 예약",
        actor=Actor.ORACLE,
        scheduled="2026-06-01 15:00",
        location="서울대병원",
        participants=["서울대병원"],
        commitment_type="appointment",
        description="진료 예약",
    )
    task = service.propose_task("혼자 책상 정리", actor=Actor.ORACLE, scheduled="2026-06-01")

    assert event.type == ItemType.EVENT
    assert event.status == ItemStatus.PROPOSED
    assert event.scheduled == "2026-06-01 15:00"
    assert event.metadata_["commitment_type"] == "appointment"
    assert event.metadata_["location"] == "서울대병원"
    assert event.metadata_["participants"] == ["서울대병원"]
    assert task.type == ItemType.TASK
    assert [i.id for i in service.list_items(type_="event")] == [event.id]


def test_event_requires_scheduled_time(tmp_path):
    service = svc(tmp_path)

    with pytest.raises(PolicyError):
        service.propose_event("시간 없는 약속", actor=Actor.ORACLE)


def test_exports_split_tasks_and_events_into_separate_views(tmp_path):
    service = svc(tmp_path)
    task = service.propose_task("혼자 할 일", actor=Actor.USER, scheduled="today")
    event = service.propose_event("친구 약속", actor=Actor.USER, scheduled="2026-06-01 19:00", participants=["친구"])

    paths = write_exports(service.list_items(), out_dir=tmp_path / "exports")

    today = (tmp_path / "exports" / "today.md").read_text(encoding="utf-8")
    events = (tmp_path / "exports" / "events.md").read_text(encoding="utf-8")
    assert tmp_path / "exports" / "events.md" in paths
    assert task.title in today
    assert event.title not in today
    assert event.title in events
    assert "scheduled:2026-06-01 19:00" in events
    assert "with:친구" in events

from pathlib import Path

from oracle_todo.db import init_db, session_for
from oracle_todo.models import Actor, ItemStatus, ItemType
from oracle_todo.service import TodoService


def svc(tmp_path: Path) -> TodoService:
    db = tmp_path / "todo.sqlite"
    init_db(db)
    return TodoService(session_for(db), events_path=tmp_path / "events.jsonl")


def test_single_open_routine_materialization_keeps_only_one_open_task(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "매일 책상 정리",
        actor=Actor.USER,
        recurrence_rule="daily",
        materialization_policy="single_open",
    )
    service.activate(routine.id)

    first = service.materialize_routines(now="2026-05-26", lookahead_days=7, catchup_days=1)
    second = service.materialize_routines(now="2026-05-27", lookahead_days=7, catchup_days=1)

    assert len(first) == 1
    assert second == []
    open_tasks = service.list_items(type_="task", routine_id=routine.id)
    assert len(open_tasks) == 1
    assert open_tasks[0].title == "매일 책상 정리"
    assert open_tasks[0].status == ItemStatus.APPROVED
    assert open_tasks[0].routine_id == routine.id
    assert open_tasks[0].occurrence_key == "2026-05-25"
    assert open_tasks[0].scheduled == "2026-05-25"


def test_single_open_routine_creates_next_task_after_previous_completed(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "주간 리뷰",
        actor=Actor.USER,
        recurrence_rule="weekly",
        materialization_policy="single_open",
    )
    service.activate(routine.id)
    [task] = service.materialize_routines(now="2026-05-26")
    service.complete(task.id)

    next_tasks = service.materialize_routines(now="2026-06-02")

    assert len(next_tasks) == 1
    assert next_tasks[0].id != task.id
    assert next_tasks[0].routine_id == routine.id


def test_generated_task_completion_records_routine_occurrence_history(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "주간 리뷰",
        actor=Actor.USER,
        recurrence_rule="weekly",
        materialization_policy="single_open",
    )
    service.activate(routine.id)
    [task] = service.materialize_routines(now="2026-05-26")

    service.complete(task.id, reason="완료")

    updated_routine = service.get(routine.id)
    occurrence = updated_routine.metadata_["occurrences"][task.occurrence_key]
    assert occurrence["status"] == "completed"
    assert occurrence["task_id"] == task.id
    assert occurrence["scheduled"] == task.scheduled
    assert updated_routine.metadata_["last_occurrence"]["occurrence_key"] == task.occurrence_key
    assert "routine_occurrence_completed" in (tmp_path / "events.jsonl").read_text(encoding="utf-8")


def test_generated_task_cancellation_records_routine_occurrence_history(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "매일 스트레칭",
        actor=Actor.USER,
        recurrence_rule="daily",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)
    [task] = service.materialize_routines(now="2026-05-26", lookahead_days=0, catchup_days=0)

    service.cancel(task.id, reason="오늘은 쉼")

    updated_routine = service.get(routine.id)
    occurrence = updated_routine.metadata_["occurrences"]["2026-05-26"]
    assert occurrence["status"] == "cancelled"
    assert occurrence["task_id"] == task.id
    assert "routine_occurrence_cancelled" in (tmp_path / "events.jsonl").read_text(encoding="utf-8")


def test_per_occurrence_materialization_creates_bounded_unique_occurrence_tasks(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "혈압 기록",
        actor=Actor.USER,
        recurrence_rule="daily",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-05-26", lookahead_days=2, catchup_days=1)
    repeated = service.materialize_routines(now="2026-05-26", lookahead_days=2, catchup_days=1)

    assert repeated == []
    assert [task.occurrence_key for task in created] == [
        "2026-05-25",
        "2026-05-26",
        "2026-05-27",
        "2026-05-28",
    ]
    assert [task.scheduled for task in created] == [
        "2026-05-25",
        "2026-05-26",
        "2026-05-27",
        "2026-05-28",
    ]
    assert all(task.status == ItemStatus.APPROVED for task in created)
    assert all(task.routine_id == routine.id for task in created)


def test_materialization_supports_weekly_weekday_rules(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "업무일지 작성 (Mon)",
        actor=Actor.USER,
        recurrence_rule="every week on Monday",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-05-26", lookahead_days=7, catchup_days=1)

    assert [task.occurrence_key for task in created] == ["2026-05-25", "2026-06-01"]


def test_materialization_supports_any_monthly_ordinal_day_rule(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "월세 확인",
        actor=Actor.USER,
        recurrence_rule="every month on the 6th",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-05-26", lookahead_days=40, catchup_days=0)

    assert [task.occurrence_key for task in created] == ["2026-06-06"]


def test_materialization_supports_interval_day_rules(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "격일 기록",
        actor=Actor.USER,
        recurrence_rule="every 2 days",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-05-26", lookahead_days=6, catchup_days=0)

    assert [task.occurrence_key for task in created] == ["2026-05-26", "2026-05-28", "2026-05-30", "2026-06-01"]


def test_materialization_supports_monthly_last_day_rules(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "monthly note 작성",
        actor=Actor.USER,
        recurrence_rule="every month on the last",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-05-26", lookahead_days=40, catchup_days=0)

    assert [task.occurrence_key for task in created] == ["2026-05-31", "2026-06-30"]


def test_materialization_supports_multiweek_weekday_rules(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "발톱깍기",
        actor=Actor.USER,
        recurrence_rule="every 5 weeks on Friday",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-05-26", lookahead_days=40, catchup_days=0)

    assert [task.occurrence_key for task in created] == ["2026-05-29", "2026-07-03"]


def test_materialization_supports_yearly_rules(tmp_path):
    service = svc(tmp_path)
    routine = service.propose_routine(
        "yearly note 작성",
        actor=Actor.USER,
        recurrence_rule="every year",
        materialization_policy="per_occurrence",
    )
    service.activate(routine.id)

    created = service.materialize_routines(now="2026-12-30", lookahead_days=5, catchup_days=0)

    assert [task.occurrence_key for task in created] == ["2027-01-01"]


def test_materialization_ignores_non_active_routines(tmp_path):
    service = svc(tmp_path)
    service.propose_routine(
        "승인 전 루틴",
        actor=Actor.ORACLE,
        recurrence_rule="daily",
        materialization_policy="per_occurrence",
    )

    created = service.materialize_routines(now="2026-05-26")

    assert created == []
    assert service.list_items(type_="task") == []

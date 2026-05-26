from typer.testing import CliRunner

from oracle_todo.cli import app
from oracle_todo.db import session_for
from oracle_todo.models import Actor
from oracle_todo.service import TodoService


runner = CliRunner()


def _service(tmp_path, monkeypatch):
    monkeypatch.setenv("ORACLE_TODO_HOME", str(tmp_path))
    return TodoService(session_for(), events_path=tmp_path / "events.jsonl")


def test_today_auto_materializes_active_routines_before_rendering(tmp_path, monkeypatch):
    service = _service(tmp_path, monkeypatch)
    routine = service.propose_routine(
        "매일 스트레칭",
        actor=Actor.USER,
        recurrence_rule="daily",
        materialization_policy="single_open",
    )
    service.activate(routine.id)

    result = runner.invoke(app, ["today"])

    assert result.exit_code == 0
    assert "매일 스트레칭" in result.output
    tasks = service.list_items(type_="task", routine_id=routine.id)
    assert len(tasks) == 1
    assert tasks[0].occurrence_key is not None


def test_export_auto_materializes_active_routines_before_writing_views(tmp_path, monkeypatch):
    service = _service(tmp_path, monkeypatch)
    routine = service.propose_routine(
        "매일 물 마시기",
        actor=Actor.USER,
        recurrence_rule="daily",
        materialization_policy="single_open",
    )
    service.activate(routine.id)

    result = runner.invoke(app, ["export"])

    assert result.exit_code == 0
    today = (tmp_path / "exports" / "today.md").read_text(encoding="utf-8")
    assert "매일 물 마시기" in today
    assert len(service.list_items(type_="task", routine_id=routine.id)) == 1

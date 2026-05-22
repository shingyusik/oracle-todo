from __future__ import annotations

import json
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from .db import init_db, session_for
from .exporters import render_items, write_exports
from .models import Actor
from .paths import db_path, todo_home
from .service import PolicyError, TodoService

app = typer.Typer(help="Policy-enforced Oracle ToDo engine")
area_app = typer.Typer(help="Manage areas")
project_app = typer.Typer(help="Manage projects")
routine_app = typer.Typer(help="Manage routines")
task_app = typer.Typer(help="Manage tasks")
app.add_typer(area_app, name="area")
app.add_typer(project_app, name="project")
app.add_typer(routine_app, name="routine")
app.add_typer(task_app, name="task")
console = Console()


def _service() -> TodoService:
    return TodoService(session_for())


def _print_item(item) -> None:
    console.print_json(json.dumps(item.model_dump(mode="json"), ensure_ascii=False))


def _actor(value: str) -> Actor:
    return Actor(value)


@app.command()
def init() -> None:
    """Initialize the SQLite database."""
    path = init_db()
    console.print(f"Initialized oracle-todo at {todo_home()} ({path})")


@app.command("list")
def list_items(
    status: Optional[str] = None,
    type: Optional[str] = None,
    area_id: Optional[str] = None,
    project_id: Optional[str] = None,
    routine_id: Optional[str] = None,
    query: Optional[str] = None,
    include_archived: bool = False,
) -> None:
    svc = _service()
    items = svc.list_items(status=status, type_=type, area_id=area_id, project_id=project_id, routine_id=routine_id, query=query, include_archived=include_archived)
    table = Table("ID", "Type", "Status", "Title", "Area", "Project", "Due")
    for i in items:
        table.add_row(i.id, i.type.value, i.status.value, i.title, i.area_id or "", i.project_id or "", i.due or "")
    console.print(table)


@app.command()
def pending() -> None:
    """List proposed items awaiting approval."""
    list_items(status="proposed", include_archived=True)


@app.command()
def approve(item_id: str, reason: Optional[str] = None) -> None:
    try:
        _print_item(_service().approve(item_id, reason=reason))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command()
def activate(item_id: str, reason: Optional[str] = None) -> None:
    try:
        _print_item(_service().activate(item_id, reason=reason))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command()
def complete(item_id: str, reason: Optional[str] = None) -> None:
    try:
        _print_item(_service().complete(item_id, reason=reason))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command()
def archive(item_id: str, reason: Optional[str] = None) -> None:
    try:
        _print_item(_service().archive(item_id, reason=reason))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command()
def drop(item_id: str, reason: Optional[str] = None) -> None:
    try:
        _print_item(_service().drop(item_id, reason=reason))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command()
def cancel(item_id: str, reason: Optional[str] = None) -> None:
    try:
        _print_item(_service().cancel(item_id, reason=reason))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command("update")
def update_item(
    item_id: str,
    title: Optional[str] = None,
    description: Optional[str] = None,
    outcome: Optional[str] = None,
    definition_of_done: Optional[str] = None,
    standard: Optional[str] = None,
    review_cycle: Optional[str] = None,
    recurrence_rule: Optional[str] = None,
    area: Optional[str] = None,
    project_id: Optional[str] = None,
    routine_id: Optional[str] = None,
    due: Optional[str] = None,
    scheduled: Optional[str] = None,
    priority: Optional[int] = None,
    reason: Optional[str] = None,
) -> None:
    try:
        _print_item(
            _service().update_item(
                item_id,
                title=title,
                description=description,
                outcome=outcome,
                definition_of_done=definition_of_done,
                standard=standard,
                review_cycle=review_cycle,
                recurrence_rule=recurrence_rule,
                area=area,
                project_id=project_id,
                routine_id=routine_id,
                due=due,
                scheduled=scheduled,
                priority=priority,
                reason=reason,
            )
        )
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@app.command("archive-list")
def archive_list() -> None:
    items = _service().archive_items()
    table = Table("ID", "Type", "Status", "Title", "Area", "Project", "Due")
    for i in items:
        table.add_row(i.id, i.type.value, i.status.value, i.title, i.area_id or "", i.project_id or "", i.due or "")
    console.print(table)


@app.command()
def today() -> None:
    svc = _service()
    items = svc.list_items(type_="task")
    console.print(render_items("Today", items))


@app.command("export")
def export_cmd() -> None:
    svc = _service()
    paths = write_exports(svc.list_items(include_archived=True))
    for path in paths:
        console.print(str(path))


@area_app.command("create")
def area_create(title: str, review_cycle: Optional[str] = None, standard: Optional[str] = None) -> None:
    _print_item(_service().create_area(title, actor=Actor.USER, review_cycle=review_cycle, standard=standard))


@project_app.command("propose")
def project_propose(title: str, area: Optional[str] = None, definition_of_done: Optional[str] = None, outcome: Optional[str] = None, due: Optional[str] = None, actor: str = "oracle") -> None:
    try:
        _print_item(_service().propose_project(title, area=area, definition_of_done=definition_of_done, outcome=outcome, due=due, actor=_actor(actor)))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@routine_app.command("propose")
def routine_propose(title: str, area: Optional[str] = None, recurrence_rule: Optional[str] = None, actor: str = "oracle") -> None:
    try:
        _print_item(_service().propose_routine(title, area=area, recurrence_rule=recurrence_rule, actor=_actor(actor)))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


@task_app.command("propose")
def task_propose(
    title: str,
    area: Optional[str] = None,
    project_id: Optional[str] = None,
    routine_id: Optional[str] = None,
    due: Optional[str] = None,
    scheduled: Optional[str] = None,
    priority: Optional[int] = None,
    description: Optional[str] = None,
    actor: str = "oracle",
) -> None:
    try:
        _print_item(_service().propose_task(title, area=area, project_id=project_id, routine_id=routine_id, due=due, scheduled=scheduled, priority=priority, description=description, actor=_actor(actor)))
    except (PolicyError, KeyError) as e:
        raise typer.BadParameter(str(e))


def main() -> None:
    app()

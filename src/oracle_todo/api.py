from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import Session

from .db import session_for
from .exporters import render_items
from .models import Actor, TodoItem
from .service import PolicyError, TodoService

app = FastAPI(title="oracle-todo", version="0.1.0")


class AreaCreate(BaseModel):
    title: str
    review_cycle: str | None = None
    standard: str | None = None


class TaskPropose(BaseModel):
    title: str
    area: str | None = None
    due: str | None = None
    scheduled: str | None = None
    priority: int | None = None
    description: str | None = None
    actor: Actor = Actor.ORACLE


def get_service():
    with session_for() as session:
        yield TodoService(session)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/items", response_model=list[TodoItem])
def list_items(status: str | None = None, type: str | None = None, include_archived: bool = False, svc: TodoService = Depends(get_service)):
    return svc.list_items(status=status, type_=type, include_archived=include_archived)


@app.post("/areas", response_model=TodoItem)
def create_area(body: AreaCreate, svc: TodoService = Depends(get_service)):
    return svc.create_area(body.title, actor=Actor.USER, review_cycle=body.review_cycle, standard=body.standard)


@app.post("/tasks/propose", response_model=TodoItem)
def propose_task(body: TaskPropose, svc: TodoService = Depends(get_service)):
    try:
        return svc.propose_task(body.title, area=body.area, due=body.due, scheduled=body.scheduled, priority=body.priority, description=body.description, actor=body.actor)
    except (PolicyError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/items/{item_id}/approve", response_model=TodoItem)
def approve(item_id: str, svc: TodoService = Depends(get_service)):
    try:
        return svc.approve(item_id)
    except (PolicyError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/items/{item_id}/complete", response_model=TodoItem)
def complete(item_id: str, svc: TodoService = Depends(get_service)):
    try:
        return svc.complete(item_id)
    except (PolicyError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/exports/today.md")
def today_export(svc: TodoService = Depends(get_service)):
    return Response(render_items("Today", svc.list_items(type_="task")), media_type="text/markdown")

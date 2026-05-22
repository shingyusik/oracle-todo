# oracle-todo v1 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a policy-enforced ToDo engine that Oracle can operate without being the source of truth.

**Architecture:** Local-first SQLite service layer with Typer CLI, FastAPI dashboard-ready endpoints, mandatory event logging, and Markdown exports.

**Tech Stack:** Python 3.12, uv, SQLModel, Pydantic, Typer, FastAPI, pytest.

---

## Tasks

1. Initialize uv package and dependencies.
2. Define SQLModel tables for items/events.
3. Implement service layer with policy errors and state transitions.
4. Add Typer CLI that only calls service methods.
5. Add Markdown exports as read-only views.
6. Add FastAPI skeleton for future dashboard.
7. Add tests for approval gate, Project/Area/Routine policies, and event log.
8. Initialize git, commit, create private GitHub repo with gh CLI, and push.

## Verification

```bash
uv run pytest
uv run oracle-todo init
uv run oracle-todo area create "재정" --review-cycle weekly
uv run oracle-todo task propose "MoneyManager 앱 열고 DB 생성 여부 확인" --area "재정"
uv run oracle-todo pending
```

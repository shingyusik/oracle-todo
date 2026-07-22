# Shared Backend Preferences Design

**Date:** 2026-07-21
**Status:** Proposed

## Goal

Persist Planner filter, grouping, and sort settings in the local SQLite database
while establishing a reusable backend package for future engines.

## Architecture

Add a Rust workspace library package named `backend`. It owns only generic
workspace preferences: the settings data model, SQLite table/repository, and
HTTP router module. It does not own or proxy Todo routes.

`todo-engine` keeps its existing API router and merges the backend preferences
router. The frontend continues to call the local server through its existing
`/todo-engine` development proxy; it never opens SQLite directly.

## Data Model

The shared package creates this additive table:

```sql
CREATE TABLE IF NOT EXISTS workspace_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

The initial key is `planner.v1`. Its JSON value contains all persisted Planner
state: filter mode and rules, per-view group settings, and per-view sort rules.
The setting is workspace-wide because the local server currently has no user or
profile identity.

## API

- `GET /settings/planner` returns the saved JSON value or `null` when absent.
- `PUT /settings/planner` accepts `{ "value": { ... } }`, requires an object,
  and atomically upserts the row.

Malformed or unavailable saved data must not block the frontend: it keeps
defaults in memory. Writes are best-effort from the UI; the next successful
write replaces the persisted document.

## Boundaries

- `backend` contains no Todo item policy, status transitions, or Todo routes.
- `todo-engine` remains the executable and the owner of its Todo schema and
  service layer.
- The frontend owns presentation state and normalizes received JSON, but uses
  the API exclusively for persistence.

## Verification

- Backend API tests prove a value persists across a new router over the same
  SQLite file and reject a non-object body.
- Frontend controller tests prove persisted settings are requested on mount and
  restored after remount.
- Run Rust formatting/tests/lints and frontend tests/typecheck/build.

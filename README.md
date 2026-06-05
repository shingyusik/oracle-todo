# oracle-todo

A policy-enforced personal ToDo engine for Oracle/Hermes workflows.

## Core model

`oracle-todo` keeps tasks, projects, routines, events, and long-lived responsibility areas in one SQLite-backed item graph.

- **SQLite is the source of truth**: Telegram, Markdown exports, CLI, and dashboards are views.
- **Service layer enforces policy**: humans and agents use the same validation and state transitions.
- **Event log is mandatory**: every state change writes an audit record to SQLite and `events.jsonl`.
- **Second_Brain is read-only**: ToDo items may store references, but the engine does not write to the vault.
- **User approval gates agent-created work**: Oracle-created items stay proposed until approved.

## Stack

- Python 3.12+
- uv
- SQLite via SQLModel
- Pydantic models / policy validation
- Typer CLI
- FastAPI dashboard/API surface

## Setup

```bash
uv sync
uv run oracle-todo init
```

Default data directory:

```text
~/.hermes/oracle-todo/
├── todo.sqlite
├── events.jsonl
└── exports/
    ├── today.md
    ├── events.md
    ├── projects.md
    ├── areas.md
    ├── routines.md
    ├── proposed.md
    └── archive.md
```

Use another data directory:

```bash
export ORACLE_TODO_HOME=/path/to/data
uv run oracle-todo init
```

## Quick usage

```bash
# 1. Create an ongoing area. Areas are active immediately.
uv run oracle-todo area create "재정" \
  --review-cycle weekly \
  --standard "월 1회 계정/자동화 상태 점검"

# 2. Let Oracle propose a project. Proposed items require user approval.
uv run oracle-todo project propose "MoneyManager 안정화" \
  --area "재정" \
  --outcome "가계부 운영 안정화" \
  --definition-of-done "원본 DB 백업과 브리핑이 매일 실패 없이 동작한다" \
  --due 2026-06-30

# 3. Review and approve pending proposals.
uv run oracle-todo pending
uv run oracle-todo approve <item-id>

# 4. Activate approved work.
uv run oracle-todo activate <item-id>

# 5. Add tasks under an area/project.
uv run oracle-todo task propose "MoneyManager 앱 열고 DB 생성 여부 확인" \
  --area "재정" \
  --project-id <proj-id> \
  --scheduled today \
  --priority 1

# 6. See today's task view and export Markdown views.
uv run oracle-todo today
uv run oracle-todo export
```

## Item types

### Area

Long-lived responsibility domain. Examples: `재정`, `건강`, `Second_Brain`, `개발`, `가족`.

- Created by the user.
- Active immediately.
- Not completed as work.
- Can be archived when no longer maintained.
- Owns standards and review rhythm.

Required / useful columns:

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `area_<uuid>` style item ID. |
| `type` | yes | Always `area`. |
| `title` | yes | Area name. |
| `status` | yes | Created as `active`. |
| `review_cycle` | recommended | Review rhythm, e.g. `weekly`, `monthly`. |
| `standard` | recommended | Operating standard for this area. |
| `proposed_by` | yes | Usually `user`. |
| `approved_by` / `approved_at` | yes | Set at creation. |

Create:

```bash
uv run oracle-todo area create "건강" --review-cycle weekly --standard "운동/검진/수면 루틴 유지"
```

### Project

Finite outcome-oriented work inside an area.

- Oracle may propose; user approval is required before activation.
- Activation requires `definition_of_done`.
- Projects should represent outcomes, not single actions.
- Tasks can link to a project through `project_id`.

Required / useful columns:

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `proj_<uuid>` style item ID. |
| `type` | yes | Always `project`. |
| `title` | yes | Project name. |
| `status` | yes | Usually `proposed`, `approved`, or `active`. |
| `area_id` | recommended | Owning area ID. Supplied by `--area <name-or-id>`. |
| `outcome` | recommended | Desired result. |
| `definition_of_done` | required to activate | Completion criteria. |
| `due` | optional | Date or date-like string. |
| `proposed_by` | yes | `oracle`, `user`, or `system`. |
| `approved_by` / `approved_at` | required for agent-created activation | User approval marker. |

Propose:

```bash
uv run oracle-todo project propose "Second_Brain 정리" \
  --area "Second_Brain" \
  --outcome "검색 가능한 지식 구조" \
  --definition-of-done "원본 보존, 위키 합성, ToDo 분리가 모두 유지된다" \
  --due 2026-06-30
```

### Routine

Recurring work template. Active routines materialize task instances.

- Oracle may propose; user approval is required before activation.
- Activation requires `recurrence_rule`.
- Generated tasks link back through `routine_id`.
- `single_open` keeps at most one open generated task per routine.
- `per_occurrence` creates one task per occurrence in the materialization window.

Required / useful columns:

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `rtn_<uuid>` style item ID. |
| `type` | yes | Always `routine`. |
| `title` | yes | Routine task title used for generated tasks. |
| `status` | yes | Usually `proposed`, `approved`, `active`, or `paused`. |
| `area_id` | recommended | Owning area ID. |
| `recurrence_rule` | required to activate/materialize | Supported rule string. |
| `materialization_policy` | yes | `single_open` or `per_occurrence`; default `single_open`. |
| `last_materialized_at` | system-managed | Last materialization timestamp. |
| `metadata.occurrences` | system-managed | Terminal state history for generated routine tasks. |

Propose and materialize:

```bash
uv run oracle-todo routine propose "운동 기록 확인" \
  --area "건강" \
  --recurrence-rule "월-금" \
  --materialization-policy single_open

uv run oracle-todo approve <routine-id>
uv run oracle-todo activate <routine-id>
uv run oracle-todo routine materialize --lookahead-days 7 --catchup-days 1
```

Supported recurrence examples:

| Rule | Meaning |
| --- | --- |
| `daily`, `매일`, `every day` | Every day. |
| `weekly`, `매주`, `every week` | Every 7 days from the materialization window start. |
| `monthly`, `매월`, `every month` | Monthly on day 1. |
| `yearly`, `매년`, `every year` | Yearly on Jan 1. |
| `월`, `mon`, `monday` | Every Monday. |
| `월-금`, `평일`, `weekdays` | Monday through Friday. |
| `토-일`, `주말`, `weekend` | Saturday and Sunday. |
| `월-일` | Every day. |
| `월수금`, `mon,wed,fri`, `mon wed fri` | Specific weekday set. |
| `every 2 weeks on mon` | Every 2 weeks on Monday. |
| `every week on 월-금` | Every week on Monday through Friday. |
| `every month on the 15th` | Monthly on the 15th. |
| `every month on the last` | Monthly on the last day. |
| `every 2 years` | Every 2 years. |

### Task

Concrete action item.

- Oracle-created tasks start as `proposed`.
- User-created tasks can be inserted as `approved` by using the service layer with actor `user`.
- Tasks may belong to an area, project, or routine.
- `today` includes task items in `proposed`, `approved`, or `active` status when `scheduled` is empty, `today`, or a date not later than today.

Required / useful columns:

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `task_<uuid>` style item ID. |
| `type` | yes | Always `task`. |
| `title` | yes | Action title. |
| `status` | yes | Usually `proposed`, `approved`, `active`, `waiting`, or terminal. |
| `area_id` | recommended | Owning area ID. |
| `project_id` | optional | Parent project ID. Must point to a non-terminal project. |
| `routine_id` | optional | Source routine ID. Must point to a non-terminal routine. |
| `description` | optional | Details or acceptance notes. |
| `due` | optional | Deadline string. |
| `scheduled` | optional | Visibility/scheduling string, e.g. `today`, `2026-06-05`. |
| `priority` | optional | Integer priority. Lower number can mean higher priority by convention. |
| `occurrence_key` | system-managed for routines | Routine occurrence key, usually ISO date. |
| `metadata.generated_by` | system-managed for routines | `routine` for generated tasks. |

Propose:

```bash
uv run oracle-todo task propose "README 사용법 검토" \
  --area "개발" \
  --project-id <proj-id> \
  --scheduled today \
  --priority 1 \
  --description "명령어와 컬럼 설명 확인"
```

### Event

External commitment or scheduled appointment.

- Requires `scheduled`.
- Uses `metadata` for location, participants, and commitment type.
- Can be shown in exports separately from tasks.

Required / useful columns:

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | `evt_<uuid>` style item ID. |
| `type` | yes | Always `event`. |
| `title` | yes | Event title. |
| `status` | yes | Usually `proposed`, `approved`, `active`, or terminal. |
| `scheduled` | yes | Scheduled date/time string. |
| `area_id` | optional | Related area ID. |
| `project_id` | optional | Related project ID. |
| `due` | optional | Separate deadline if needed. |
| `priority` | optional | Integer priority. |
| `description` | optional | Notes. |
| `metadata.location` | optional | Location. |
| `metadata.participants` | optional | People/groups/institutions. |
| `metadata.commitment_type` | yes | Defaults to `appointment`. |
| `metadata.schedule_kind` | yes | `external_commitment`. |

Propose:

```bash
uv run oracle-todo event propose "치과 예약" "2026-06-12T10:30" \
  --area "건강" \
  --location "서울" \
  --with "치과" \
  --commitment-type appointment
```

## Shared item columns

SQLite table: `items`.

| Column | Type / values | Meaning |
| --- | --- | --- |
| `id` | string, primary key | Stable item ID. Prefixes: `area_`, `proj_`, `rtn_`, `task_`, `evt_`. |
| `type` | `area`, `project`, `routine`, `task`, `event`, `review`, `archive_item` | Item kind. |
| `title` | string | Human-readable title. |
| `status` | enum | Lifecycle status. |
| `area_id` | nullable item ID | Owning area. |
| `project_id` | nullable item ID | Parent project. |
| `routine_id` | nullable item ID | Source routine. |
| `parent_id` | nullable item ID | Generic parent link. |
| `description` | nullable text | Details. |
| `outcome` | nullable text | Desired result, mainly for projects. |
| `definition_of_done` | nullable text | Completion criteria, required before project activation. |
| `standard` | nullable text | Area operating standard. |
| `review_cycle` | nullable text | Area review rhythm. |
| `recurrence_rule` | nullable text | Routine recurrence rule. |
| `materialization_policy` | `single_open`, `per_occurrence` | Routine task generation policy. |
| `occurrence_key` | nullable string | Routine occurrence key for generated tasks. |
| `priority` | nullable int | Sort/attention priority. |
| `due` | nullable string | Deadline. |
| `scheduled` | nullable string | Schedule or visibility date/time. |
| `horizon` | nullable string | Planning horizon; available for future views. |
| `proposed_by` | `user`, `oracle`, `system` | Creator actor. |
| `approved_by` | nullable actor | Approver. |
| `approved_at` | nullable datetime | Approval timestamp. |
| `completed_at` | nullable datetime | Completion timestamp. |
| `archived_at` | nullable datetime | Archive/terminal timestamp. |
| `last_materialized_at` | nullable datetime | Last routine materialization timestamp. |
| `second_brain_refs` | JSON list | Read-only references into Second_Brain. |
| `metadata` | JSON object | Type-specific or integration metadata. Python field name is `metadata_`. |
| `created_at` | datetime | Creation timestamp. |
| `updated_at` | datetime | Last update timestamp. |

## Status lifecycle

| Status | Meaning |
| --- | --- |
| `proposed` | Suggested item awaiting user decision. |
| `approved` | Accepted but not necessarily active. |
| `active` | Current work or maintained routine/project. |
| `waiting` | Blocked or waiting; used for generated routine tasks when a routine is paused. |
| `paused` | Temporarily stopped. |
| `completed` | Done. Terminal. |
| `cancelled` | Cancelled. Terminal. |
| `dropped` | Intentionally abandoned. Terminal. |
| `archived` | Archived. Terminal. |
| `someday` | Deferred out of active flow. Terminal for normal updates. |
| `rejected` | Proposal rejected. Terminal. |

Terminal statuses cannot be updated through the normal update command.

## Common commands

```bash
# Database
uv run oracle-todo init

# Read
uv run oracle-todo list
uv run oracle-todo list --type task
uv run oracle-todo list --status active
uv run oracle-todo list --area-id <area-id>
uv run oracle-todo list --project-id <proj-id>
uv run oracle-todo list --routine-id <rtn-id>
uv run oracle-todo list --query "검색어"
uv run oracle-todo pending
uv run oracle-todo archive-list
uv run oracle-todo today

# State transitions
uv run oracle-todo approve <item-id> --reason "승인 사유"
uv run oracle-todo activate <item-id>
uv run oracle-todo pause <item-id>
uv run oracle-todo resume <item-id>
uv run oracle-todo complete <item-id>
uv run oracle-todo cancel <item-id>
uv run oracle-todo drop <item-id>
uv run oracle-todo archive <item-id>

# Update fields
uv run oracle-todo update <item-id> --title "새 제목"
uv run oracle-todo update <item-id> --area "재정"
uv run oracle-todo update <item-id> --project-id <proj-id>
uv run oracle-todo update <item-id> --routine-id <rtn-id>
uv run oracle-todo update <item-id> --due 2026-06-30
uv run oracle-todo update <item-id> --scheduled today
uv run oracle-todo update <item-id> --priority 1
uv run oracle-todo update <item-id> --definition-of-done "완료 기준"
uv run oracle-todo update <item-id> --recurrence-rule "월-금"
uv run oracle-todo update <item-id> --materialization-policy per_occurrence

# Exports
uv run oracle-todo export
```

## Markdown exports

`uv run oracle-todo export` writes Markdown views to `ORACLE_TODO_HOME/exports/`.

| File | Contents |
| --- | --- |
| `today.md` | Visible task list for today. |
| `events.md` | Non-archived events. |
| `projects.md` | Non-archived projects. |
| `areas.md` | Non-archived areas. |
| `routines.md` | Non-archived routines. |
| `proposed.md` | Items awaiting approval. |
| `archive.md` | Completed, archived, cancelled, dropped, or someday items. |

Exported list item metadata includes type, status, due date, scheduled date, area ID, location, and participants when available.

## Event log

SQLite table: `events`.

Every service-layer change creates a `TodoEvent` record and appends the same event to `events.jsonl`.

| Column | Meaning |
| --- | --- |
| `id` | Event ID. |
| `at` | Event timestamp. |
| `actor` | `user`, `oracle`, or `system`. |
| `action` | Action name, e.g. `propose_task`, `approve`, `materialize_routine_task`. |
| `object_type` | Affected item type. |
| `object_id` | Affected item ID. |
| `before` | JSON snapshot before the change. |
| `after` | JSON snapshot after the change. |
| `reason` | Optional reason string. |

## Dashboard/API

Run API server:

```bash
uv run uvicorn oracle_todo.api:app --reload
```

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check. |
| `GET` | `/items` | List items. Supports `status`, `type`, `include_archived`. |
| `POST` | `/areas` | Create area. |
| `POST` | `/tasks/propose` | Propose task. |
| `POST` | `/items/{id}/approve` | Approve item. |
| `POST` | `/items/{id}/complete` | Complete item. |
| `GET` | `/exports/today.md` | Render today's task Markdown. |

## Development

```bash
uv sync
uv run pytest
```

SQLite schema initialization is additive for existing databases. `init_db()` creates SQLModel tables and ensures these routine-materialization columns exist on older `items` tables:

- `materialization_policy`
- `occurrence_key`
- `last_materialized_at`

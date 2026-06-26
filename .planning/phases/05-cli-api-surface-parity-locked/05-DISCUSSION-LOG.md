# Phase 5: CLI + API Surface (parity-locked) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 5-CLI + API Surface (parity-locked)
**Areas discussed:** Output format toggle, View command structure/naming, Goal create & task link surface, API route shape

---

## Output Format Toggle (CLI)

### Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| `--json` boolean flag | Per-command `--json`, default Markdown, reuse `print_json`. | |
| `--format md\|json` | Value flag, extensible. | |
| Global flag (all commands) | One top-level flag across every command (incl. existing). | |

**User's choice:** Free-text — "json만 지원" (JSON only; no Markdown toggle for the new views).

### Default format

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown default | render_items style default, `--json` to switch. | |
| JSON default | JSON-first. | |

**User's choice:** Free-text — "JSON 기본" (JSON default).

### SC1 conflict resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Relax SC1 to JSON-only | Reword ROADMAP SC1 / REQUIREMENTS SURF-01 "Markdown + JSON" → "JSON". | ✓ |
| Keep Markdown too (honor SC1) | Markdown default + `--json`, extend render_items. | |
| JSON first, Markdown later | Defer Markdown to a follow-up. | |

**User's choice:** Relax SC1 to JSON-only.
**Notes:** JSON-only chosen because the engine targets agent workflows (agents consume JSON). The chosen option conflicted with ROADMAP SC1 / REQUIREMENTS SURF-01 ("Markdown + JSON"); surfaced the conflict explicitly and the user confirmed relaxing the success criterion. ROADMAP.md SC1 and REQUIREMENTS.md SURF-01 wording updated as part of this discussion (D-01/D-02). Legacy `list`/`today`/`pending` Markdown views untouched.

---

## View Command Structure / Naming (CLI)

### period command form

| Option | Description | Selected |
|--------|-------------|----------|
| Single `period --horizon` | `period --horizon <week\|month\|year> --period <date>`, 1:1 with `period_view`. | ✓ |
| `week`/`month`/`year` split | Three subcommands. | |

**User's choice:** Single `period --horizon`.

### date view commands

| Option | Description | Selected |
|--------|-------------|----------|
| `agenda` + `date-range` (two) | 1:1 with `agenda`/`date_range` service methods. | ✓ |
| Single `date` command | One command with day/range args. | |

**User's choice:** `agenda <date>` + `date-range <from> <to>`.

### namespace

| Option | Description | Selected |
|--------|-------------|----------|
| flat top-level | Consistent with existing `today`/`pending`/`list`. | ✓ |
| `view` subgroup | `view agenda` / `view period`. | |

**User's choice:** flat top-level.

---

## Goal Create & Task Link Surface (CLI)

### goal create command

| Option | Description | Selected |
|--------|-------------|----------|
| `goal propose` group subcommand | Mirrors `task`/`project` `{ Propose }`; status transitions reuse generic commands. | ✓ |
| flat `goal-propose` | Single top-level command. | |

**User's choice:** `goal propose` group subcommand.

### task→goal link (LINK-01/02)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `update` | Add `--parent-id` to `UpdateArgs` (Phase 2 deferred this); audited `update_item` path. | ✓ |
| New `task link` command | Dedicated command wrapping the same `update_item`. | |

**User's choice:** Reuse `update`.
**Notes:** Confirmed CLI/API both default `actor = agent`, so SC4 (agent-created goals start `Proposed`) is satisfied by existing defaults — the phase proves it via tests, not new gating.

---

## API Route Shape

### goal create endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| `POST /goals/propose` | Mirrors `/tasks/propose`, `/projects/propose`. | ✓ |
| `POST /goals` | REST resource style. | |

**User's choice:** `POST /goals/propose`.

### view endpoint grouping

| Option | Description | Selected |
|--------|-------------|----------|
| `/views/*` prefix | `/views/agenda`, `/views/date-range`, `/views/period`. | ✓ |
| flat `/agenda` etc. | Top-level, matches existing flat routes. | |

**User's choice:** `/views/*` prefix.

### view argument style

| Option | Description | Selected |
|--------|-------------|----------|
| Query strings | `?date=`, `?horizon=&period=`, `?from=&to=`; `axum::Query` binding. | ✓ |
| Path segments | `/views/period/week/2026-06-22`. | |

**User's choice:** Query strings.
**Notes:** Task→goal linking on the API reuses the existing `PATCH /items/:id` (`update_item`) endpoint — only the update DTO gains a `parent_id` field.

---

## Claude's Discretion

- JSON serialization shape of view outputs — reuse existing `PeriodView`/`GoalNode` serde types and date-view shapes.
- Error response surface — existing `TodoError` → exit/status mapping (Validation → 2/400).
- Exact JSON field names / envelope, within the parity constraint.

## Deferred Ideas

- Markdown rendering of date/period views — dropped from v1 (JSON-only). Add a `--format`/`--json` toggle + `render_*` function later if a human-facing view is wanted.

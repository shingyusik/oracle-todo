---
name: convention-drift-audit
description: Use when asked to check code against project conventions — naming, file placement, import style, module layout, comment policy, data-model patterns — or to find files drifting from established codebase patterns. Error handling and logging conventions are covered by error-logging-audit, not here.
---

# Convention Drift Audit

## Objective

Report code that drifts from the project's declared or de facto conventions: naming, module structure, imports, file placement, comments, and data-modeling patterns. **Excluded:** error-handling and logging conventions — those belong to the `error-logging-audit` skill; never duplicate them here.

## Convention Discovery

1. Read declared conventions: `docs/conventions/`, style sections of `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`, linter/formatter configs (`ruff`, `eslint`, `prettier`, `editorconfig`).
2. For anything undeclared, derive the **majority pattern** from the codebase itself (e.g. 90% of modules follow layout X → X is the de facto convention) and label findings against it as de facto, lower confidence.
3. Skip rules a configured linter already enforces — auditing them duplicates CI. Focus on what tooling cannot catch.

## Audit Checks

1. **Naming** — do names reveal unit, direction, state, and responsibility? Flag vague buckets (`data`, `info`, `util`, `helper`, `manager`, `handler`, `temp`) used without qualification; flag names violating the project's declared casing/suffix rules (e.g. config modules, exception classes, test files).
2. **File placement** — files outside the established directory pattern for their kind (a model in a CLI folder, a test next to source when tests live in `tests/`).
3. **Import style** — relative vs absolute against the declared rule; import ordering; type-only import conventions; banned modules (e.g. legacy path APIs when the project mandates a newer one).
4. **Module layout** — required module preamble (future imports, headers), `__init__`/index file policy, entrypoint placement.
5. **Data-model patterns** — the project's chosen idiom for data carriers (frozen dataclasses, records, schemas): flag ad-hoc dicts/tuples where the idiom is established, and mutable defaults where immutability is the rule.
6. **Comments & docstrings** — comments restating obvious code, commented-out code, docstrings violating the declared policy (e.g. docstrings on self-documenting structures the project says to leave bare).

## What NOT to Flag

- Error-handling and logging style — hand off to `error-logging-audit`.
- Anything the linter config explicitly disables — that's a project decision, not drift.
- Generated code, vendored code, and migration files.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | MEDIUM (declared rule broken) / LOW (de facto pattern broken) |
| Location | `path:line` |
| Rule | The convention, and its source (doc / config / majority pattern) |
| Evidence | The drifting code, abbreviated |
| Suggestion | Conforming form |

Group findings by rule, not by file — ten violations of one rule is one systemic finding with ten locations.

## Safety Rules

1. Audit only — no edits.
2. Cite the rule's source for every finding; if you can't point to a doc, config, or majority pattern, drop the finding.
3. Convention drift is never HIGH severity on its own — it doesn't break behavior.

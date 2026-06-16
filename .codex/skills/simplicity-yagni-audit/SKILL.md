---
name: simplicity-yagni-audit
description: Use when asked to find unnecessary complexity, over-engineering, speculative abstractions, dead extension points, or simplification candidates — functions doing too much, deep nesting, single-use factories/managers, unused configurability.
---

# Simplicity & YAGNI Audit

## Objective

Report removable complexity: code that does more than the problem requires (KISS violations) and structure built for futures that never arrived (YAGNI violations). Report only — do not simplify code during the audit.

## Convention Discovery

1. Read project style/convention docs (`docs/conventions/`, `CLAUDE.md`, `CONTRIBUTING.md`) for declared limits — function size, nesting depth, decomposition rules.
2. Where no limits are declared, use defaults: a function past ~40 lines or ~4 nesting levels, or mixing more than one responsibility, is a candidate.

## Audit Checks

**Complexity (KISS):**

1. Functions/methods doing several jobs at once — parse + validate + transform + persist in one body.
2. Deep nesting and branch ladders that flatten with guard clauses or early returns.
3. Roundabout implementations where a direct expression or stdlib/built-in call exists.
4. Control flow split across callbacks/effects/hooks that reads simpler as one sequential function.

**Speculation (YAGNI):**

5. Abstractions with exactly one user — a manager/factory/adapter/registry/wrapper class wrapping a single concrete implementation with no second implementation planned in code or docs.
6. Configuration options, plugin points, or feature flags nothing sets — search for callers passing non-default values; zero hits means the option is speculative.
7. Type/interface hierarchies more elaborate than the implementations beneath them.
8. Heavy dependencies pulled in for one small function a few lines of local code would cover.

## What NOT to Flag

- Single-use abstractions that are a declared project convention (e.g. ports at external boundaries for testability) — check convention docs before flagging.
- Complexity inherent to the domain (numerical edge cases, protocol quirks). Flag accidental complexity, not essential complexity.
- Code that is verbose but flat and readable. The target is hard-to-follow, not long.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | HIGH (actively hard to maintain) / MEDIUM (clear simplification) / LOW (style-level) |
| Location | `path:line` |
| Type | KISS (simplify) / YAGNI (remove or inline) |
| Evidence | What it does now, and the single-user / zero-caller proof for YAGNI items |
| Suggestion | Concrete simpler shape |
| Risk | Behavior-change likelihood: none / low / needs-tests-first |

## Safety Rules

1. Audit only — no edits.
2. YAGNI findings require usage evidence: show the search proving one (or zero) call sites.
3. Never propose removing public API surface without noting external consumers may exist.

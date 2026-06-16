---
name: quality-audit
description: Use when asked for an overall code quality audit, quality report, or health check covering multiple dimensions at once — or when the user says "run all quality audits" or asks which quality aspects need attention.
---

# Quality Audit (Orchestrator)

## Objective

Run the individual quality audit skills and merge their findings into one ranked report. This skill does no auditing itself — it selects, dispatches, and synthesizes.

## Available Audits

| Skill | Dimension |
| --- | --- |
| `architecture-boundary-audit` | Package/layer boundaries, dependency direction, docs-vs-structure |
| `simplicity-yagni-audit` | Over-complexity, speculative abstraction |
| `duplication-dry-audit` | Meaningful duplication, reimplemented utilities |
| `convention-drift-audit` | Naming, placement, imports, module/data-model patterns |
| `error-logging-audit` | Swallowed errors, lost causes, logging discipline |
| `constants-config-audit` | Magic values, hardcoded paths, embedded strings/templates |
| `test-quality-audit` | Over-mocking, weak assertions, unprotected behavior |
| `docs-sync-audit` | Documentation vs code contradictions |
| `resource-lifecycle-audit` | Leaks, hangs, unbounded memory, expensive-call waste |

## Workflow

1. **Select** — if the user named dimensions, run only those. Otherwise run all except `resource-lifecycle-audit` (include it when the project manages long-lived external resources — containers, daemons, paid APIs).
2. **Scope** — resolve a common scope (whole repo or the user's subtree) and pass the identical scope to every audit.
3. **Dispatch** — run each selected audit as an independent subagent in parallel, each instructed to follow its skill and return only its findings table. Do not run audits sequentially inline; their searches don't depend on each other.
4. **Merge** — combine findings:
   - Dedupe cross-audit overlaps (the same `path:line` flagged by two audits becomes one entry citing both dimensions).
   - Re-rank globally: bug-class HIGHs (swallowed errors, leaks, false-confidence tests, broken doc commands) above structural HIGHs, above all MEDIUM/LOW.
5. **Synthesize** — produce the final report:
   - **Top findings** — at most 10, globally ranked, full evidence.
   - **Per-dimension summary** — one line per audit: finding count by severity + the single most important item.
   - **Systemic patterns** — issues recurring across dimensions (e.g. one module flagged by 4 audits = refactor hotspot).
   - **Suggested order of attack** — what to fix first and why, separating quick wins from danger zones.

## Safety Rules

1. Report only — neither this skill nor any dispatched audit edits code.
2. Preserve each audit's evidence (`path:line`) through the merge — no finding survives synthesis without its location.
3. If a dispatched audit fails or returns nothing, say so in the report rather than silently omitting the dimension.

---
name: error-logging-audit
description: Use when asked to audit error handling or logging — swallowed exceptions, broad catches, lost stack traces, error-as-return-value, log-and-raise double reporting, inconsistent logging frameworks, wrong log levels, or context-free error messages.
---

# Error Handling & Logging Audit

## Objective

Report defects and convention drift in how the project raises, propagates, and logs errors. Some findings here are latent bugs (swallowed exceptions), not just style — severity must reflect that. Report only — no fixes during the audit.

**Default scope:** production source code. Walk test code only to apply the test exemption below; do not audit tests' own error style (that belongs to `test-quality-audit`).

## Convention Discovery

1. Read the project's declared error/logging rules: error-handling and logging sections of convention docs, `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`. If one source mirrors another, read it once; on conflict, prefer the most specific convention doc.
2. Identify the project's intended idioms: exception hierarchy and base classes, the designated logging framework per package, level policy, message format, and the sanctioned exit path for CLI/entrypoint errors.
3. Note which direction declared rules constrain. "Reserve `error` for failures" forbids `error` on non-failures; it does not by itself forbid logging a failure at `warning`. Flag only directions a rule actually constrains; the unconstrained direction is at most LOW de facto drift.
4. Where undeclared, derive the majority pattern and mark findings against it as de facto.

## Audit Checks

**Error handling:**

1. **Swallowed exceptions** — `except`/`catch` blocks that ignore the error or log-and-continue where the caller needs to know. Latent bugs; default HIGH.
2. **Overbroad catches** — catching the base exception type around large blocks, masking unrelated failures. Check whether the catch re-raises or narrows — and follow the rewrapped error downstream: if a config flag or fallback path can suppress it, programming errors are being converted into routine, ignorable failures. That suppression path is part of this finding.
3. **Lost causes** — re-raising or wrapping without preserving the original error/stack (e.g. missing exception chaining), so root causes vanish from traces.
4. **Hierarchy drift** — project-defined exceptions not inheriting the package's declared base class; raising raw built-in exceptions where a domain exception exists. Trace the consequence: if entrypoint handlers catch only the domain base class, a stray exception type changes user-facing behavior (raw traceback) — that escalates severity.
5. **Error as return value** — returning null/None, sentinel values, or error tuples where the project's rule is to raise; callers that then forget to check.
6. **Entrypoint policy** — CLI/handler entrypoints bypassing the sanctioned exit/handling path (e.g. ad-hoc print-and-exit instead of the project's error-exit helper); expected errors leaking raw tracebacks to users, or unexpected errors being suppressed.
7. **Log-and-raise double reporting** — logging an exception (especially with traceback) at the same site that raises it, so the same failure is reported twice and tracebacks reach output the project's policy keeps clean. Log or raise at one level; not both at the same one.
8. **Message quality** — error and log messages without concrete context (no path, value, or identifier involved); messages that can't be acted on; messages stating something untrue about the code's behavior (e.g. naming one backend when several are possible).

**Logging:**

9. **Framework consistency** — multiple logging frameworks or acquisition patterns mixed within one package against the declared per-package choice; `print()` used where a logger is mandated.
10. **Level discipline** — levels used against the declared policy (e.g. `error` for non-failures, user-needed messages at `debug`), respecting rule directionality per Convention Discovery step 3.
11. **Format drift** — placeholder style, structured-logging fields, or progress-message format deviating from the declared pattern.
12. **Sensitive data** — secrets, tokens, or credentials interpolated into log messages. Always HIGH.

## What NOT to Flag

- Broad catches at the topmost entrypoint whose declared job is catch-everything-and-exit-cleanly.
- Intentional suppression or error-as-data that is evident at the site — either a comment explaining why, or structure that makes intent unmistakable (e.g. a typed result object with status/error fields that callers consume as data). If intent is structural but the project rule literally forbids the pattern, report LOW with a suggestion to document the exemption, not MEDIUM.
- Raw built-in exceptions used as internal invariant guards for can't-happen states — especially where a domain exception would be caught and softened by recovery paths, defeating the guard. At most LOW, suggesting a clarifying comment.
- `print()`/stdout that is a documented machine-readable CLI output contract, distinct from diagnostic logging.
- Test code asserting on exceptions/logs.

## Severity

| Level | Meaning |
| --- | --- |
| HIGH | Bug-class: swallowed error, lost cause, leaked secret — **or any lower-category finding whose traced consequence is bug-class** (e.g. hierarchy drift that makes an expected failure bypass the entrypoint handler). Consequence wins over category; name both. |
| MEDIUM | Declared rule broken, no bug-class consequence traced |
| LOW | De facto drift, or rule-forbidden patterns with structurally evident intent |

## Report Format

Output a single markdown table, one row per finding:

| Severity | Location | Check | Evidence | Suggestion | Rule source |
| --- | --- | --- | --- | --- | --- |

- Location: `path:line`. Evidence: offending block, abbreviated. Rule source: the doc/config citation, or "de facto: majority pattern".
- Order rows HIGH first. If a severity class is empty — especially HIGH — state that explicitly; absence is an audit result.
- After the table, list sites deliberately **not** flagged under the exemptions, with one-line reasons — it proves the exemptions were applied, not skipped.

## Safety Rules

1. Audit only — no edits.
2. Before flagging a swallowed exception, read the surrounding code: confirm no fallback/retry/alternate path makes the suppression intentional.
3. Every finding fills the Rule source column; if you can't cite a doc, config, or majority pattern, drop the finding.

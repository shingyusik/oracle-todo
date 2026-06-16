---
name: test-quality-audit
description: Use when asked to audit test quality — over-mocking, weak assertions, missing error-path tests, tests coupled to implementation details, skipped tests, or coverage-gate risk areas.
---

# Test Quality Audit

## Objective

Report tests that provide false confidence (pass without protecting behavior) and behavior that lacks tests. Coverage percentage measures execution, not protection — this audit measures protection. Report only — no test edits during the audit.

## Convention Discovery

1. Read the project's declared testing rules: testing sections of convention docs, `CLAUDE.md` / `CONTRIBUTING.md`, test-runner config (coverage gate, markers policy).
2. Identify the project's mocking boundary policy — which layers may be mocked (external systems) and which must not be (domain logic).
3. Locate test directories and shared fixture files.

## Audit Checks

1. **Mock-boundary violations** — tests mocking the project's own domain logic, validation, or pure utilities instead of only external boundaries (network, containers, LLM clients, clock, filesystem where applicable). Such tests pass even when the real logic breaks.
2. **Assertion strength** — tests with no assertions; truthiness-only assertions (`assert result` where an exact value is checkable); assertions on mock call counts alone with no assertion on output or state.
3. **Error-path coverage** — for each public function that raises/returns errors, does any test exercise the failure path and assert the error type *and* message/content? Flag error-handling code with zero failing-input tests.
4. **Implementation coupling** — tests asserting private internals, call order, or intermediate representations that break on refactor without behavior change.
5. **Disabled tests** — skipped/xfail/commented-out tests, especially against a declared no-skip policy; conditional skips whose condition is always true in CI.
6. **Structure drift** — tests violating the declared shape: arrange-act-assert ordering, one-behavior-per-test, naming pattern, fixture placement.
7. **Coverage-gate risk** — modules far below the project's coverage gate, and *hollow coverage*: lines executed by tests that assert nothing about them.
8. **Test interdependence** — tests relying on execution order, shared mutable module state, or artifacts a previous test wrote.

## What NOT to Flag

- Heavy mocking in tests explicitly targeting the boundary layer itself (the wrapper around the external system is the unit under test).
- Smoke tests intentionally asserting only "does not crash", when labeled as such.
- Snapshot/golden tests — coupling to output is their design.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | HIGH (false confidence: mocked domain, assertion-free, hollow coverage) / MEDIUM (missing error-path, disabled tests) / LOW (structure drift) |
| Location | `path:line` (test) — plus the production code left unprotected, if any |
| Check | Which check above |
| Evidence | The weak test fragment, abbreviated |
| Suggestion | What the test should assert or which scenario to add |

End with a short list of **unprotected behaviors** — production code paths no test would catch a regression in.

## Safety Rules

1. Audit only — no edits, and never run destructive test commands; read tests, run suites only if the project's standard test command is known and safe.
2. Before flagging a mock as a boundary violation, confirm the mocked symbol is project domain logic, not an external wrapper.
3. Do not equate low coverage with bad tests or high coverage with good ones — evidence is assertion content, not percentages.

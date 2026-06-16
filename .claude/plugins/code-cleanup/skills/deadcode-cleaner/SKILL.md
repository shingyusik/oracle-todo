---
name: deadcode-cleaner
description: Remove dead code, legacy code, and unnecessary comments that are no longer used, then verify safety by running available tests and confirming deleted symbols/files have no remaining references in code search. Use when asked to clean up unused code across the whole repository or within a specific folder scope (for example, backend/*).
---

# Dead Code Cleaner

## Objective

Delete unused or obsolete code and unnecessary comments without behavior regressions.

## Scope Resolution

1. Resolve the cleanup scope from the user request.
2. If the user specifies folders, inspect only those folders and their descendants.
3. If the user does not specify scope, inspect all source code from repository root.
4. Exclude generated/vendor artifacts unless the user explicitly asks to include them:
   - `.git`, `node_modules`, `.venv`, `dist`, `build`, `coverage`, `.next`, `.cache`

## Cleanup Workflow

1. Discover project test commands before editing.
2. Create an initial snapshot:
   - repository status
   - candidate files/symbols/comments
   - current test baseline (if tests exist)
3. Identify cleanup candidates conservatively:
   - unreferenced files/modules
   - exported-but-never-imported symbols
   - functions/classes/constants with no runtime references
   - legacy paths replaced by newer implementations
   - comments that are obsolete, misleading, or purely restating obvious code
4. Validate each candidate before deletion:
   - run repository search for symbol/file references with `rg`
   - inspect dynamic usage risks (reflection, string-based dispatch, framework auto-loading, config-based wiring)
   - keep code/comments if evidence is ambiguous
5. Delete incrementally in small logical units.
6. Re-run all available tests after deletions.
7. Perform post-delete proof search:
   - search for every removed symbol name
   - search for removed file paths/imports
   - confirm no remaining references in source code
8. Report results with evidence:
   - what was removed and why
   - tests executed and outcomes
   - post-delete search commands and zero-reference confirmations

## Comment Cleanup Policy

1. Remove comments that no longer match current behavior.
2. Remove comments that only paraphrase obvious code and add no maintenance value.
3. Keep operational directives and tooling comments, including patterns such as:
   - `eslint-disable`, `ts-ignore`, `noqa`, `pragma`, coverage/tooling directives
4. Keep comments that capture non-obvious business rules, edge-case rationale, or external constraints.
5. If uncertain whether a comment is semantically important, keep it and document why.

## Test Policy

1. If any tests exist, run all discoverable test suites by default.
2. Prefer project-standard commands (for example, `npm test`, `pnpm test`, `yarn test`, `pytest`, `go test ./...`, `cargo test`).
3. If a suite is flaky or fails before edits, record baseline failures and continue verification with clear attribution.
4. Do not claim safety if tests were skipped or unavailable.

## Search Verification Policy

For each removed symbol/file, execute explicit code search and capture the result.

Suggested checks:

```bash
rg -n "<removed_symbol>" <scope>
rg -n "<removed_file_or_import_path>" <scope>
```

Accept deletion only when remaining hits are zero or intentionally non-runtime references (for example, changelog notes).

## Safety Rules

1. Do not remove code solely by naming conventions like `legacy` or `old`.
2. Do not remove comments solely by age; remove only when clearly unnecessary or stale.
3. Prefer minimal, reversible edits over broad deletions.
4. When uncertainty remains, keep code/comments and report rationale.
5. Never hide risk: state untested paths and assumptions explicitly.

## Default Execution Behavior

1. No user scope provided: inspect repository root.
2. User gives folder scope (example: "backend code cleanup"): inspect only that subtree (example: `backend/*`).
3. Always finish with both:
   - all available tests executed
   - search-based zero-reference verification for removed code

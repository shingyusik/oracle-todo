---
name: docs-sync-audit
description: Use when asked to audit whether documentation matches the code — stale CLI options, outdated architecture descriptions, commands that no longer work, docs describing removed features, or undocumented user-facing behavior. Full-repo sweep, complementing change-driven doc updaters.
---

# Docs Sync Audit

## Objective

Report contradictions between documentation and current code across the whole repo. This is a periodic full sweep — distinct from change-driven doc updates that react to a single diff. Report only — no doc edits during the audit.

## Scope Resolution

1. Inventory doc surfaces: `README.md`, `docs/**`, `CLAUDE.md` / `AGENTS.md`, package-level READMEs, example/usage files.
2. Inventory code surfaces docs make claims about: CLI entrypoints and flags, config schemas, public APIs, directory structure, commands, environment variables.
3. If the user scopes the audit (one doc, one package), audit only that slice.

## Audit Checks

1. **Commands** — every command a doc tells the user to run: does the executable/script/task exist with those flags? Verify against arg-parser code or manifest scripts; prefer static verification, run only obviously safe read-only commands (`--help`, `--version`).
2. **CLI/API surface** — options, endpoints, functions, and parameters documented vs actually defined. Flag both stale (documented, gone) and missing (exists, user-facing, undocumented).
3. **Config and environment** — documented config keys, env vars, and defaults vs the code that reads them; required-vs-optional mismatches.
4. **Structure descriptions** — directory trees, package lists, and module maps in docs vs the actual tree.
5. **Behavioral claims** — "X happens automatically", "Y is created on first run", numeric limits/gates cited in docs: locate the implementing code and confirm.
6. **Ghost docs** — entire docs (or sections) describing features, workflows, or structures that no longer exist; docs explaining a previous architecture in present tense.
7. **Internal doc consistency** — two docs making contradictory claims about the same thing (also flag when code matches one of them — say which).

## What NOT to Flag

- Aspirational sections clearly marked as planned/roadmap/TODO.
- Historical records (changelogs, ADRs, postmortems) — they describe the past by design.
- Tone/structure/completeness issues with no code contradiction — that's doc editing, not sync.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | HIGH (doc instruction fails if followed — broken command, wrong required config) / MEDIUM (stale description) / LOW (missing documentation) |
| Doc location | `path:line` or section heading |
| Code evidence | `path:line` proving the contradiction |
| Claim vs reality | One line each |
| Suggestion | Fix the doc / fix the code / delete the section — say which side is wrong and why |

## Safety Rules

1. Audit only — no edits to docs or code.
2. Every finding pairs a doc location with code evidence; a doc that merely "feels outdated" is not a finding.
3. Run nothing with side effects while verifying commands.

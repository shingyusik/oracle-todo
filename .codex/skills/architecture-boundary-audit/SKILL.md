---
name: architecture-boundary-audit
description: Use when asked to audit architecture boundaries, layer violations, dependency direction, import cycles, or check whether the documented architecture matches the actual code structure — in monorepos, multi-package repos, or layered single packages.
---

# Architecture Boundary Audit

## Objective

Report violations of declared architecture boundaries: cross-package imports, wrong-direction layer dependencies, dependency cycles, concrete-implementation leaks across abstraction ports, and drift between architecture docs and the actual tree. Report only — do not move or edit code.

## Convention Discovery

Before auditing, establish what the boundaries are supposed to be:

1. Read authoritative docs: `docs/architecture/`, `ARCHITECTURE.md`, convention docs, root agent-instruction files (`CLAUDE.md`, `AGENTS.md`), `CONTRIBUTING.md`. Treat generated analysis output (e.g. planning/scratch directories) as non-authoritative.
2. Read build/package manifests (workspace configs, `pyproject.toml`, `package.json`) for declared packages; read `.gitignore` to learn which directories are generated output (needed for the ownership check).
3. Classify every doc statement as **rule** or **description**: normative phrasing ("must not", "never", "only") = rule; dependency tables and prose describing current structure = description. Rules set boundaries; descriptions can merely drift.
4. If no boundary is documented, infer the de facto layering from directory structure and the import graph, and state that findings are against inferred boundaries.

## Audit Checks

1. **Cross-package isolation** — packages documented as independent must not import each other. Search each package's source for imports resolving into a sibling package.
2. **Layer direction & cycles** — within a package, identify the layer order (e.g. entrypoint → orchestration → domain → infrastructure). Flag imports going against that direction, and module-level cycles. A runtime deferred import (inside a function) that completes a cycle is a real cycle and is flagged even when the matching type-only import is sanctioned — the deferral hides the cycle, it doesn't remove it. Skip-layer imports in the *correct* direction (entrypoint importing infrastructure directly) are not violations; if the doc's dependency table omits them, report as docs drift.
3. **Dependency inversion (DIP) at external boundaries** — external systems (LLM clients, containers, network, third-party services) should be reached through an abstraction (interface, protocol, port). Concrete construction must happen *somewhere*: the composition root (entrypoint, factory, DI wiring) is exempt. Flag (a) non-root layers importing concrete implementations when an abstraction exists, and (b) composition buried inside mid-layer orchestration instead of the entrypoint — (b) is a smell, not a break.
4. **Mixed responsibilities** — modules where UI/CLI concerns, orchestration, domain logic, and I/O are tangled in one unit so no boundary can be drawn around them.
5. **Docs vs structure** — packages, directories, layers, and dependency tables that docs describe vs what exists. Scope: structural claims in authoritative docs only — full docs-vs-code content auditing belongs to `docs-sync-audit`.
6. **Shared-resource ownership** — root-level shared areas (config files, example inputs, scripts, output dirs): flag when no package clearly owns one, when one package writes into another's area, when a generated area is neither documented nor gitignored, or when output paths are working-directory-relative so the write target depends on the caller.

## What NOT to Flag

- Test code importing across layers of its own package.
- Type-only imports used to break cycles when conventions allow them (the runtime half of the cycle is still flagged — see check 2).
- Concrete construction at the composition root (check 3).

## Severity

| Level | Applies to |
| --- | --- |
| HIGH | A normative **rule** broken, uncontradicted by any other authoritative doc |
| MEDIUM | Direction/cycle/DIP smells (checks 2–3); ownership gaps with real write-conflict or repo-pollution risk (check 6) |
| LOW | Docs drift (descriptions stale); inferred-boundary findings; doc-sanctioned exceptions (see below) |

- **Contradicted rules:** when one authoritative doc states a rule and another contradicts it (or documents the violating practice), report the contradiction at MEDIUM and do not pick a side — recommend reconciling the docs.
- **Doc-sanctioned exceptions:** a direction violation the docs themselves explicitly allow is LOW; suggest removing the exception rather than suppressing the finding.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Columns:

| Severity | Location | Rule | Evidence | Suggestion |
| --- | --- | --- | --- | --- |

- Location: `path:line` of the offending import/structure; for missing structures, the doc line making the claim.
- Rule: which boundary, its source, and whether it's a rule, description, or inferred.
- After the table: **clean checks** (checks that passed, with the sweep that proved it), **move candidates** (safe relocations), and **danger zones** (violations entangled enough that fixing them risks regressions — name what they're entangled with).

## Safety Rules

1. Audit only — never edit, move, or delete code during this skill.
2. Every finding needs concrete evidence (`path:line` plus the rule source). No findings from naming intuition alone.
3. If docs and code disagree, report the contradiction; do not assume which side is correct.

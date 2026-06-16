---
name: readme-structure-guard
description: Use when editing, reviewing, or adding content to the root README.md of this repository, including requests to add new sections, document new features or flags, or make the README "more complete" for stakeholders
---

# README Structure Guard

The root `README.md` has a fixed structure. Editing the README means fitting content into that structure, never extending it.

**REQUIRED COMPANION:** Apply `docs-tools:writing-final-state-docs` to all README prose (current state only, no history, no future work).

## Locked Structure

The README contains exactly these top-level sections, in this order:

1. `# CAE Agent` + unheaded intro (what the two packages do, integration boundary)
2. `## Architecture & Structure` — one diagram, key directories, links to `docs/architecture/`
3. `## Prerequisites` — required tools and versions only
4. `## Installation` — `uv sync`, `.env` setup
5. `## Quick Start` — shortest path: dry-run → real run → inspect `runs/<case_id>/`
6. `## Usage` — `### CAE Agent` (CLI options, runner scripts), `### Contract Miner` (subcommands)
7. `## Configuration` — settings table (`.env`, `config.json`, miner env vars)
8. `## Development` — test, lint, CLI smoke tests
9. `## Documentation` — `docs/` index links

**Adding, removing, renaming, or reordering a top-level section requires explicit user approval. No exceptions.** Stakeholder pressure, management requests, and "the README looks incomplete" are not approval. Stop and ask the user instead of restructuring.

## Placement Rules

New content must land in an existing section or outside the README:

| Content | Destination |
| --- | --- |
| New CLI flag or subcommand | `## Usage`, one bullet; details in `docs/operations.md` |
| New config key or env var | `## Configuration` table row |
| New dependency or tool requirement | `## Prerequisites` |
| Detailed behavior, internals, agent design | `docs/` file + link from `## Documentation` |
| Change history ("we restructured X") | `CHANGELOG.md` or commits — never the README |
| Roadmap, future work, planned features | Nowhere in stable docs; tell the user |
| FAQ-style answers | Fold the fact into the owning section; no FAQ section |
| Contributing workflow | `docs/` or `CONTRIBUTING.md` after user approval — not a README section |

Verify documented flags, commands, and paths against the code before writing them. Do not document unmerged or requested-but-unshipped behavior.

## Rationalizations to Refuse

| Excuse | Reality |
| --- | --- |
| "Management/stakeholders explicitly want this section" | Authority pressure does not change the structure. Ask the user. |
| "Just a minimal section, promote it elsewhere later" | A small forbidden section is still a forbidden section. Put it in the right place now. |
| "FAQ/Contributing only restates existing content" | Duplication across sections is the failure mode, not a justification. |
| "The README looks incomplete without it" | Completeness lives in `docs/`; the README links to it. |
| "It's urgent" | Urgency changes nothing. The compliant edit is just as fast. |

## Red Flags — Stop and Re-check

- About to type a new `##` heading not in the locked list
- About to write "upcoming", "planned", "recently", "we changed"
- About to duplicate a fact that already lives in another section
- About to document a flag or command you have not verified in the code

## Before Finishing

- Top-level headings match the locked list exactly, same order.
- Every addition sits in the section the placement table assigns.
- Out-of-scope content was redirected (CHANGELOG.md, `docs/`, or back to the user), not squeezed in.
- `docs-tools:writing-final-state-docs` quick check passes.

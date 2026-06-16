---
name: duplication-dry-audit
description: Use when asked to find duplicated logic, copy-pasted modules, repeated constants/messages/mappings, or reimplementations of existing utilities — and to judge which duplication is worth extracting versus leaving alone.
---

# Duplication (DRY) Audit

## Objective

Report *meaningful* duplication: repetition that will drift apart and cause bugs. Equally important, identify false duplication where extraction would make the code worse. Report only — do not deduplicate during the audit.

## Core Rule

**2 occurrences = observe. 3+ occurrences = extraction candidate. Different meaning = never extract.**

Two pieces of code that look identical but serve different business meanings will evolve apart; merging them couples unrelated change reasons. Similarity of text is not similarity of meaning.

## Audit Checks

1. **Repeated logic** — same algorithm/validation/transformation implemented in multiple places. Search by distinctive expressions, not function names.
2. **Repeated constants and literals** — same magic value, error message, format string, or mapping table appearing in several modules.
3. **Copy-paste modules** — files/components that differ only in configuration values, names, or one branch. Diff suspicious sibling files to confirm.
4. **Reimplemented utilities** — code that rebuilds something an existing project utility, stdlib function, or already-installed dependency provides. Search the project's own util/helper modules before confirming.
5. **Parallel mappings** — the same enum/status/type mapped in multiple switch tables that must be updated together (shotgun-surgery risk).

## False-Duplication Check (mandatory)

For every extraction candidate, answer before reporting:

- Do all occurrences change for the **same reason**? If one serves domain A and another domain B, mark as false duplication — do not recommend extraction.
- Would the shared abstraction need flags/parameters to cover all call sites? Flag-laden helpers are worse than duplication.

Report confirmed false duplications too, as "leave alone" entries — they prevent future well-meaning merges.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | HIGH (3+ copies, drift already visible) / MEDIUM (3+ copies, in sync) / LOW (2 copies, observe) |
| Locations | All `path:line` occurrences |
| Verdict | extract / observe / leave-alone (false duplication) |
| Evidence | The repeated fragment, abbreviated |
| Suggestion | Where the extracted unit would live (existing util module if one fits) |

## Safety Rules

1. Audit only — no edits.
2. Count occurrences with actual search results; never report "appears several times" without locations.
3. When meaning is ambiguous, default to **observe**, not extract.

---
name: constants-config-audit
description: Use when asked to find magic numbers, hardcoded paths, embedded user-facing strings, inline prompts/templates, or misplaced sample data and assets — anything that should be a named constant, config entry, or relocated resource.
---

# Constants, Config & Assets Audit

## Objective

Report values and content embedded in logic that belong in named constants, configuration, or dedicated resource locations. Report only — no extraction during the audit.

## Convention Discovery

1. Identify where the project already keeps such things: config files, settings/config modules, constants modules, template/prompt directories, asset and example directories.
2. Read convention docs for declared rules on configuration loading and asset placement.
3. The suggestion for each finding should target an **existing** destination; propose a new module/file only when none fits.

## Audit Checks

1. **Magic numbers** — unexplained numeric literals in logic: thresholds, retry counts, timeouts, buffer sizes, physical/domain parameters (units, tolerances, coordinates, default dimensions). Exempt: 0, 1, -1, and values whose meaning the immediate expression makes obvious.
2. **Hardcoded paths and URLs** — absolute paths, environment-specific paths, service URLs, container/image names embedded in logic instead of config or environment.
3. **User-facing strings in logic** — UI copy, CLI help beyond the arg parser, long error-message templates, manual-style explanatory text mixed into business logic.
4. **Embedded templates and prompts** — multi-line LLM prompts, file templates, or generated-document skeletons defined inline inside functions rather than module-level constants or template files.
5. **Duplicated config defaults** — the same default value defined both in config files and in code, where the two can drift.
6. **Asset placement** — sample data, fixtures, example inputs, images, models scattered outside the project's designated directories; identical assets duplicated in several places.

## What NOT to Flag

- Values used exactly once where a name adds no information (`sleep(0.1)` in a retry loop with a comment).
- Test-local literals — tests legitimately inline expected values.
- Constants already named and module-level, even if you'd group them differently.

## Report Format

Output a single markdown table, one row per finding; if a severity class is empty, state it explicitly. Fields:

| Field | Content |
| --- | --- |
| Severity | MEDIUM (drift risk: duplicated defaults, env-specific paths) / LOW (readability: magic number, inline string) |
| Location | `path:line` |
| Kind | magic-number / path / user-string / template / config-dup / asset |
| Evidence | The embedded value, abbreviated |
| Destination | Existing config file, constants module, or asset dir it should move to |

## Safety Rules

1. Audit only — no edits.
2. Every suggestion names a concrete destination; "move to config" without a target is not a finding.
3. Domain values need domain care: flag a numeric parameter only when its meaning is genuinely opaque at the call site.

---
name: docs-change-updater
description: Use when repository changes require README.md or docs/ updates so documentation matches current code, architecture, commands, configuration, APIs, or user-facing behavior
---

# Docs Change Updater

Update project documentation from repository changes only.

## Companion Skill

Refer to `docs-tools:writing-final-state-docs` when a documentation update needs final-state writing guidance. Use it especially when edits might drift into process notes, change history, future work, topic sprawl, or cross-reference clutter.

Refer to `docs-tools:readme-structure-guard` whenever this skill touches the root `README.md`. It defines the locked README section structure and placement rules.

Stable docs describe the current result only. This skill does not manage plans, roadmaps, backlogs, todos, changelogs, release notes, or future-work sections.

## Workflow

1. Collect change context.
   - Run `git status --short`.
   - Run `git diff --name-status` and `git diff --cached --name-status`.
   - Run `git log --oneline --decorate -n 10` to understand recent landed work.
   - When the working tree is clean but docs still need sync, inspect the relevant commits with `git show --stat --name-status <commit>`.
   - Run `python3 scripts/find_doc_targets.py --format markdown` from this skill directory to identify possible documentation targets.

2. Read only the files needed to update documentation.
   - Always inspect root `README.md` when it exists.
   - Always inspect root `CLAUDE.md` and `AGENTS.md` when they exist.
   - Inspect impacted files under `docs/`.
   - Inspect source files, tests, migrations, config, or scripts referenced by the diff before documenting behavior.
   - Do not inspect planning files unless they are themselves the documentation target explicitly requested by the user.

3. Update existing documents first.
   - Reflect behavior, architecture, API, config, and user-facing flow changes from code diffs.
   - Treat `README.md` and files in `docs/` as current-state references, not implementation history logs.
   - Remove completed/removed implementation records, legacy migration notes, and stale instructions that no longer match current code, unless a file is explicitly meant to be historical.
   - Do not add todo, roadmap, backlog, follow-up, or future-work sections.
   - Keep existing tone and structure unless it is clearly broken.

4. Create missing documents when coverage gaps exist.
   - If changed implementation areas have no corresponding docs, create new docs under `docs/`.
   - Prefer predictable paths such as `docs/<area>.md` unless repository conventions require another location.
   - Link new docs from related index pages when appropriate.

5. Validate documentation coherence.
   - Ensure no contradictions between `README.md` and `docs/`.
   - Ensure paths, commands, and feature names are consistent with current code.

6. Sync agent context files (`CLAUDE.md`, `AGENTS.md`).
   - Update facts inside existing sections only — e.g. Docs Map paths, Commands, Gotchas, Skills & Plugins entries — when the change made them stale.
   - The section structure is frozen: never add, remove, rename, or reorder sections in these files. If new content has no fitting section, leave the file unchanged and report the gap to the user.
   - Keep `AGENTS.md` identical to `CLAUDE.md` after any update.

7. Enforce README structure.
   - If `README.md` was created or modified in step 3 or 4, invoke the `docs-tools:readme-structure-guard` skill and verify the result against its locked structure and placement rules before reporting.

8. Report outcomes.
   - Summarize updated files and newly created files.
   - Summarize the git evidence used, such as working-tree diffs, staged diffs, or recent commits.

## Execution Rules

- Do not invent shipped behavior; derive content from actual repository changes.
- Keep `README.md` and `docs/` focused on current behavior only; remove outdated completed/removed implementation narratives.
- Do not edit roadmap, todo, backlog, plan, changelog, or release-note files as part of this skill.
- Never add todo, roadmap, backlog, follow-up, or future-work content.
- If a code change implies unfinished work, leave it out of stable docs unless the current code exposes that limitation to users or operators.
- Prefer concise updates over broad rewrites.
- Preserve unrelated manual notes unless they are directly outdated.

## Pressure Checks

Before finishing, verify the updated documentation against these cases:

| Case | Required behavior |
| --- | --- |
| Code changed and stable docs need updates | Update only current-state content. |
| Diff shows incomplete work | Document only current exposed behavior, not next steps. |
| A planning file looks stale | Leave it alone; this skill is not planning maintenance. |
| A changelog or release note looks relevant | Leave it alone unless the user explicitly asked for that artifact. |
| User asks for docs sync only | Update README/docs from git evidence only. |
| A fact in `CLAUDE.md`/`AGENTS.md` went stale | Update the fact in place; section structure stays identical. |
| New content has no fitting `CLAUDE.md` section | Leave the file unchanged; report the gap instead of adding a section. |

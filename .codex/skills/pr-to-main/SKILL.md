---
name: pr-to-main
description: Create or update pull requests from develop to main using this repository's template system and area-based quality gates. Use when asked to open, refresh, or automate a PR to main, including generating title/body from git diff, selecting touched areas (backend/frontend/supabase), and running gh pr create or gh pr edit. Run only when the current branch is develop.
---

# PR To Main

## Objective

Create a complete PR to `main` that follows repository template rules and reflects the actual diff.

## Source of Truth

Read `references/pr-automation-guide.md` first and follow it exactly.

Then read these repository files referenced by the guide:

- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE/backend.md`
- `.github/PULL_REQUEST_TEMPLATE/frontend.md`
- `.github/PULL_REQUEST_TEMPLATE/supabase.md`

## Execution Rules

- Validate that the current branch is `develop` before any PR work.
- If the current branch is not `develop`, stop immediately and tell the user: "현재 브랜치가 develop이 아닙니다. develop 브랜치에서 다시 스킬을 실행해주세요."
- Keep untouched area subsections out of `What Changed` and `Quality Gates`.
- Never pre-check checkboxes in `Quality Gates` or `Review Checklist`.
- Use title format `[type] imperative summary`.
- Create PR with `gh pr create` or update existing PR with `gh pr edit`.

## Output Contract

Return:

- Final PR title
- Final PR body markdown
- Whether PR was created or updated
- PR URL

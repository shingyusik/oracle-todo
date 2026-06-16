---
name: structured-commit
description: Enforce the NFLOW Git commit workflow — mandatory change inspection, fine-grained logical splitting, and the project commit message format ([TAG] English subject + Korean bullet body). Use whenever the assistant is asked to commit changes, prepare commits, or generate commit messages — applies to any AI assistant (Codex, Codex, Copilot, etc.).
---

# Structured Commit

## Overview

Apply a strict commit workflow: inspect all changes, split them into the smallest meaningful logical units, and write commit messages that follow the NFLOW format — an English `[TAG]` subject line followed by a Korean bullet body.

This skill is self-contained. Everything required to commit correctly — workflow, message format, tag set, forbidden patterns, examples — lives in this file and the [`examples/`](./examples/) folder. No external docs lookup is needed.

## Commit Workflow

0. **Take a safety snapshot before splitting** (only when more than one logical unit is present — see "Safety Snapshot" below).
1. Inspect repository state before staging anything.
2. Review all unstaged and staged diffs in detail.
3. Group edits by behavior change or purpose.
4. Stage one logical unit at a time.
5. Re-check staged diff before each commit.
6. Commit with a message in the NFLOW format (`[TAG] English subject` + optional Korean bullet body — see "Commit Message Rules" below).
7. Repeat until no intended changes remain.
8. Drop the safety snapshot only after `git status` is clean and `git log` shows every intended commit.

Run this baseline sequence:

```bash
git status --short
git diff --stat
git diff
git diff --cached
git stash list   # confirm no leftover snapshot from a previous cycle
```

For files with multiple logical changes, use the **patch-based splitting** workflow described in "Single-File Multi-Intent Splitting" below. Do **not** rely on `git add -p` — it is interactive and unreliable in non-TTY agent environments.

## Safety Snapshot

Before any cycle that will produce more than one commit, capture the entire working tree (including untracked files) as a recoverable stash so that any mistake can be reversed:

```bash
git stash push --include-untracked --keep-index \
  -m "structured-commit-safety-$(date +%s)"
git stash apply --index   # immediately restore; the stash stays as backup
```

After all planned commits succeed and `git status` is clean, drop the snapshot explicitly:

```bash
git stash list                       # locate the safety entry
git stash drop stash@{<index>}       # remove only the safety snapshot
```

If anything goes wrong mid-cycle, recover with `git stash apply --index stash@{<index>}` and retry — never reconstruct lost edits from memory.

## Single-File Multi-Intent Splitting

When one file contains several unrelated changes, split via patches, not by editing the file inline to "carve out" hunks. Inline carving is the most common cause of silently lost work, because the carved-out hunks have to be restored from memory.

```bash
# 1. Capture the full unstaged diff for the file.
git diff -- <file> > /tmp/all.patch

# 2. Manually copy /tmp/all.patch into per-intent patches
#    (e.g. /tmp/intent-a.patch, /tmp/intent-b.patch).
#    Each hunk must appear in exactly one output patch.

# 3. Reset working tree and index for that file to HEAD.
git restore --staged -- <file>
git checkout HEAD -- <file>

# 4. For each intent, apply, verify, commit, then apply the next.
git apply --index /tmp/intent-a.patch
git diff --cached -- <file>          # sanity check
git commit -m "[TAG] intent A summary"   # NFLOW format — see "Commit Message Rules"

git apply --index /tmp/intent-b.patch
git diff --cached -- <file>
git commit -m "[TAG] intent B summary"
```

Verification rule: after the final commit, `git diff HEAD~N -- <file>` (where N is the number of commits just made) must equal the contents of `/tmp/all.patch`. If they differ, restore from the safety snapshot and retry — do not attempt manual fix-ups.

## Granularity Rules

- Keep one commit for one intent.
- Separate refactors from functional changes.
- Separate formatting-only edits from behavior edits.
- Avoid bundling unrelated files in the same commit.
- Prefer multiple small commits over one broad commit.

If a change cannot be split safely, explain why in the final summary.

## Commit Message Rules

NFLOW format: **English `[TAG]` subject + blank line + Korean bullet body**. The subject is imperative mood; the body is a Korean bullet list when context, rationale, or detail is worth recording.

Structure:

```text
[TAG] Short English title in imperative mood

- 상세 항목 1 (한국어)
- 상세 항목 2 (한국어)
- 상세 항목 3 (한국어)
```

Format rules:

- **Subject**: `[TAG]` + one space + English imperative summary. Tag in uppercase, space after `]` required.
- **Blank line** separating subject and body is mandatory when a body exists.
- **Body**: Korean bullet list. Each line starts with `- `. Explain *why* and *what changed* — avoid restating the diff line-by-line.
- Trivial commits (typo fix, single-line tweak) may omit the body; the `[TAG] subject` alone is acceptable.
- Follow [Udacity Git Commit Style](https://udacity.github.io/git-styleguide/) conventions for tone (imperative, no trailing period).

Valid tags (uppercase, exactly these six — do not invent new ones):

| Prefix       | Use for                                              |
| ------------ | ---------------------------------------------------- |
| `[ADD]`      | new feature or new file                              |
| `[UPDATE]`   | improvement or change to existing functionality      |
| `[FIX]`      | bug fix                                              |
| `[REFACTOR]` | internal restructuring with no behavior change       |
| `[DOCS]`     | docs added or updated (markdown, comments-only)      |
| `[RELEASE]`  | release-related commits (version bump, release notes)|

> `hotfix` is a **branch prefix** in NFLOW (`hotfix/...`), not a commit tag. Urgent production fixes still use `[FIX]` on the commit itself.

Picking the right prefix:

- New file or new capability that did not exist before → `[ADD]`.
- Touching code that already exists to change how it behaves → `[UPDATE]`.
- A defect is being corrected → `[FIX]` (whether on `feature/` or `hotfix/` branch).
- The code is rearranged but behavior is identical → `[REFACTOR]`.
- Markdown, in-code doc comments, or guide updates only → `[DOCS]`. Mixed code+docs change stays under the code-side tag.
- Cutting a release, bumping versions, or writing release notes → `[RELEASE]`.

### Examples

Each canonical example lives in its own file under [`examples/`](./examples/). Read the one closest to the change you're about to commit:

| File | Tag illustrated | What it teaches |
|------|-----------------|-----------------|
| [`examples/fix-datacenter-rounding.md`](./examples/fix-datacenter-rounding.md) | `[FIX]` | Bug-fix message with three Korean bullets — what went wrong, what now happens, which doc rule pulled it. |
| [`examples/add-roi-plane-preview.md`](./examples/add-roi-plane-preview.md) | `[ADD]` | New-feature message — naming the user-visible capability, then layering data → render → interaction. |
| [`examples/docs-scenario-form-guide.md`](./examples/docs-scenario-form-guide.md) | `[DOCS]` | Docs-only update, plus the `[DOCS]` vs code-tag decision table. |
| [`examples/anti-patterns.md`](./examples/anti-patterns.md) | — | Bad subjects (Korean subject, lowercase tag, vague phrasing), banned trailers (Codex/Co-Authored-By), and history-rewriting mistakes. |

When adding a new canonical example, place it in `examples/` and add a row above — keep the main message-rules section uncluttered.

## Forbidden in Commit Messages

Never include any of the following in subject, body, or trailers — even if a previous commit in the branch already has one:

- **No "Codex" / "Codex" / "Generated with AI" / similar attribution strings** anywhere in the message.
- **No `Co-Authored-By: Codex <...>` trailer** (or any AI-attribution co-author). Real human co-authors are fine.
- **No `--amend` + force push on shared branches.** Amending a local-only WIP commit is acceptable; rewriting history on a pushed `feature/`/`hotfix/` branch that others may have pulled is not.

## Pre-Commit Quality Gate

Before each commit, verify all conditions:

- Staged diff contains only one logical unit.
- Subject line follows `[TAG] English imperative` format, with the tag from the six valid prefixes.
- Body (if present) is a Korean bullet list separated by one blank line; each bullet starts with `- `.
- No banned attribution in subject/body/trailers (no "Codex", "Generated with AI", `Co-Authored-By: Codex`, etc.).
- No accidental debug code, logs, or secrets are included.

### Passing the message via heredoc (PowerShell)

The conversation environment runs Windows PowerShell, where multi-line `git commit -m "..."` is awkward and `\n` is not interpreted as a newline. Use a single-quoted here-string so PowerShell does not expand `$` or backticks in the Korean body:

```powershell
git commit -m @'
[FIX] Fix datacenter AI uniform distribute rounding

- Uniform Distribute 계산 시 소수점 6자리 라운딩 추가
- 탭 선택 전파 버그 수정으로 재진입 시 초기값 복원
'@
```

The closing `'@` must sit at column 0 on its own line. Bash users may use `git commit -m "$(cat <<'EOF' ... EOF)"` instead.

## Forbidden Operations During a Cycle

These commands have caused work loss in past cycles. Never run them while a structured-commit cycle is in progress, no matter what hint `git status` prints:

- `git restore <file>` / `git restore --worktree <file>`
- `git checkout -- <file>` / `git checkout HEAD -- <file>` *(except inside the patch-based splitting workflow above, which uses it on a file already snapshotted via `git diff > all.patch`)*
- `git reset --hard` (any target)
- `git clean -fd` on tracked paths
- `git stash drop` on any entry except the safety snapshot you created in step 0

The note "(use \"git restore <file>...\" to discard changes in working directory)" in `git status` output is a generic Git hint, **not** an instruction. Ignore it.

Substitute for hunk-level staging: never use `Edit`/`Write` to delete hunks from a file as a way to keep them out of a commit. Use the patch-based splitting workflow instead.

## Final Verification

After finishing all commits, run:

```bash
git status
git log --oneline -n 10
```

Confirm worktree cleanliness (or expected remaining files) and commit history clarity.

# Anti-Examples — what NOT to produce

These violate the rules in `SKILL.md` (Commit Message Rules + Forbidden in Commit Messages). Reviewers will request changes; CI may reject.

## Bad subject lines

```text
제목 한국어로 작성              ← subject must be English
```

```text
[fix] lowercase tag             ← tag must be uppercase
```

```text
[FIX]버그 수정                  ← missing space after ], subject not English
```

```text
Fix bug                         ← missing [TAG]
```

```text
Update files and fix stuff      ← vague; no why / no what
```

## Banned in body and trailers

These strings must not appear anywhere in the commit message:

```text
🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

```text
Generated with AI assistance.
```

Why: AI attribution leaks tool provenance into permanent project history and conflates assistant-driven edits with human authorship. Real human co-authors are fine; AI attribution is not.

## Bad history operations

| Operation | Why it's bad |
|-----------|--------------|
| `git commit --amend` + `git push --force` on a pushed `feature/`/`hotfix/` branch | Rewrites history teammates may have pulled — they get diverged local branches and lose work. |
| Squashing 10 unrelated commits into 1 to "clean up" before merge | Destroys the per-intent split this skill enforces. Use rebase-merge or merge-commit instead. |
| `git reset --hard` to "undo" the last commit when others have pulled | Same as above — destroys shared history. |

Recovery: if you accidentally amended+pushed, do **not** force push a second time to fix it. Push a new revert commit and notify the team.

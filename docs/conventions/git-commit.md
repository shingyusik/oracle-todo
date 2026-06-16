# Git Commit Convention

This repo follows the NFLOW commit convention: a tagged English subject line plus a Korean
bullet body.

## Format

```
[TAG] English subject in the imperative

- 변경 사항을 한국어로 요약한 불릿
- 왜/무엇을 바꿨는지 논리 단위로 설명
```

- **Subject:** `[TAG]` prefix + a concise English summary in the imperative mood.
- **Body:** Korean bullet points describing what changed and why, one logical point per line.

## Tags in use

| Tag | When |
| --- | --- |
| `[ADD]` | Adding new files/features/assets. |
| `[UPDATE]` | Updating existing behavior or content. |
| `[REFACTOR]` | Restructuring code without changing behavior. |
| `[TEST]` | Adding or reorganizing tests. |
| `[DOCS]` | Documentation-only changes. |

Other tags (e.g. `[FIX]`, `[REMOVE]`) follow the same shape when needed.

## Granularity

- One **logical change per commit.** Split unrelated work into separate commits rather than
  bundling them.
- Stage deliberately. Stage only the paths that belong to the change — e.g. `git add docs CLAUDE.md`
  for a docs commit — never `git add -A`, and never stage machine-local files such as `.cargo/`.
- Inspect the diff before committing; keep each commit reviewable on its own.

## Examples

```
[REFACTOR] Split TodoService into service/ submodules

- creation/transitions/update/materialization/queries로 분리
- 공유 필드/헬퍼는 pub(super)로만 확대(공개 API 불변)
```

```
[DOCS] Restructure docs into architecture/conventions/operations

- design-v1/rust-refactor 내용을 3개 하위폴더로 흡수
- 코드(라우트/서브커맨드/컬럼/상태) 기준으로 검증해 작성
```

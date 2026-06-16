# Example — `[DOCS]` for markdown-only change

A docs-only update (markdown, in-code doc comments, or guide files). No production code path touched.

```text
[DOCS] Update scenario form guide with unit notation rules

- [단위] 표기 규칙 §4.6에 결과 표시/차트 제목 케이스 추가
- saveInterval 표준 키 §4.7로 분리
```

When to use `[DOCS]` vs another tag:

| Diff contents | Tag |
|---------------|-----|
| Only `.md` files, or only doc comments above code | `[DOCS]` |
| Code change with incidental README touch-up | `[ADD]` / `[UPDATE]` / `[FIX]` (code side wins) |
| Code change that *also* rewrites a guide section about that code | Split into two commits — `[DOCS]` for the guide, `[CODE-TAG]` for the code |

Why this passes the quality gate:

- Subject names *which* guide is being updated, not "update docs".
- Body bullets cite section numbers — future grep on `§4.6` or `§4.7` will surface this commit.
- No mixed code change in the diff.

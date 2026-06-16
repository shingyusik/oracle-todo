# Example — `[FIX]` with Korean bullet body

A defect-correction commit on `feature/` or `hotfix/` branch. The body explains *what went wrong*, *what now happens*, and *which doc rule pulled the change*.

```text
[FIX] Fix datacenter AI uniform distribute rounding

- Uniform Distribute 계산 시 소수점 6자리 라운딩 추가
- 탭 선택 전파 버그 수정으로 재진입 시 초기값 복원
- scenario-form-guide.md §5 라운딩 규칙 준수
```

Why this passes the quality gate:

- Subject is **English imperative** with `[FIX] ` (uppercase tag + one space).
- Single blank line separates subject and body.
- Each body bullet starts with `- ` and is **Korean** explaining intent, not diff lines.
- Third bullet links to the authoritative rule (`scenario-form-guide.md §5`) — future readers can trace *why* the rounding rule exists without reading the diff. (Linking to internal docs from a body bullet is a pattern, not a requirement; do it when the rule is non-obvious.)
- No `Co-Authored-By` trailer, no "Claude" attribution.

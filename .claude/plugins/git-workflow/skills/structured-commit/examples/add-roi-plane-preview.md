# Example — `[ADD]` for a new feature

A new capability that did not exist before. The body lists *what was added* and *how it is wired into the existing flow*.

```text
[ADD] Add ROI plane preview for datacenter AI

- generateROIPlaneDefs.ts에서 25개 기본 평면 생성
- ROIPlanePreviewLayer R3F 컴포넌트 추가
- Start 버튼 클릭 시 preprocess → infer 순차 실행
```

Why this passes the quality gate:

- `[ADD]` is correct because the file/component did not exist before — *not* `[UPDATE]`.
- Subject names the user-visible feature ("ROI plane preview"), not the internal symbol.
- Body bullets walk the reader through three layers: data generator → render layer → user interaction. A reviewer can scan the diff in that order.
- No file paths in the subject — those belong in the body or PR description.

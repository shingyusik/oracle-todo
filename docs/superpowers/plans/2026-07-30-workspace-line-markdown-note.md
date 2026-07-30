# Workspace Line Markdown Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render completed Workspace note lines immediately and support empty and checked Markdown task markers.

**Architecture:** Keep `MarkdownNoteEditor` controlled by its existing `value` and `onChange` props. Split the value into newline-delimited blocks in the component, keep only one block in edit mode, and reuse `ReactMarkdown` plus `remark-gfm` for every rendered block; handle marker-only task lines explicitly because GFM does not recognize an empty task item.

**Tech Stack:** React 18, TypeScript, `react-markdown`, `remark-gfm`, Vitest, Testing Library, CSS

## Global Constraints

- The detail header Save action remains the persistence boundary.
- No engine, API, persistence, or detail-draft contract changes.
- `- [ ]`, `- [x]`, and `- [X]` render even when no label follows.
- Checked task lines render with a strikethrough.
- Tables and fenced code blocks remain outside the line-editor scope.
- No new dependency.

---

### Task 1: Line-Based Markdown Editing

**Files:**
- Modify: `frontend/tests/presentation/markdown-note-editor.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx`

**Interfaces:**
- Consumes: `MarkdownNoteEditorProps { value: string; onChange(value: string): void }`
- Produces: the unchanged `MarkdownNoteEditor` component API with line-level editing

- [ ] **Step 1: Replace whole-note editing tests with failing line behavior tests**

Add tests that prove the observable behavior:

```tsx
it("renders the completed line and edits a new line on Enter", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <MarkdownNoteEditor value="First" onChange={onChange} />,
  );

  await user.click(screen.getByText("First"));
  const input = screen.getByRole("textbox", { name: "Markdown note line 1" });
  await user.type(input, "{Enter}");

  expect(onChange).toHaveBeenLastCalledWith("First\n");
  rerender(<MarkdownNoteEditor value={"First\n"} onChange={onChange} />);
  expect(screen.getByText("First")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Markdown note line 2" })).toHaveFocus();
});

it("renders marker-only tasks and strikes the checked line", () => {
  const { container } = render(
    <MarkdownNoteEditor value={"- [ ]\n- [x]\n- [X] Done"} onChange={vi.fn()} />,
  );

  const boxes = screen.getAllByRole("checkbox");
  expect(boxes[0]).not.toBeChecked();
  expect(boxes[1]).toBeChecked();
  expect(boxes[2]).toBeChecked();
  expect(container.querySelectorAll(".markdown-note-line--checked")).toHaveLength(2);
  expect(screen.getByText("Done").closest(".markdown-note-line--checked")).not.toBeNull();
});
```

Update the existing click and keyboard tests to target rendered lines instead
of the removed whole-note textarea. Keep the safe-link test.

- [ ] **Step 2: Run the focused presentation test and verify RED**

Run:

```bash
npm --prefix frontend test -- tests/presentation/markdown-note-editor.spec.tsx
```

Expected: FAIL because rendered lines are not independently editable, Enter
does not append a line, and marker-only tasks do not render as checkboxes.

- [ ] **Step 3: Implement the minimum controlled line editor**

In `MarkdownNoteEditor.tsx`:

```tsx
const [editingLine, setEditingLine] = React.useState<number | null>(null);
const lines = value.split("\n");

function updateLine(index: number, nextLine: string) {
  onChange(lines.map((line, lineIndex) => (lineIndex === index ? nextLine : line)).join("\n"));
}

function insertLineAfter(index: number) {
  const nextLines = [...lines];
  nextLines.splice(index + 1, 0, "");
  onChange(nextLines.join("\n"));
  setEditingLine(index + 1);
}
```

Render one `textarea` with `rows={1}` for `editingLine`. On Enter, prevent the
default newline and call `insertLineAfter`. Render other lines through the
existing safe `ReactMarkdown` configuration. Give rendered lines
`role="button"`, `tabIndex={0}`, and Enter/Space handlers.

For `/^- \[([ xX])\]$/`, render a disabled checkbox directly. For every line
matching `/^- \[[xX]\](?:\s|$)/`, add
`markdown-note-line--checked` to the line wrapper. Stop link clicks from opening
the line editor.

- [ ] **Step 4: Run the focused presentation test and verify GREEN**

Run:

```bash
npm --prefix frontend test -- tests/presentation/markdown-note-editor.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the behavior**

```bash
git add frontend/tests/presentation/markdown-note-editor.spec.tsx \
  frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx
git commit -m "[UPDATE] Render Workspace notes line by line" \
  -m "- Enter로 완료한 줄을 렌더링하고 다음 줄 편집을 이어가도록 변경
- 빈 작업 마커와 체크 상태를 마크다운 원문에서 표시
- 기존 링크 안전 처리와 제어 컴포넌트 계약을 유지"
```

### Task 2: Line Editor Styling

**Files:**
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes: `.markdown-note-line`, `.markdown-note-line-input`, and `.markdown-note-line--checked` from Task 1
- Produces: full-width focusable line blocks and checked-line strikethrough styling

- [ ] **Step 1: Change the existing CSS boundary test to the line selectors**

Replace whole-note textarea assertions with:

```ts
expect(css).toContain(
  ".markdown-note-line,\n.markdown-note-line-input {\n  width: 100%;",
);
expect(css).toContain(
  ".markdown-note-line--checked {\n  text-decoration: line-through;",
);
expect(css).toContain(".markdown-note-line:focus-visible");
```

- [ ] **Step 2: Run the architecture test and verify RED**

Run:

```bash
npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts
```

Expected: FAIL because the line selectors do not exist.

- [ ] **Step 3: Replace whole-note input styles with line styles**

Keep `.markdown-note-surface` as the outer full-width container. Add
`.markdown-note-line` and `.markdown-note-line-input` with transparent borders,
full width, inherited font, and visible focus outlines. Remove the 260/220px
whole-note textarea sizing. Add:

```css
.markdown-note-line--checked {
  text-decoration: line-through;
}
```

Keep existing scoped Markdown typography and task-list styles.

- [ ] **Step 4: Run the architecture and presentation tests**

Run:

```bash
npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts \
  tests/presentation/markdown-note-editor.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the styles**

```bash
git add frontend/tests/architecture/design-boundaries.spec.ts \
  frontend/src/styles/globals.css
git commit -m "[UPDATE] Style line-based Markdown note blocks" \
  -m "- 줄별 편집 입력과 키보드 포커스 표시를 노트 표면에 맞춤
- 체크된 작업 줄 전체에 취소선을 적용
- 전체 노트 textarea 전용 크기 규칙을 제거"
```

### Task 3: Frontend Verification

**Files:**
- Modify only if verification exposes a defect in Task 1 or Task 2

**Interfaces:**
- Consumes: completed line editor and styles
- Produces: verified frontend behavior with no new lint or build failures

- [ ] **Step 1: Run the complete frontend test suite**

Run:

```bash
npm --prefix frontend test
```

Expected: PASS.

- [ ] **Step 2: Run type checking**

Run:

```bash
npm --prefix frontend run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm --prefix frontend run build
```

Expected: exit code 0.

- [ ] **Step 4: Confirm repository state and commits**

Run:

```bash
git status --short
git log --oneline -n 5
```

Expected: no unintended files and two implementation commits after the design
and plan commits.

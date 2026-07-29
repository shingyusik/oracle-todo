# Workspace Detail Markdown Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace labeled Workspace detail descriptions and notes with one unlabeled, click-to-edit Markdown note surface at the bottom of every detail view.

**Architecture:** Add a focused `MarkdownNoteEditor` presentation component that owns only rendered/edit mode while its parent owns the note draft. `DetailView` renders that shared component once after linked items; type-specific detail fields no longer know about notes or descriptions. Existing draft comparison and PATCH behavior continue to persist `note`, while `description` is removed from the detail draft so hidden values cannot be overwritten.

**Tech Stack:** React 18, TypeScript, Next.js 14, `react-markdown@10.1.0`, `remark-gfm@4.0.1`, Vitest, Testing Library, CSS

## Global Constraints

- Existing `description` values remain stored and available to other surfaces; the Workspace detail view neither displays nor changes them.
- The existing `note` API field stores Markdown source; no engine schema or API contract changes.
- The note surface is the final detail-layout section after structured properties and linked items.
- Rendered mode is the default; click, Enter, or Space enters edit mode; blur returns to rendered mode.
- The existing detail Save action remains the only persistence action.
- Raw HTML is not rendered, and rendered links open in a new tab with `rel="noreferrer noopener"`.
- Do not change table columns, creation forms, or non-detail uses of `description` and `note`.

---

### Task 1: Focused Markdown Note Editor

**Files:**
- Create: `frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx`
- Create: `frontend/tests/presentation/markdown-note-editor.spec.tsx`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**
- Consumes: `value: string` Markdown source and `onChange: (value: string) => void`.
- Produces: `MarkdownNoteEditor({ value, onChange }): React.JSX.Element`.
- Accessibility contract: rendered surface has accessible name `Edit Markdown note`; textarea has accessible name `Markdown note`.

- [ ] **Step 1: Write failing rendered-mode and safety tests**

Create `frontend/tests/presentation/markdown-note-editor.spec.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarkdownNoteEditor } from "@/features/workbench/ui/MarkdownNoteEditor";

describe("MarkdownNoteEditor", () => {
  it("renders GFM and safe external links without raw HTML", () => {
    render(
      <MarkdownNoteEditor
        value={"# Plan\n\n- [x] Ship\n\n~~old~~ [docs](https://example.com)\n\n<script>alert(1)</script>"}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("old").tagName).toBe("DEL");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows a clickable Markdown instruction when empty", () => {
    render(<MarkdownNoteEditor value="" onChange={vi.fn()} />);

    expect(screen.getByText("Write a note with Markdown…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Markdown note" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
cd frontend
npm test -- tests/presentation/markdown-note-editor.spec.tsx
```

Expected: FAIL because `MarkdownNoteEditor` does not exist.

- [ ] **Step 3: Install the Markdown dependencies**

Run:

```bash
cd frontend
npm install react-markdown@10.1.0 remark-gfm@4.0.1
```

Expected: `package.json` and `package-lock.json` record both production dependencies.

- [ ] **Step 4: Implement safe rendered mode**

Create `frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx`:

```tsx
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownNoteEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function MarkdownNoteEditor({ value, onChange }: MarkdownNoteEditorProps) {
  const [isEditing, setIsEditing] = React.useState(false);

  if (isEditing) {
    return (
      <textarea
        autoFocus
        className="markdown-note-input"
        aria-label="Markdown note"
        value={value}
        onBlur={() => setIsEditing(false)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  function beginEditing() {
    setIsEditing(true);
  }

  return (
    <div
      className="markdown-note-surface"
      role="button"
      tabIndex={0}
      aria-label="Edit Markdown note"
      onClick={beginEditing}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          beginEditing();
        }
      }}
    >
      {value ? (
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm]}
          components={{
            a({ node: _node, onClick, ...props }) {
              return (
                <a
                  {...props}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClick?.(event);
                  }}
                />
              );
            },
          }}
        >
          {value}
        </ReactMarkdown>
      ) : (
        <p className="markdown-note-placeholder">Write a note with Markdown…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add failing edit-mode interaction tests**

Append inside the existing `describe`:

```tsx
it("enters edit mode by click, updates the draft, and renders again on blur", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<MarkdownNoteEditor value="**Draft**" onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "Edit Markdown note" }));
  const input = screen.getByRole("textbox", { name: "Markdown note" });
  expect(input).toHaveFocus();

  fireEvent.change(input, { target: { value: "# Updated" } });
  expect(onChange).toHaveBeenCalledWith("# Updated");

  fireEvent.blur(input);
  expect(screen.getByRole("button", { name: "Edit Markdown note" })).toBeInTheDocument();
});

it.each(["{Enter}", "{Space}"])("enters edit mode with %s", async (key) => {
  const user = userEvent.setup();
  render(<MarkdownNoteEditor value="Draft" onChange={vi.fn()} />);

  screen.getByRole("button", { name: "Edit Markdown note" }).focus();
  await user.keyboard(key);

  expect(screen.getByRole("textbox", { name: "Markdown note" })).toHaveFocus();
});
```

- [ ] **Step 6: Run the focused component tests**

Run:

```bash
cd frontend
npm test -- tests/presentation/markdown-note-editor.spec.tsx
```

Expected: all `MarkdownNoteEditor` tests PASS.

- [ ] **Step 7: Commit the editor component**

```bash
git add frontend/package.json frontend/package-lock.json \
  frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx \
  frontend/tests/presentation/markdown-note-editor.spec.tsx
git commit -m "[ADD] Add Workspace Markdown note editor"
```

---

### Task 2: Integrate One Bottom Note and Remove Detail Descriptions

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1-330`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:3118-3665`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `MarkdownNoteEditor` from Task 1 and the existing `draft.note`/`setField` data path.
- Produces: one `.detail-note` section as the last child of `.detail-layout`.
- Preserves: `WorkspaceItemModel.description` and `WorkspaceItemPatch.description` for non-detail surfaces.

- [ ] **Step 1: Write a failing detail-layout integration test**

Add a test to `frontend/tests/presentation/workbench-wireframe.spec.tsx` using a task fixture that has both fields:

```tsx
it("shows one Markdown note last and omits description from Workspace details", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "Write release notes",
            status: "active",
            description: "Legacy description",
            note: "# Checklist\n\n- [x] Drafted",
          },
        ],
      }),
    ),
  );

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  await user.click(await screen.findByRole("cell", { name: "Write release notes" }));

  expect(screen.queryByLabelText("Description")).toBeNull();
  expect(screen.queryByLabelText("Note")).toBeNull();
  expect(screen.queryByText("Legacy description")).toBeNull();
  expect(screen.getByRole("heading", { name: "Checklist" })).toBeInTheDocument();

  const layout = screen.getByRole("heading", { name: "Write release notes" }).closest(".detail-layout");
  const note = screen.getByRole("button", { name: "Edit Markdown note" }).closest(".detail-note");
  expect(layout?.lastElementChild).toBe(note);
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```bash
cd frontend
npm test -- tests/presentation/workbench-wireframe.spec.tsx -t "shows one Markdown note last"
```

Expected: FAIL because Description and labeled Note textareas still render.

- [ ] **Step 3: Render the shared editor once at the layout bottom**

Import the component in `MainPanel.tsx`:

```tsx
import { MarkdownNoteEditor } from "@/features/workbench/ui/MarkdownNoteEditor";
```

After the linked-items conditional and before the closing `.detail-layout` tag, add:

```tsx
<section className="detail-note" aria-label="Markdown note editor">
  <MarkdownNoteEditor
    value={draft.note}
    onChange={(value) => setField("note", value)}
  />
</section>
```

This section must remain after the linked-items conditional so it is always the
last detail content block.

- [ ] **Step 4: Remove type-specific Note and Description controls**

Delete every `DetailTextAreaField` call whose label is `Note` or `Description`
from all branches of `DetailTypeFields`. Delete the now-unused
`DetailTextAreaField` function.

Remove `description` from `DetailDraft`, `detailDraftForItem`, and
`detailPatchForItem`:

```tsx
type DetailDraft = {
  title: string;
  status: string;
  tags: string;
  area: string;
  project_id: string;
  routine_id: string;
  parent_id: string;
  note: string;
  outcome: string;
  horizon: string;
  definition_of_done: string;
  review_cycle: string;
  standard: string;
  recurrence_rule: string;
  materialization_policy: string;
  location: string;
  participants: string;
  commitment_type: string;
  due: string;
  scheduled: string;
  priority: string;
};
```

The shared patch logic must remain:

```tsx
addStringPatch(patch, "title", draft.title, item.title);
addStringPatch(patch, "note", draft.note, item.note);
```

Delete only this detail-specific line:

```tsx
addStringPatch(patch, "description", draft.description, itemDescription(item));
```

Retain `itemDescription` because planner/table code still uses the helper.

- [ ] **Step 5: Update affected detail tests and add a PATCH regression test**

Change existing tests that locate `getByLabelText("Note")` in detail mode to:

```tsx
await user.click(screen.getByRole("button", { name: "Edit Markdown note" }));
const note = screen.getByRole("textbox", { name: "Markdown note" });
```

Change the routine template detail test so it no longer edits Description and
expects only structured fields in the PATCH body:

```tsx
expect(JSON.parse(String(init.body))).toEqual({
  project_id: "project-2",
  priority: 3,
});
```

Add a regression assertion to the note-save test:

```tsx
expect(init.body).toBe(JSON.stringify({ note: "Keep this stretch" }));
expect(String(init.body)).not.toContain("description");
```

Keep table-level assertions for description unchanged; they prove the field is
hidden only from details.

- [ ] **Step 6: Run focused Workspace detail tests**

Run:

```bash
cd frontend
npm test -- tests/presentation/workbench-wireframe.spec.tsx \
  -t "shows one Markdown note last|shows and saves routine task template fields|opens legacy weekly recurrence"
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit the integration**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx \
  frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Simplify Workspace detail notes"
```

---

### Task 3: Note Surface Styling, Responsive Behavior, and Full Verification

**Files:**
- Modify: `frontend/src/styles/globals.css:1667-2075`
- Modify: `frontend/src/styles/globals.css:2270-2300`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: `.detail-note`, `.markdown-note-surface`, `.markdown-note-input`,
  and `.markdown-note-placeholder` from Tasks 1 and 2.
- Produces: full-width editable prose styling scoped to the Workspace detail
  note, including narrow-screen behavior.

- [ ] **Step 1: Write failing CSS boundary assertions**

Add to `frontend/tests/architecture/design-boundaries.spec.ts`:

```ts
it("keeps the Markdown note full-width and outside the property grid", async () => {
  const css = await readSource("src/styles/globals.css");

  expect(css).toContain(".detail-note {\n  display: grid;");
  expect(css).toContain(".markdown-note-surface,\n.markdown-note-input {\n  width: 100%;");
  expect(css).toContain(".markdown-note-input {\n  min-height: 260px;");
  expect(css).toContain(".markdown-note-surface:focus-visible");
});
```

Use the test file's existing `readSource` helper and frontend-relative path
convention.

- [ ] **Step 2: Run the CSS assertion to verify it fails**

Run:

```bash
cd frontend
npm test -- tests/architecture/design-boundaries.spec.ts \
  -t "keeps the Markdown note full-width"
```

Expected: FAIL because the note selectors do not exist.

- [ ] **Step 3: Add scoped Markdown and editor styles**

Add near the existing detail styles in `globals.css`:

```css
.detail-note {
  display: grid;
  min-width: 0;
}

.markdown-note-surface,
.markdown-note-input {
  width: 100%;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-ink);
}

.markdown-note-surface {
  min-height: 180px;
  padding: 18px 0;
  cursor: text;
}

.markdown-note-surface:hover {
  background: var(--color-canvas-light);
}

.markdown-note-surface:focus-visible,
.markdown-note-input:focus {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}

.markdown-note-input {
  min-height: 260px;
  padding: 18px;
  resize: vertical;
  font: inherit;
  line-height: 1.65;
}

.markdown-note-placeholder {
  margin: 0;
  color: var(--color-shade-50);
}

.markdown-note-surface > :first-child {
  margin-top: 0;
}

.markdown-note-surface > :last-child {
  margin-bottom: 0;
}

.markdown-note-surface h1,
.markdown-note-surface h2,
.markdown-note-surface h3 {
  margin: 1.4em 0 0.6em;
  line-height: 1.25;
}

.markdown-note-surface p,
.markdown-note-surface ul,
.markdown-note-surface ol,
.markdown-note-surface blockquote,
.markdown-note-surface pre,
.markdown-note-surface table {
  margin: 0 0 1em;
}

.markdown-note-surface blockquote {
  margin-left: 0;
  border-left: 3px solid var(--color-shade-30);
  padding-left: 14px;
  color: var(--color-shade-70);
}

.markdown-note-surface code {
  border-radius: 3px;
  background: var(--color-canvas-light);
  padding: 0.12em 0.3em;
  font-family: var(--font-mono);
}

.markdown-note-surface pre {
  overflow-x: auto;
  padding: 14px;
  background: var(--color-canvas-light);
}

.markdown-note-surface pre code {
  padding: 0;
}

.markdown-note-surface table {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown-note-surface th,
.markdown-note-surface td {
  border: 1px solid var(--color-hairline-light);
  padding: 7px 10px;
}

.markdown-note-surface a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-note-surface .task-list-item {
  list-style: none;
}
```

Inside the existing narrow-screen media query, add:

```css
.markdown-note-surface {
  min-height: 140px;
}

.markdown-note-input {
  min-height: 220px;
}
```

- [ ] **Step 4: Run architecture and presentation tests**

Run:

```bash
cd frontend
npm test -- tests/architecture/design-boundaries.spec.ts \
  tests/presentation/markdown-note-editor.spec.tsx \
  tests/presentation/workbench-wireframe.spec.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Run all frontend quality gates**

Run:

```bash
cd frontend
npm test
npm run typecheck
npm run build
```

Expected: all tests pass, TypeScript reports no errors, and Next.js production
build completes successfully.

- [ ] **Step 6: Review the final diff for scope and safety**

Run:

```bash
git diff --check
git status --short
git diff -- frontend/package.json frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx \
  frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css \
  frontend/tests/presentation/markdown-note-editor.spec.tsx \
  frontend/tests/presentation/workbench-wireframe.spec.tsx \
  frontend/tests/architecture/design-boundaries.spec.ts
```

Expected: no whitespace errors; no engine, schema, API, table-column, or creation
form changes.

- [ ] **Step 7: Commit styling and verification**

```bash
git add frontend/src/styles/globals.css \
  frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[UPDATE] Style Workspace Markdown notes"
```

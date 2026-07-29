# Workspace Markdown Note Final Fix Report

## Scope

This fix wave resolves the three final-review findings for the Workspace Markdown
note feature. Production and test changes are limited to the five assigned
frontend files.

## Finding 1 — Markdown semantics nested inside a button

### Resolution

- Removed `role="button"`, `tabIndex`, `aria-label`, and custom keyboard handling
  from `.markdown-note-surface`.
- Kept the rendered Markdown inside a plain semantic content wrapper so headings,
  links, lists, and other Markdown elements remain exposed with their native
  semantics.
- Added a sibling native `<button type="button">` with the accessible name
  `Edit Markdown note` and an `aria-hidden` pencil icon.
- Kept click-anywhere editing on `.markdown-note-surface`.
- Kept link click propagation stopped so rendered links open without entering edit
  mode.
- Relied on native button Enter and Space activation for keyboard editing.
- Kept the textarea `autoFocus`, `aria-label`, `onChange`, and blur-to-render
  behavior unchanged.
- Moved the visible focus treatment from the former interactive surface to the
  dedicated edit button. The control remains icon-only, so the note area has no
  visible label.

### RED evidence

Command:

```text
npx vitest run tests/presentation/markdown-note-editor.spec.tsx tests/architecture/design-boundaries.spec.ts --no-file-parallelism
```

Result before production changes: exit 1. The Markdown editor suite failed because
the rendered heading's nearest `[role='button']` was `.markdown-note-surface` and
because the surface still had `role="button"`. These are the exact accessibility
regressions under review.

The first GREEN attempt exposed a test-input issue for Space: `"{Space}"` sends the
legacy `"Space"` key value rather than a real space character to a native button.
The test was corrected to send `" "`, matching browser-native Space activation.

### GREEN evidence

The final focused command passed all 28 tests across the Markdown editor and design
boundary suites. The Markdown editor's 7 tests now prove:

- headings and links are not descendants of a button or button role;
- the content surface has no interactive role or tab stop;
- pointer activation works on both the full surface and the dedicated control;
- Enter and Space work through the native dedicated control;
- blur returns to rendered mode; and
- keyboard link activation stays in rendered mode.

## Finding 2 — Missing scoped horizontal-rule styling

### Resolution

Added a scoped rule:

```css
.markdown-note-surface hr {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--color-hairline-light);
}
```

The rule uses the existing hairline design token and cannot affect prose outside
the Markdown note surface. The design-boundary test now asserts the selector,
spacing, border reset, and token usage.

### RED evidence

The same pre-implementation focused command failed the design-boundary suite
because `.markdown-note-edit-button:focus-visible` and the scoped
`.markdown-note-surface hr` contract were absent.

### GREEN evidence

The final focused command passed all 21 design-boundary tests, including the new
horizontal-rule and dedicated-focus-control assertions.

## Finding 3 — Linked-item/note order integration coverage

### Resolution

Extended the linked-area fixture test to directly select `.detail-layout`,
`.linked-items`, and `.detail-note`, then assert:

- `.linked-items` precedes `.detail-note` in document order; and
- `.detail-note` is the final `.detail-layout` child.

### RED/GREEN evidence

This was a missing-coverage finding rather than a failing product behavior. The
current implementation already rendered the required order, so there was no
truthful natural RED without deliberately breaking production code outside this
fix wave's ownership. The newly added characterization assertion passed on its
first focused run:

```text
npx vitest run tests/presentation/workbench-wireframe.spec.tsx --no-file-parallelism -t "renders nonempty linked-item groups and opens the selected child"
```

Result: 1 passed, 156 skipped. The assertion will now fail if the note moves before
linked items or ceases to be the layout's final child.

## Verification

Focused verification:

```text
npx vitest run tests/presentation/markdown-note-editor.spec.tsx tests/architecture/design-boundaries.spec.ts --no-file-parallelism
```

Result: 2 test files passed, 28 tests passed.

```text
npx vitest run tests/presentation/workbench-wireframe.spec.tsx --no-file-parallelism -t "renders nonempty linked-item groups and opens the selected child"
```

Result: 1 test passed, 156 skipped.

Full verification, run once as requested:

```text
npm test && npm run typecheck && npm run build
```

Result: exit 0. Vitest recorded all 14 test files as passing, TypeScript completed
with no errors, and Next produced a fresh static export with
`.next/export-detail.json` reporting `"success": true`.

Additional repository check:

```text
git diff --check
```

Result: exit 0.

## Files changed

- `frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx`
- `frontend/tests/presentation/markdown-note-editor.spec.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/architecture/design-boundaries.spec.ts`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

## Self-review

- Confirmed rendered headings and links are siblings of, not descendants of, the
  dedicated edit button.
- Confirmed link propagation protection remains in place and the surface click
  handler remains full-area.
- Confirmed the dedicated control uses native button semantics, has an accessible
  name, and does not introduce a visible text label.
- Confirmed textarea focus, change, and blur behavior were preserved.
- Confirmed the new CSS uses existing design tokens and remains note-scoped.
- Confirmed linked-item ordering assertions exercise the real integrated detail
  DOM.
- Confirmed no files outside the assigned fix scope and this required report were
  modified.
- Confirmed no debug code, raw feature colors, secrets, or whitespace errors were
  introduced.

## Concerns

No known product or verification concerns. The linked-order finding had no natural
RED because the implementation already conformed; the report records that
test-only limitation explicitly instead of manufacturing a failure.

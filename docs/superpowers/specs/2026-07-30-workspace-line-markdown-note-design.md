# Workspace Line Markdown Note Design

## Goal

Make Workspace notes render completed Markdown lines immediately while keeping
the current line editable.

## Interaction

- Clicking the note starts editing its selected line.
- Pressing Enter renders the current line and opens a new editable line below it.
- Clicking a rendered line returns only that line to edit mode.
- The detail header Save action remains the persistence boundary.
- Leaving the note renders every line.

## Markdown

Each line supports the existing common Markdown and GFM rendering used by the
note surface, including headings, emphasis, links, and lists.

Task markers receive explicit line handling:

- `- [ ]` renders an unchecked checkbox, including when no label follows it.
- `- [x]` and `- [X]` render a checked checkbox.
- A checked task renders its entire line with a strikethrough.
- Checkboxes reflect Markdown source and are not independently interactive.

Tables and fenced code blocks remain outside the line-editor scope because their
meaning spans multiple lines.

## Data Flow

- The editor splits the existing `note` string into line blocks for display.
- Editing, inserting, or replacing a line joins the blocks with newline
  characters and calls the existing `onChange` callback.
- No engine, API, persistence, or detail-draft contract changes.

## Accessibility

- Rendered lines can be focused and opened for editing with Enter or Space.
- The active line editor has an accessible label and receives focus.
- Rendered task checkboxes expose checked state while remaining read-only.

## Verification

Presentation tests verify:

- Enter renders the completed line and focuses a new line.
- Clicking a rendered line edits only that line.
- Empty `- [ ]` and `- [x]` markers render as unchecked and checked boxes.
- Checked task content has a strikethrough.
- Line edits continue through the existing `onChange` callback.
- Existing safe-link and raw-HTML behavior remains intact.

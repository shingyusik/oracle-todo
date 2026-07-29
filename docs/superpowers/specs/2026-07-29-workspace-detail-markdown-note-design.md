# Workspace Detail Markdown Note Design

## Goal

Simplify every Workspace detail view by removing `description` from the detail
editor and replacing the labeled, property-row `note` control with one unlabeled
Markdown note surface at the bottom of the detail content.

## Scope

- Applies to the Workspace detail view for every item type.
- Existing `description` values remain stored and available to other surfaces.
  The detail view neither displays nor changes them.
- The existing `note` field remains the persistence field for the Markdown
  source.
- Table columns, creation forms, API contracts, and engine storage are unchanged.

## Layout

The property list contains only structured item properties. It no longer renders
`Description` or `Note` rows for any item type.

After the structured properties and any linked-item groups, the detail layout
renders a single, full-width note surface. It has no visible `Note` heading or
left-hand property label. This placement makes it the final content section for
every item type, including items with linked relationships.

An empty note displays subdued instructional placeholder text within the same
clickable surface.

## Interaction

The note surface has two modes:

1. **Rendered mode (default):** display the saved or current draft as rendered
   Markdown.
2. **Edit mode:** clicking the surface replaces it with a full-width textarea,
   focuses the textarea, and exposes the Markdown source.

Leaving the textarea returns the surface to rendered mode. Editing changes the
existing detail draft only; persistence still happens through the detail
header's Save action. Saving also returns the note to rendered mode.

Unsaved note edits participate in the existing dirty-state detection and linked
item navigation warning.

## Markdown Rendering and Safety

Use `react-markdown` with `remark-gfm` so notes support common Markdown plus
GitHub Flavored Markdown features such as task lists, tables, and strikethrough.
Raw HTML is not enabled.

Rendered links open in a new tab with `rel="noreferrer noopener"`. Rendering
styles remain scoped to the detail note surface and cover headings, paragraphs,
lists, blockquotes, links, inline code, code blocks, tables, horizontal rules,
and task lists without changing global prose styles.

## Component and Data Flow

- `DetailTypeFields` renders only type-specific structured properties.
- `DetailView` renders one shared Markdown note editor after linked items.
- The shared editor receives `draft.note` and updates it through the existing
  `setField("note", value)` path.
- `detailDraftForItem`, `detailPatchForItem`, and `hasDetailChanges` continue to
  manage `note`.
- `description` is removed from the detail draft and detail patch construction,
  ensuring a detail save cannot overwrite a hidden description.

The engine model and API patch types retain `description`; only the Workspace
detail editor stops using it.

## Accessibility

- Rendered mode is keyboard-focusable and can enter edit mode with Enter or
  Space.
- The textarea has an accessible `aria-label` even though there is no visible
  label.
- Focus indicators are visible in both modes.
- The empty-state instruction communicates that the surface accepts Markdown.

## Error Handling

Markdown rendering is local and does not introduce a new request path. Save
failures continue through the current detail-save error behavior, leaving the
draft available for retry.

## Verification

Presentation tests will verify that:

- each supported item type omits `Description` and the labeled `Note` property;
- exactly one unlabeled note surface appears at the end of the detail content;
- clicking or keyboard activation enters edit mode;
- Markdown syntax renders into representative semantic elements;
- editing marks the detail dirty and Save sends only the changed `note`;
- hidden legacy `description` data is not included in a detail patch;
- linked items appear before the note surface.

Run the frontend unit suite, typecheck, and production build after implementation.

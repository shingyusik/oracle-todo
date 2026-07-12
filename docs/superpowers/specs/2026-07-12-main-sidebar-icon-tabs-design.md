# Main Sidebar Icon Tabs Design

## Scope

Replace the Dashboard and ToDo labels in the main sidebar with icon-only tabs. Preserve their existing selection and navigation behavior.

## Layout

- Main tab rail width: `64px`.
- Sub-sidebar width: unchanged at `148px`.
- Main navigation width: `212px`.
- The logo header remains unchanged.

## Tab Controls

| Tab | Icon | Accessible name | Tooltip |
| --- | --- | --- | --- |
| Dashboard | `LayoutDashboard` | `Dashboard` | `Dashboard` |
| ToDo | `ListTodo` | `ToDo` | `ToDo` |

- Each tab is a button with an `aria-label` equal to its tab label.
- The icon is decorative and hidden from assistive technology.
- The visible label is not rendered inside the button.
- Hover and keyboard focus reveal a tooltip positioned to the right of the main tab rail.
- The active tab retains the existing mint background and dark icon color.

## Verification

- Presentation tests assert that each main tab has its accessible name, contains the expected icon, and has no visible text label.
- Presentation tests assert tooltip metadata for the hover/focus label.
- Type checking, frontend tests, and production build complete without errors.

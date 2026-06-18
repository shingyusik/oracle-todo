# Todo Engine Frontend Design System

## Source Inspiration

This design language adapts the Shopify-inspired DESIGN.md reference from getdesign.md for a local-first productivity workbench. The app uses the transactional side of that system: black ink, cream and white canvases, mint growth accents, pill commands, thin display type, and disciplined spacing. The workbench is an operational tool, so density, scanability, and predictable navigation take priority over cinematic marketing composition.

Reference:
- https://getdesign.md/shopify/design-md
- https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/shopify/DESIGN.md

## Visual Theme

- Mood: quiet command center, precise, local-first, low-glare.
- Primary surface: cream application canvas with white panels.
- Navigation chrome: black or near-black main sidebar, cream sub sidebar.
- Accent: aloe mint for active selection, approval state, and primary action emphasis.
- Typography: thin display headings for page identity; Inter/system UI for dense controls.
- Buttons: pill shape only.
- Cards: 8px radius or less for normal app panels; 12px only for prominent summary cards.
- Decoration: no gradient orbs, no bokeh, no ornamental SVG backgrounds.

## Color Palette

| Token | Hex | Role |
| --- | --- | --- |
| `canvasNight` | `#000000` | Main sidebar and high-contrast chrome |
| `canvasNightElevated` | `#0a0a0a` | Hover/active dark surfaces |
| `canvasLight` | `#ffffff` | Panels, tables, forms |
| `canvasCream` | `#fbfbf5` | App background |
| `ink` | `#000000` | Primary text on light surfaces |
| `onDark` | `#ffffff` | Text and icons on dark surfaces |
| `aloe` | `#c1fbd4` | Active tabs, primary accent, success emphasis |
| `pistachio` | `#d4f9e0` | Soft status band and secondary accent |
| `hairlineLight` | `#e4e4e7` | Light dividers and panel borders |
| `hairlineDark` | `#1e2c31` | Dark dividers |
| `shade30` | `#d4d4d8` | Neutral tag background |
| `shade40` | `#a1a1aa` | Muted text on dark |
| `shade50` | `#71717a` | Secondary text |
| `shade60` | `#52525b` | Tertiary text |
| `shade70` | `#3f3f46` | Pressed black pill |

## Typography

Use `Inter Variable, Inter, Helvetica, Arial, sans-serif` for the product UI. Use `Inter Display, Inter, Helvetica, Arial, sans-serif` at light weights for display roles. If a future design pass adds a licensed display font, keep the same size and weight roles.

| Token | Size | Weight | Line Height | Letter Spacing | Use |
| --- | --- | --- | --- | --- | --- |
| `displayLg` | 48px | 330 | 1.12 | 0 | Main page title |
| `displayMd` | 36px | 330 | 1.16 | 0 | Secondary page title |
| `headingLg` | 24px | 500 | 1.2 | 0 | Panel title |
| `headingMd` | 20px | 500 | 1.35 | 0 | Section heading |
| `bodyLg` | 18px | 500 | 1.56 | 0 | Lead text |
| `bodyMd` | 16px | 420 | 1.5 | 0 | Default UI text |
| `bodyStrong` | 16px | 550 | 1.5 | 0 | Emphasis |
| `caption` | 14px | 500 | 1.45 | 0 | Helper text |
| `micro` | 12px | 500 | 1.4 | 0 | Navigation metadata |
| `code` | 14px | 400 | 1.5 | 0 | Technical values |

Global rule: `font-feature-settings: "ss03"` may be enabled when supported. Do not use negative letter spacing.

## Spacing

| Token | Value |
| --- | --- |
| `xxs` | 2px |
| `xs` | 4px |
| `sm` | 8px |
| `md` | 12px |
| `lg` | 16px |
| `xl` | 24px |
| `xxl` | 32px |
| `huge` | 64px |

Application surfaces use an 8px base grid. Sidebar rows are 42-48px tall. Main content bands use 24-32px internal padding on desktop and 16-20px on mobile.

## Layout

- Root viewport fills `100dvh`.
- Workbench uses three columns on desktop:
  - Main sidebar: 112px.
  - Separator rail: 32px.
  - Sub sidebar: 132px.
  - Main panel: remaining width.
- Logo area spans the full left navigation width.
- Main sidebar tabs choose the top-level context.
- Sub sidebar shows child tabs for the active context.
- Main panel changes content based on the selected leaf tab.
- Mobile below 768px collapses navigation into stacked horizontal strips above the main panel.

## Components

### Sidebar Tabs

- Main tabs use black chrome with white text by default.
- Active main tab uses aloe fill with black text.
- Sub tabs use cream/white surfaces with black text.
- Active sub tab uses aloe fill, black text, and a 1px black inset border.
- Use icon-only collapse controls with tooltips when collapse behavior exists.

### Buttons

- All command buttons are pills.
- Primary pill: black fill, white text, 12px 24px padding.
- Accent pill: aloe fill, black text, 12px 24px padding.
- Outline pill: transparent or white fill, 1px black or white border.
- Minimum touch target: 44px height.

### Panels and Cards

- Repeated item cards use 8px radius.
- Summary cards may use 12px radius.
- Light panels use white fill and `hairlineLight` borders.
- App sections are unframed full-width layouts, not nested cards.
- Avoid cards inside cards.

### Forms

- Inputs use white fill, black text, 8px radius, 1px `hairlineLight` border.
- Focus ring uses aloe with a black inner contrast line where needed.
- Empty states are compact and action-oriented.

## Do

- Keep layout dense, readable, and work-focused.
- Prefer the light transactional palette for todo workflows.
- Reserve aloe and pistachio for state and emphasis.
- Keep routing, state, design tokens, and presentational layout in separate files.
- Make active navigation obvious in both sidebars.
- Use icons for purely mechanical controls such as collapse, expand, refresh, and settings.

## Do Not

- Do not build a landing page for the workbench.
- Do not use marketing hero sections in the app shell.
- Do not use decorative gradient blobs or orbs.
- Do not make the UI a single green theme; neutral black, cream, and white must dominate.
- Do not hardcode hex colors inside feature components.
- Do not put business logic in route files or presentational wireframes.

## Responsive Behavior

| Breakpoint | Width | Behavior |
| --- | --- | --- |
| Wide | `>= 1440px` | Fixed navigation widths, spacious main panel |
| Desktop | `1024px-1439px` | Fixed navigation widths, tighter panel grid |
| Tablet | `768px-1023px` | Main panel grid becomes single column |
| Mobile | `< 768px` | Sidebars become top navigation strips, content follows |

## Verification Expectations

- UI components use tokens from `src/design`.
- Wireframe components do not import application, infrastructure, stores, or browser APIs.
- Controller hooks own selection state and handlers.
- Tests cover tab tree policy, tab selection, layout rendering, and main panel switching.

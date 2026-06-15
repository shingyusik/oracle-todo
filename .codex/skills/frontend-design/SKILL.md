---
name: frontend-design
description: Design, implement, and refactor frontend features in frontend/ using this repository's stack (Next.js 14 App Router, React 18, TypeScript 5 strict, Tailwind CSS v4, Vitest, Zustand, TanStack React Query, and Radix/shadcn-style UI primitives). Use when building new UI, redesigning screens, enforcing clean architecture boundaries, removing dead frontend code, or standardizing code style/design/folder structure.
---

# Frontend Design

## Objective

Deliver production-ready frontend outcomes with strong design intent, clean architecture, and no dead code.

## Stack Baseline (Inspect First)

Treat `frontend/package.json` as source of truth. Align solutions with these defaults:

- Framework/runtime: Next.js 14 App Router + React 18
- Language: TypeScript 5 (`strict`) with explicit types
- Styling: Tailwind CSS v4 + `src/styles/globals.css` tokens/utilities
- UI primitives: `src/components/ui/*` (Radix/shadcn-style composition)
- State:
  - Server state / async fetch orchestration: TanStack React Query
  - Client state: Zustand stores in `src/stores/*`
- Testing:
  - Unit/integration: Vitest (`npm run test`)
  - Architecture rules: Vitest architecture suite (`npm run test:arch`)

## Repository Architecture (Required)

Follow existing folder boundaries and do not collapse layers:

- Routes/shell: `src/app/*`
- Feature-facing UI: `src/features/*`, `src/components/*`
- Presentation hooks/adapters: `src/presentation/*`
- Application use-cases and ports: `src/application/*`
- Domain models/rules: `src/domain/*`
- Infrastructure gateways/adapters: `src/infrastructure/*`
- Shared libs/hooks/api client: `src/lib/*`
- Global/client stores: `src/stores/*`

Rules:
- Keep domain/application logic out of route files and presentational components.
- Depend inward: UI -> application/domain via ports, infrastructure implements ports.
- Keep features modular; avoid cross-feature imports unless the dependency is explicitly shared.
- Preserve existing naming conventions and file granularity.

## Delivery Workflow

1. Inspect current implementation and touched boundaries before editing.
2. Define visual direction (typography, palette, spacing, motion) that matches product context.
3. Implement in vertical slices (route wiring -> feature UI -> state/data -> polish).
4. Remove dead code introduced or uncovered by the change.
5. Run quality gates and fix regressions before finishing.

## Dead Code Elimination (Required)

- Remove unused components/hooks/types/utilities/styles in changed scope.
- Remove stale imports/exports and unreachable branches.
- Delete legacy files only after verifying no references remain (`rg` search).
- Avoid placeholder comments/TODO leftovers in final code.
- If a file is kept for compatibility, document why in code comment or PR notes.

## Implementation Standards

- Use explicit prop and return types for exported APIs.
- Keep side effects isolated in hooks/services; keep components mostly declarative.
- Model loading/empty/error/success states for async UI.
- Preserve accessibility baseline: keyboard navigation, focus visibility, semantic markup.
- Reuse shared primitives/tokens before creating new one-off patterns.
- Maintain consistent code style, design language, and folder/file structure.

## Design Expectations

- Avoid generic, boilerplate-looking layouts.
- Use intentional typography and spacing hierarchy.
- Use coherent color and motion tokens instead of ad hoc values.
- Preserve established visual language when editing existing product surfaces.
- Ensure desktop and mobile behavior are both production-ready.

## Quality Gates (Required Before Finish)

- `cd frontend && npm run build`
- `cd frontend && npm run lint`
- `cd frontend && npm run test`
- `cd frontend && npm run test:arch`

Deliver only when all checks pass or when explicit, documented exceptions are approved.

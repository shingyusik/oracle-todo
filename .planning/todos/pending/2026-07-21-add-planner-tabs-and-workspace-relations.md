---
created: 2026-07-21T13:44:44.284Z
title: Add planner tabs and workspace relations
area: ui
files:
  - frontend/src/features: Planner and Workspace UI
  - docs/superpowers/specs/2026-07-08-planner-advanced-filter-design.md
  - docs/superpowers/specs/2026-07-13-planner-notion-group-settings-design.md
  - docs/superpowers/specs/2026-07-21-shared-backend-preferences-design.md
---

## Problem

Planner filters, sorting, and grouping are configurable, but users need to preserve several useful combinations and switch between them without reconfiguring the current table. The saved configuration must stay within the Planner table where it was created: selecting a saved tab must not navigate to another Planner view such as Daily or Weekly.

Workspace detail panels also lack a direct way to inspect and open the work connected to the selected item. Users need a visible linked-item list and one-click navigation instead of manually finding each related item.

## Solution

Add per-table Planner custom tabs that save and restore the current filter, sort, and group configuration. Each Planner table owns its own tabs and settings; tabs affect only their originating table.

Add relation sections to Workspace item detail views. Area shows linked projects, tasks, routines, and events. Project shows linked routines, tasks, and events. Apply the same relationship-list and direct-detail-navigation principle to the remaining item types where a relationship exists.

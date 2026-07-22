---
created: 2026-07-21T13:44:44.284Z
title: Separate planner table settings
area: ui
files:
  - frontend/src/features: Planner UI and controller
  - docs/superpowers/specs/2026-07-08-planner-advanced-filter-design.md
  - docs/superpowers/specs/2026-07-13-planner-notion-group-settings-design.md
  - docs/superpowers/specs/2026-07-21-shared-backend-preferences-design.md
---

## Problem

Planner tables must not share filter, sort, and group state. Changing one table's controls should not overwrite the configuration of another Planner table.

## Solution

Keep filter, sort, and group configuration independent for every Planner table. Persist and restore each table's own configuration without navigating to another Planner view.

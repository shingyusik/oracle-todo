---
created: 2026-07-21T13:44:44.284Z
title: Add planner custom tabs
area: ui
files:
  - frontend/src/features: Planner UI and controller
  - docs/superpowers/specs/2026-07-21-shared-backend-preferences-design.md
---

## Problem

Users need several reusable combinations of filters, sorting, and grouping in the same Planner table, without recreating the controls each time.

## Solution

Let a user save the current filter, sort, and group configuration as a custom tab inside its current Planner table. Support multiple tabs per table; selecting one restores only that saved configuration and never changes Planner table or date view.

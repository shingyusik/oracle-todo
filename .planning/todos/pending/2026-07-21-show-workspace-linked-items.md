---
created: 2026-07-21T13:44:44.284Z
title: Show workspace linked items
area: ui
files:
  - frontend/src/features: Workspace detail views
---

## Problem

Workspace detail panels do not show the related work, forcing users to manually find linked items.

## Solution

Show linked-item lists in each Workspace detail view, with direct navigation to the selected item. Area lists linked projects, tasks, routines, and events; Project lists linked routines, tasks, and events. Apply the same relationship-list principle to the remaining item types where links exist.

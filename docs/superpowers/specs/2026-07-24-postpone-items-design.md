# Postpone Items Design

## Purpose

`Postpone` records that a task or event was not completed on its scheduled
date, then creates a separate follow-up item for a later date. It supports
ordinary tasks, events, and tasks generated from routines without changing a
routine's recurrence schedule.

## Scope

- Item types: `task` and `event` only.
- Eligible source statuses: `active`, `waiting`, and `paused`.
- The default target date is the local next calendar day.
- An explicit target date must be strictly later than the local current day.
- The existing `someday` status represents a postponed source item.

Routine templates and all terminal items are not eligible for postponement.

## Resulting Items

Postponing an item is one atomic service operation with two persisted item
changes:

1. The source keeps its original `scheduled` date and changes to `someday`.
2. A new `active` follow-up item is created with `scheduled` set to the target
   date.

The follow-up keeps the source type (`task` or `event`) and copies its title,
description, note, tags, priority, area, project, parent, and `due` value.
The scheduled date is the only copied scheduling field that changes. A due
date remains unchanged because it represents the real deadline rather than
the planned working date.

The source and follow-up retain a bidirectional trace in metadata:

- source: `postponed_to` contains the follow-up item ID;
- follow-up: `postponed_from` contains the source item ID.

Postponing a follow-up repeats the same operation. This produces a chain of
items whose individual original dates and `someday` statuses make missed work
reviewable by date.

## Routine Semantics

A routine-generated task records its source occurrence as `someday` and
creates an independent follow-up task. The follow-up removes `routine_id`,
`occurrence_key`, and the `metadata.generated_by = "routine"` marker.

The service records the routine occurrence and refills the routine's rolling
materialization target in the same operation. The routine therefore continues
at its configured cadence, while the postponed follow-up is not treated as a
new routine occurrence.

## Interfaces

The service exposes a postpone operation that receives an item ID, an explicit
target date, and an optional reason. Interface adapters determine the default
target date and pass it as an explicit ISO date to the service.

- HTTP: `POST /items/{id}/postpone` accepts an optional target-date field.
- CLI: `postpone <item_id>` defaults to tomorrow; an optional date flag sets a
  later target date.
- Planner: active task and event rows in Daily, Weekly, and Monthly show a
  compact Postpone control beside the completion checkbox. It postpones to
  tomorrow immediately. The item detail panel offers `Postpone to…` for an
  explicit later date.

The planner does not add a special hidden view. Source items remain queryable
through the existing `status = someday` filter and retain their original
scheduled date. Status labels remain English; `someday` is not renamed.

## Audit and Errors

The source transition and follow-up creation each create their normal audit
event, with postpone-specific action names. Repository persistence must be
transactional so neither item remains without the other.

The operation rejects missing items, unsupported item types, terminal source
statuses, invalid date input, and target dates that are today or earlier.

## Verification

Tests cover:

- default and explicit target dates;
- regular task and event postponement;
- preservation of copied fields, especially `due`;
- source/follow-up metadata links and repeated-postpone chains;
- a routine-generated source task, including routine target replenishment and
  removal of routine provenance from the follow-up;
- rejected item types, statuses, and dates;
- audit events and atomic failure behavior;
- planner controls in Daily, Weekly, and Monthly, including pending and error
  handling.

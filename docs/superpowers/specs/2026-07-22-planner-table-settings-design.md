# Planner Table Settings Design

**Date:** 2026-07-22
**Status:** Approved for implementation planning

## Goal

Give every meaningful Planner table its own filter, sort, group, and create
controls. A setting changed for one table must affect neither another table in
the same Planner tab nor a table in another Planner tab.

## Table Boundaries

| Planner tab | Table ID | Table | Shared scope |
| --- | --- | --- | --- |
| Daily | `daily.today` | Today | This table only |
| Daily | `daily.overdue` | Before / overdue | This table only |
| Daily | `daily.unscheduled` | Unscheduled | This table only |
| Weekly | `weekly.month-goals` | Goals for this month | This table only |
| Weekly | `weekly.week-goals` | Goals for this week | This table only |
| Weekly | `weekly.day-grid` | Weekday cards | All seven weekday cards share one setting |
| Monthly | `monthly.period-goals` | Period goal cards | This table only |
| Monthly | `monthly.calendar` | Calendar day cards | All calendar day cards share one setting |
| Monthly | `monthly.week-goals` | Weekly goal rails | All weekly rails share one setting |
| Yearly | `yearly.period-goals` | Period goal cards | This table only |
| Yearly | `yearly.month-goals` | Monthly goal cards | All month cards share one setting |

## UI

The Planner's top-level toolbar retains period navigation and its current-period
reset action, but no longer owns filter, sort, group, or create actions. Each
table header renders its own filter, sort, group, and add controls. A control
opens a dropdown or creation dialog scoped to that table only.

Each table keeps the existing Planner field and group-option restrictions for
its tab. For example, goal tables retain goal-compatible fields, while date
based tables retain task/event-compatible fields.

## Settings Model and Persistence

The existing `planner.v1` preference value gains a `tableSettings` object.
Each stable table ID maps to a complete control set:

```ts
type PlannerTableSettings = {
  filterMode: "and" | "or";
  filterRules: PlannerFilterRule[];
  sortRules: PlannerSortRule[];
  groupSettings: PlannerGroupSettings;
};

type PlannerPreferenceValue = {
  tableSettings: Record<PlannerTableId, PlannerTableSettings>;
  // Existing fields remain readable for migration compatibility.
};
```

On first load of a legacy preference document, the frontend derives defaults
for every table in a tab from that tab's former shared controls. The next
successful settings write persists `tableSettings`. Missing or malformed
settings for one table fall back only that table to its default; valid settings
for other tables remain active. Existing serialized writes remain in place.

## Rendering Data Flow

Every Planner table applies controls independently:

1. Derive the raw items belonging to that table.
2. Apply that table's valid filter rules.
3. Sort the resulting items with that table's sort rules.
4. Build that table's groups with that table's group settings.

The section boundary comes before filtering. Thus a Daily Today rule can never
hide or reorder items in Daily Before or Unscheduled.

## Contextual Creation

The add button opens a dialog with a table context. Goal tables permit only a
Goal. Date-based tables permit Task and Event, except Daily Unscheduled, which
permits only Task. Routines are excluded because Planner rendering currently
displays only tasks and events.

| Table kind | Creation default |
| --- | --- |
| Daily Today | Selected Daily date |
| Daily Before | Day before the selected Daily date |
| Daily Unscheduled | No scheduled date; Task only |
| Weekly day grid | Monday of the selected week; editable in the dialog |
| Monthly calendar | First day of the selected month; editable in the dialog |
| Weekly month goals | Goal with the selected week's month anchor |
| Weekly week goals | Goal with the selected week anchor |
| Monthly period goals | Goal with the selected month anchor |
| Monthly weekly goal rails | Goal with the selected month's first-week anchor; editable in the dialog |
| Yearly period goals | Goal with the selected year anchor |
| Yearly monthly goal cards | Goal with the selected year's January anchor; editable in the dialog |

Compatible single-value `and` filters prefill creation fields: area, project,
tag, and priority. User input always wins over a prefilled value. Non-
deterministic filters, including `or` combinations, text matches, and ranges,
do not constrain the request. When such a filter means the new item might not
appear in its source table, the dialog explains that outcome before submission.

## Error Handling

Preference reads and writes remain best-effort. A failed read uses defaults;
a failed write leaves the current session state usable and is retried by the
next change. Creation continues to surface the existing API validation error
in the dialog.

## Verification

- Unit/model tests prove each table's filter, sort, and group settings are
  isolated from every other table.
- Controller tests cover preference migration, per-table normalization, and
  persistence across remounts.
- Presentation tests cover table-local controls and ensure their effects stay
  within the source table.
- Creation tests cover allowed types, defaults, editable dates, compatible
  filter prefills, and non-deterministic-filter guidance.
- Regression tests prove Routine is neither rendered nor offered by Planner
  creation controls.

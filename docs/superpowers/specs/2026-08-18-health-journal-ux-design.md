# Health Journal UX Design

## Goal

Provide low-friction general health recording with reports focused on relationships between
diet, bowel activity, medication, and daily health measurements. Health Journal uses the
same table, saved-view, dialog, and detail interactions as ToDo and Ledger.

## Navigation

Health Journal contains these tabs in order:

1. Diet
2. Bowel
3. Medication
4. Health Metrics
5. Reports

Diet is the default tab. Health Journal has no Timeline tab. Each record tab owns its record
management, and Reports contains only statistics and charts.

## Shared Record-Tab Behavior

Diet, Bowel, Medication, and Health Metrics use the shared table structure:

- saved views on the left;
- filter, sort, group, add, and delete actions on the right;
- an ungrouped, newest-first default view;
- stable selection and select-all over visible rows;
- an Add dialog for creation;
- a row-activated detail view with Back, Undo, Redo, Save, and Delete;
- archived records excluded from tables, choices, and saved-view candidates.

Table rows are read-only. Editing occurs in the detail view. Created and updated timestamps
appear in details rather than default table columns. Each tab stores its view preferences in
its own Health Journal namespace.

Mutation and refresh behavior follows Ledger:

- a failed mutation preserves the draft and error;
- a successful mutation followed by a failed refresh retries only the refresh;
- batch deletion processes visible logical rows in selection order and retains failed or
  unattempted selections;
- stale requests cannot replace newer state.

## Diet

### Table

Default columns are Time, Meal, Food, Tags, Photo, and Note.

Supported view fields are:

- filters: time or date, meal, food, tags, and photo presence;
- sorts: time, meal, food, created, and updated;
- groups: day, week, month, meal, tag, and photo presence.

### Creation and Detail

The Add dialog uses this field order:

1. Time
2. Meal
3. Food
4. Tags
5. Photo
6. Note

Time, meal, and food are required. Photo, tags, and note are optional. Photo supports upload,
replacement, and removal.

Tags use the existing ToDo interaction: search existing options, create a new tag, show
selected tags as removable chips, and remove duplicates. Diet tag options come only from
Health Journal diet records; they do not share ToDo tag data.

## Bowel

### Table

Default columns are Time, Bristol Scale, Blood Visible, and Note.

Supported view fields are:

- filters: time or date, Bristol scale, and blood visibility;
- sorts: time, Bristol scale, created, and updated;
- groups: day, week, month, Bristol scale, and blood visibility.

### Creation and Detail

The Add dialog uses this field order:

1. Time
2. Bristol scale
3. Blood visible
4. Note

Time and Bristol scale are required. Bristol scale uses a dropdown restricted to integers
from 1 through 7. Blood visibility defaults to false, and note is optional.

## Medication

### Table

Default columns are Taken At, Medication, Dose, Unit, and Note.

Supported view fields are:

- filters: time or date, medication name, and unit;
- sorts: time, medication name, dose, created, and updated;
- groups: day, week, month, medication name, and unit.

### Creation and Detail

The Add dialog uses this field order:

1. Taken at
2. Medication name
3. Dose
4. Unit
5. Note

Taken at, medication name, dose, and unit are required. Units retain the existing domain
values and use the labels 정, 캡슐, 포, mg, g, ml, 방울, and 회. Note is optional.

## Health Metrics

### Daily Projection

Health Metrics presents one logical row per local calendar date. The row combines independent
daily health events without adding a daily-summary database record.

Default columns are Date, Weight, Sleep, CRP, Calprotectin, Condition, and Note. Supported
view fields are:

- filters: date and the presence or value of each measurement;
- sorts: date and each numeric measurement;
- groups: week and month.

The fixed measurements are:

| Measurement | Unit or range |
| --- | --- |
| Weight | kg |
| Sleep | hours, greater than 0 and at most 24 |
| CRP | mg/L |
| Fecal calprotectin | µg/g |
| Overall condition | integer from 1 through 10 |

Condition uses a dropdown. Its optional note belongs to the overall-condition event.

### Daily Creation and Editing

The Add dialog defaults to today. Selecting a date that already has measurements loads those
values into the form. Saving updates existing measurement identities rather than creating
duplicates.

A daily detail save is one service operation:

- entered values are created or updated;
- a stored value cleared in the draft is archived;
- unchanged values remain untouched;
- either the entire logical save succeeds or none of it is persisted.

Deleting one daily row archives every active daily measurement for that date atomically.
Deleting several selected daily rows may partially succeed between dates, but a single date
cannot be partially archived.

## Reports

### Period

Reports defaults to the most recent 30 days and supports 7, 14, 30, and 90 day presets plus
an inclusive custom local-date range. A refresh keeps the previous complete report visible
until the replacement succeeds.

### Summary

The first row shows the latest selected-period Weight, Sleep, CRP, Calprotectin, and Condition
measurements. Each card compares the value with the immediately preceding measurement.

The second row shows selected-period Diet count, Bowel count and average, and Medication
count. Each card compares the value with the immediately preceding equal-length period.
Missing current or comparison data is shown as unavailable rather than zero.

### Charts

Reports uses a responsive dashboard layout. Desktop uses a compact grid; the same sections
stack vertically on narrow screens.

- Bowel trend: individual Bristol points in chronological order, connected by a line, with
  the 3 through 5 band visually distinguished.
- Health metric trend: one chart with a selector for Weight, Sleep, CRP, Calprotectin, and
  Condition so incompatible units never share an axis.
- Medication frequency: counts by medication name.
- Diet tag frequency: counts by tag.
- Diet-tag bowel response: abnormal-bowel rate within the following 24 hours.

Summary cards and chart targets drill into the related record tab with the report date range
and relevant date, tag, medication, or measurement filter applied.

### Diet-Tag Bowel Response

An abnormal bowel record has Bristol scale 1, 2, 6, or 7. For each diet tag:

1. each diet entry containing the tag is one candidate meal;
2. a candidate is positive when at least one abnormal bowel record occurs after the meal and
   no later than 24 hours after it;
3. the displayed rate is positive candidate meals divided by eligible candidate meals;
4. all tags remain visible, including a one-meal sample;
5. the numerator, denominator, and percentage are displayed together.

A meal is eligible only after its complete 24-hour observation window has elapsed. Historical
ranges may read bowel records through 24 hours after the selected end date to complete the
window. One bowel event may contribute to more than one overlapping meal window, and one meal
may contribute independently to each of its tags.

The report states that the result is an observed association candidate and does not establish
causation.

## Architecture and Data Flow

- `health.sqlite` remains the only Health source of truth.
- Diet entries and health events retain their existing independent records and lifecycle.
- Every mutation goes through the Health application service and writes audit history.
- No report cache, materialized summary, or new database is introduced.
- Record tabs use the existing paginated Diet and Health Event read boundaries.
- Daily Health Metrics rows are a deterministic frontend projection over active daily events.
- The Health engine computes complete report aggregates and returns a typed Reports response
  through the Raven API.
- Existing table-view and preference primitives are reused with Health-specific fields and
  namespaces.

## Loading, Empty, and Error States

- Each record tab distinguishes initial loading, empty data, no view matches, blocking error,
  and non-blocking refresh error.
- Add and detail actions remain pending until mutation and required refresh complete.
- Reports distinguishes no data from a failed query and exposes Retry without clearing the
  previous complete result.
- Empty charts describe which records are required rather than rendering meaningless axes.
- All dialogs restore focus to their enabled trigger or deterministic fallback.

## Verification

- tab order and Diet default navigation;
- Timeline and Trends absence;
- exact columns, fields, validation, and active-only rows for every record tab;
- Health-scoped ToDo tag interaction without cross-domain tag data;
- view filters, multi-sort, grouping, saved views, and deterministic ordering;
- Add dialog pending, failure-draft, and refresh-only recovery behavior;
- detail Undo, Redo, Save, Delete, keyboard shortcuts, and browser navigation;
- local-date daily projection, existing-date preload, atomic upsert, partial clear, and daily
  archive behavior;
- report presets, inclusive custom ranges, previous-value and previous-period comparisons;
- 24-hour open-start and closed-end boundaries, incomplete-window exclusion, overlapping
  windows, multi-tag meals, and abnormal Bristol classification;
- report loading, empty, retry, responsive layout, keyboard access, chart alternatives, and
  filtered drilldown.

## Non-Goals

- Timeline or combined record-feed tab
- Separate Symptoms tab or symptom-correlation report
- User-defined health measurements or medication units
- AI diagnosis, causal conclusions, recommendations, or alerts
- Report materialization or a second Health data store
- Archived-record browser, restore UI, or permanent-purge UI
- Changes to the global ToDo Dashboard

# Health Report Redesign Design

## Goal

Reorganize Health Journal Reports around the two changes the user checks most often:
daily bowel condition and body weight. Keep the existing supporting analyses available
without letting counts and tables dominate the page.

Dashboard Health highlights are intentionally deferred until the redesigned Report is
implemented and validated.

## Period selection

- Keep the existing 7, 14, 30, and 90 day presets.
- Add `Custom range` as a peer preset button.
- Show the From, To, and Apply controls only while `Custom range` is selected.
- Keep daily values at every range length. For long ranges, reduce visible date labels
  instead of changing the aggregation interval.
- Preserve the existing maximum custom range and validation behavior.

## Report hierarchy

### Primary summary

Show three summary values across the top:

1. Latest daily average Bristol score, including its local date and record count.
2. Latest body weight, including its local date and unit.
3. Body-weight change between the first and latest weight records in the selected period.

“Latest” always means the latest available record inside the selected period, not today.
If the period contains fewer than two weight records, show that no comparison is available
instead of reporting a zero change.

### Primary charts

Place two equally prominent line charts side by side on wide screens and stack them on
narrow screens.

#### Daily average Bristol score

- Group all bowel records by browser-local calendar date.
- Plot the arithmetic mean of that day's Bristol scores.
- Show the typical Bristol band from 3 through 5 behind the line.
- Do not create zero-valued points for dates without records.
- Connect the available recorded points across gaps.
- Expose the date, average, and contributing record count for each point.

#### Weight trend

- Plot the existing daily `body_weight` readings in chronological order.
- Do not create points for dates without records.
- Connect the available recorded points across gaps.
- Show the first and latest recorded weights near the chart heading.
- Keep the measurement unit visible on the axis and values.

Both charts retain drilldown into the matching source records with the selected report range
applied. Date labels are thinned to prevent overlap, while every data point remains available
for interaction and assistive output.

## Supporting analyses

### Other health metrics

Use one line chart with tabs for Sleep, Condition, CRP, and Calprotectin. Weight is omitted
because it already has a primary chart. Show the selected metric's latest value and its
change from the previous reading. An unavailable metric gets a local empty state without
hiding the other tabs.

### Diet and medication patterns

Show Diet tag frequency and Medication frequency as neighboring horizontal bar charts.
Each section includes its record coverage and keeps the existing filtered drilldown behavior.

### Diet–bowel response

Show each diet tag's abnormal bowel-response rate as a horizontal proportion bar. Display
`positive meals / eligible meals` beside the bar so a high percentage from a small sample is
not misleading. Keep the existing statement that the result is an association, not proof of
causation.

The existing Diet, Bowel, and Medication count cards are removed. Their counts become small
coverage context within the corresponding supporting section.

## Data and component boundaries

- Reuse the current Health report request and response contract.
- Derive daily Bristol averages and primary summary values from the existing report data in
  the frontend report model.
- Reuse the existing line-chart and drilldown patterns where they satisfy the design.
- Do not add a database migration, API route, dependency, or Dashboard projection in this
  phase.

## States and accessibility

- A report request failure keeps the existing report-level error and Retry action.
- Missing data affects only the relevant summary value or analysis section.
- A completely empty period shows the report-level empty explanation while retaining the
  stable section structure.
- Charts expose their axes and units visually and provide equivalent dated values for screen
  readers.
- Interactive chart points and frequency rows remain keyboard accessible.

## Verification

Automated coverage must include:

- multiple bowel events on one day producing the correct daily mean;
- omitted days remaining absent rather than becoming zero;
- latest Bristol and weight summaries using the latest in-range records;
- weight change using the first and latest in-range records;
- the one-weight-record comparison state;
- long ranges retaining daily points while thinning date labels;
- the collapsed Custom range controls and their existing validation;
- local empty states and source-record drilldowns;
- accessible chart labels and value output.

Run the focused frontend tests followed by the frontend test, typecheck, and build commands.

## Deferred Dashboard work

After this Report is implemented and visually verified, separately decide which of its results
belong on Dashboard, what period Dashboard should use, and how much interaction it should
share with Reports. This document does not choose or implement those Dashboard highlights.

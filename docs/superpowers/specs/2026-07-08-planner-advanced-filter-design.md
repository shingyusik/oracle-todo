# Planner Advanced Filter Design

## Scope

- Apply only to Planner views: Yearly, Monthly, Weekly, Daily.
- Replace the current Planner filter dropdown with a rule builder.
- Keep Sort and Group controls unchanged.
- Do not apply this filter system to Workspace tables in this phase.

## Filter Model

Planner state owns a rule list:

- `filterMode`: `and` or `or`
- `filterRules`: ordered rules

Each rule stores:

- `id`: stable UI key
- `field`: Planner column or item property
- `type`: `text`, `date`, `number`, `select`, `multiSelect`, or `relation`
- `operator`: allowed by `type`
- `value`: string, string array, date range, or empty

## Fields

Daily supports:

- Title: `text`
- Scheduled: `date`
- Due: `date`
- Tags: `multiSelect`
- Area: `relation`
- Project: `relation`
- Routine: `relation`
- Item Type: `select`
- Status: `select`
- Priority: `number`

Yearly, Monthly, and Weekly start with:

- Title: `text`
- Scheduled: `date`
- Tags: `multiSelect`
- Status: `select`
- Horizon: `select` for goal views

## Operators

Text:

- `is`
- `is_not`
- `contains`
- `does_not_contain`
- `starts_with`
- `ends_with`
- `is_empty`
- `is_not_empty`

Date:

- `is`
- `is_before`
- `is_after`
- `is_on_or_before`
- `is_on_or_after`
- `is_between`
- `is_relative_to_today`
- `is_empty`
- `is_not_empty`

Select, multi-select, relation:

- `contains`
- `does_not_contain`
- `is_empty`
- `is_not_empty`

Number:

- `is`
- `is_not`
- `greater_than`
- `less_than`
- `is_empty`
- `is_not_empty`

## UI

Filter dropdown contains:

- A searchable "Filter by..." field list when no rule is being added.
- Rule rows with field, operator, value editor, and remove action.
- A global `And` / `Or` control when more than one rule exists.
- An "Add filter rule" action.
- A "Delete filter" action that clears all rules.

Value editors depend on the field type:

- Text: single text input.
- Date: native date inputs for fixed dates and simple selects for relative periods.
- Select/relation/multi-select: checkbox option list.
- Number: numeric input.
- Empty/not-empty operators hide the value editor.

## Matching

- `and`: every rule must match.
- `or`: at least one rule must match.
- No rules means all current Planner items pass.
- Date comparisons use local `YYYY-MM-DD` date strings.
- Text comparisons are case-insensitive.
- Multi-select matching checks overlap with item values.

## Tests

- Planner model tests cover operator semantics and `and` / `or`.
- Presentation tests cover adding text, date, and multi-select rules.
- Presentation tests cover clearing rules and keeping Sort/Group behavior intact.

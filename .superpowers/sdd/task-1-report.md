# Task 1 Report: Backend Tags Field

## Summary

- Added `TodoItem.tags: Vec<String>` to the domain model with empty default initialization.
- Added service-layer tag normalization so create/propose/update flows trim whitespace, drop empties, and de-duplicate while preserving order.
- Added SQLite persistence for `items.tags` as JSON text with additive schema backfill through `ensure_item_columns`.
- Wired API create/propose/update DTOs and handlers so requests can accept `tags` and responses serialize them back out.

## TDD

### RED 1: API round-trip

Added `api_create_and_patch_round_trips_tags` to `todo-engine/tests/e2e/api.rs`.

Command:

```bash
cargo test -p todo-engine --test e2e api_create_and_patch_round_trips_tags
```

Observed failure:

```text
assertion `left == right` failed
  left: Null
 right: Array [String("deep-work"), String("planning")]
```

This confirmed the API was not returning normalized `tags`.

### RED 2: legacy schema backfill

Added `init_schema_adds_tags_column_to_legacy_items_table` to `todo-engine/tests/integration/schema_indexes.rs`.

Command:

```bash
cargo test -p todo-engine --test integration init_schema_adds_tags_column_to_legacy_items_table
```

Observed failure:

```text
assertion failed: columns.iter().any(|column| column == "tags")
```

This confirmed `init_schema` was not backfilling `items.tags`.

## Implementation details

### Service layer

- Added `normalize_tags(Vec<String>) -> Vec<String>` in `todo-engine/src/application/service/mod.rs`.
- Extended create/propose request structs in `todo-engine/src/application/service/creation.rs` with `tags: Vec<String>`.
- Applied normalized tags inside every create/propose method before persisting through `store_item_and_event`.
- Extended `UpdateItem` in `todo-engine/src/application/service/update.rs` with `tags: Option<Vec<String>>` and applied normalized tags before `updated_at` is refreshed.

### SQLite

- Added `tags TEXT NOT NULL DEFAULT '[]'` to the main `items` table definition.
- Added `("tags", "TEXT NOT NULL DEFAULT '[]'")` to `ITEM_COLUMN_ADDITIONS` so legacy `items` tables get the column additively.
- Extended row mapping to select, parse, and populate `TodoItem.tags`.
- Extended repository upsert SQL and parameters to store `tags` as JSON text.

### API

- Added optional `tags` to area/propose/update request DTOs.
- Passed `body.tags.unwrap_or_default()` into create/propose service requests.
- Passed `body.tags` into `UpdateItem` for PATCH handling.

## Verification run

Commands:

```bash
cargo fmt --check
cargo test -p todo-engine --test e2e api_create_and_patch_round_trips_tags
cargo test -p todo-engine --test integration init_schema_adds_tags_column_to_legacy_items_table
cargo test -p todo-engine
```

Result:

- All commands passed.
- `cargo test -p todo-engine` passed all unit, integration, and e2e tests.

## Additional compile-fix fallout

The shared service request structs are also constructed by existing CLI and integration-test code outside the brief's ownership list. After adding `tags` to those structs, Rust required those call sites to supply default tag values. I applied the smallest possible `Vec::new()` / `None` compile fixes in:

- `todo-engine/src/interfaces/cli/create.rs`
- `todo-engine/src/interfaces/cli/lifecycle.rs`
- several existing integration-test helper initializers

These changes do not add CLI tag flags or new behavior; they only preserve compilation after the shared request structs grew a new field.

## Self-review

- All mutations still flow through `TodoService`; no direct repository write path was added.
- Audit event behavior remains untouched because create/update still persist via `store_item_and_event`.
- Schema migration remains additive through `ensure_item_columns`.
- The implementation stores `tags` as simple JSON text and reuses existing JSON parsing patterns rather than introducing a new table or abstraction.
- One mild concern remains: the brief's ownership list did not include every existing struct-literal caller of the shared request types, so a few no-behavior compile fixes were necessary outside the listed files.

# Task 1 Report: Add Service/API Update Support for UI-Editable Fields

## What changed

- Added a failing e2e API test for PATCH `/items/{id}` covering:
  - goal `horizon` updates
  - event metadata updates for `location`, `participants`, and `commitment_type`
- Extended `UpdateItem` in the service layer to accept:
  - `horizon`
  - `location`
  - `participants`
  - `commitment_type`
- Updated `TodoService::update_item` to:
  - write `horizon` onto the item directly
  - write event-editable metadata fields into `item.metadata`
  - continue persisting through the existing service/repository/audit-event path
- Wired the API PATCH DTO and handler so the new request fields reach `TodoService::update_item`
- Updated the CLI `UpdateItem` initializer with `None` for the new fields so the crate still compiles after extending the shared request struct

## Tests run

### RED

Command:

```bash
cargo test -p todo-engine --test e2e api_patch_updates_goal_horizon_and_event_metadata
```

Observed failure:

```text
thread 'api::api_patch_updates_goal_horizon_and_event_metadata' panicked at todo-engine/tests/e2e/api.rs:590:5:
assertion `left == right` failed
  left: String("month")
 right: "year"
```

This confirmed PATCH was ignoring `horizon`.

### GREEN

Command:

```bash
cargo test -p todo-engine --test e2e api_patch_updates_goal_horizon_and_event_metadata
```

Observed success:

```text
running 1 test
test api::api_patch_updates_goal_horizon_and_event_metadata ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 39 filtered out
```

## Files changed

- `todo-engine/src/application/service/update.rs`
- `todo-engine/src/interfaces/api/dto.rs`
- `todo-engine/src/interfaces/api/handlers.rs`
- `todo-engine/tests/e2e/api.rs`
- `todo-engine/src/interfaces/cli/lifecycle.rs`

## Self-review

- Kept the implementation minimal and local to the existing update path.
- No schema changes were made.
- No direct SQLite writes were added outside the existing service/repository path.
- Audit event behavior remains on the existing `store_item_and_event` path.
- The only file outside the requested ownership list was `todo-engine/src/interfaces/cli/lifecycle.rs`, updated minimally because extending the shared `UpdateItem` struct otherwise broke compilation at the existing CLI initializer.

## Concerns

- The task brief’s requested file ownership list did not include the CLI initializer that also constructs `UpdateItem`; one minimal compile-fix there was necessary.
- Verification was limited to the required RED/GREEN targeted e2e test from the brief, not the full test suite.

---

## Review fix follow-up

### What was fixed

- Goal horizon updates now stay on the existing `TodoService::update_item` path but re-run goal policy checks before mutating:
  - horizon parsing
  - canonical `(horizon, scheduled)` anchor validation
  - duplicate goal triple rejection
- Event metadata patch fields (`location`, `participants`, `commitment_type`) are now rejected for non-event items.
- Event metadata success cases still persist through the same audited `store_item_and_event` flow.

### TDD evidence

#### RED

Command:

```bash
cargo test -p todo-engine --test e2e api_patch_
```

Observed failure:

```text
test api::api_patch_rejects_event_metadata_for_non_event_items ... FAILED
test api::api_patch_rejects_invalid_goal_horizon_anchor ... FAILED
```

Failure details:

```text
assertion `left == right` failed
  left: 200
 right: 400
```

This confirmed PATCH was still accepting invalid goal horizon state and non-event metadata updates.

#### GREEN

Command:

```bash
cargo test -p todo-engine --test e2e api_patch_
```

Observed success:

```text
running 4 tests
test api::api_patch_rejects_event_metadata_for_non_event_items ... ok
test api::api_patch_rejects_invalid_goal_horizon_anchor ... ok
test api::api_patch_updates_event_metadata ... ok
test api::api_patch_updates_goal_horizon_with_valid_anchor ... ok
```

### Additional regression checks

Commands:

```bash
cargo test -p todo-engine --test integration goal_policy
cargo test -p todo-engine --test integration service_policy
```

Observed success:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 55 filtered out
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 53 filtered out
```

# Verification and Smoke

## The verification gate

All three must pass before committing any source change:

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

`-D warnings` makes warnings (including unused imports) hard errors. `cargo test` runs all
three test binaries; you can run them individually:

```bash
cargo test --test unit
cargo test --test integration
cargo test --test e2e
```

See [../conventions/testing.md](../conventions/testing.md) for what each layer covers.

## Coverage

Target **≥80% line coverage**. If the tooling is installed, measure with (try in order):

```bash
cargo llvm-cov --summary-only
# or
cargo tarpaulin --out Stdout
```

Do **not** install coverage tooling without approval. If neither tool is available, record
that coverage was not measured rather than installing one.

## Copied-data smoke (never the live home)

Run smoke checks only against a **copy** of the data home — never against the live
`~/.todo-engine/todo.sqlite` (see [data-home.md](data-home.md)). With a real legacy
database available:

```bash
tmp_home="$(mktemp -d)"
cp ~/.todo-engine/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -p todo-engine -- --home "$tmp_home" pending
cargo run -p todo-engine -- --home "$tmp_home" today
```

Opening the copied database runs schema initialization, so legacy `proposed` and `approved`
rows must appear as `active`. No missing project `definition_of_done` or routine
`recurrence_rule` is synthesized.

Without a legacy database, start from a fresh init in a temp home:

```bash
tmp_home="$(mktemp -d)"
cargo run -p todo-engine -- --home "$tmp_home" init
cargo run -p todo-engine -- --home "$tmp_home" task propose "Smoke task"
cargo run -p todo-engine -- --home "$tmp_home" project propose "Smoke project" \
  --definition-of-done "All smoke checks pass"
cargo run -p todo-engine -- --home "$tmp_home" routine propose "Smoke routine" \
  --recurrence-rule "RRULE:FREQ=DAILY"
cargo run -p todo-engine -- --home "$tmp_home" pending
cargo run -p todo-engine -- --home "$tmp_home" today
```

Creation output and `pending` must show `active` items. Also verify the exact creation
validation errors (both commands exit `2`):

```bash
cargo run -p todo-engine -- --home "$tmp_home" project propose "Missing DoD"
# Project requires definition_of_done
cargo run -p todo-engine -- --home "$tmp_home" routine propose "Missing recurrence"
# Routine requires recurrence_rule
```

The automated smoke coverage exercises the remaining lifecycle paths without relying on
shell JSON parsing:

```bash
cargo test --test integration init_schema_migrates_legacy_open_statuses
cargo test --test integration generated_routine_task_is_active_and_returns_to_active_after_resume
cargo test --test integration materialization_fills_the_default_future_occurrence_target
```

The smoke passes when the normal commands exit `0`, both validation probes exit `2` with the
exact messages shown above, and the live home remains untouched. `*.sqlite` is gitignored,
so a temp copy is never committed.

## Structure checks

After a refactor, confirm: no `todo-engine/src/**/*.rs` is much over ~400 lines and
`docs/{architecture,conventions,operations}` are populated.

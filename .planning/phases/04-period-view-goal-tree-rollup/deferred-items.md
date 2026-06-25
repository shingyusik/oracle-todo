# Deferred Items — Phase 04

Out-of-scope discoveries logged during execution. NOT fixed in this plan.

## Pre-existing e2e flake: `cli::init_loads_todo_engine_home_from_dotenv`

- **Found during:** Plan 04-01 full-suite verification.
- **Symptom:** `todo-engine.exe init` resolves the data home to the default
  `~/.todo-engine/todo.sqlite` (under a temp `$HOME`) instead of the
  `TODO_ENGINE_HOME` value the test writes into a temp `.env`, so the
  `var.contains(<dotenv path>)` assertion fails.
- **Scope:** Entirely in the CLI/dotenv/data-home resolution path
  (`interfaces/cli`, `infrastructure/paths.rs`, `.env` loading). Plan 04-01
  touched only `application/service/queries.rs`, `application/service/goal.rs`,
  `application/service/mod.rs`, and `tests/integration/period_view.rs` — none of
  which influence this test. The test exists unchanged at commit `7faa001`
  (predates this plan), confirming the failure is pre-existing, not a
  regression.
- **Likely cause:** environment/ordering sensitivity of dotenv loading under
  the parallel e2e test harness (a shared-process env var leaks across tests).
- **Action:** NOT fixed here (out of scope). Carry forward for a CLI/dotenv
  hardening pass.

# Deferred Items — Phase 04.1

Out-of-scope discoveries logged during execution (not fixed; carried forward).

| Discovered In | Item | Reason Deferred |
|---------------|------|-----------------|
| Plan 04.1-03 | `cli::init_loads_todo_engine_home_from_dotenv` e2e test fails: `init` resolves the default `~/.todo-engine/...` home instead of the `.env`-supplied `TODO_ENGINE_HOME` temp path. | Pre-existing failure (already noted deferred in STATE.md under Plan 04.1-02 and Phase 4 Plan 03). Unrelated to this test-only plan (period-view fixtures + depth-cap re-export). CLI dotenv/home-resolution is out of scope for the period-view code-review-findings phase. |

---
phase: 03
slug: date-view
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust built-in `#[test]` (no external harness); three test binaries `unit` / `integration` / `e2e` |
| **Config file** | None — modules declared via `tests/unit.rs` / `tests/integration.rs` with `#[path = "..."] mod` lines |
| **Quick run command** | `cargo test --test unit date_view` |
| **Full suite command** | `cargo test` |
| **Lint/format gates** | `cargo clippy --all-targets --all-features -- -D warnings` · `cargo fmt --check` |
| **Estimated runtime** | ~10–20 seconds (built-in, no I/O for unit; SQLite tempfile for integration) |

---

## Sampling Rate

- **After every task commit:** Run `cargo test --test unit date_view`
- **After every plan wave:** Run `cargo test` + `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --check`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

> Task IDs are `TBD` until plans are created (`/gsd-plan-phase 3` planner pass). Rows are keyed by Success Criterion / requirement and will be bound to concrete task IDs during planning.

| SC / Req | Behavior (oracle) | Test Type | Automated Command | File Exists | Status |
|----------|-------------------|-----------|-------------------|-------------|--------|
| SC1 / VIEW-02 | Range `[from,to]` groups by `scheduled`; deterministic order (scheduled asc → created_at → id) | unit | `cargo test --test unit date_view::range_orders` | ❌ W0 | ⬜ pending |
| SC2 / VIEW-02 | Unscheduled (`None`, `"today"`, junk) present in returned Vec, sorted last — never dropped | unit | `cargo test --test unit date_view::unscheduled_never_dropped` | ❌ W0 | ⬜ pending |
| SC3 / VIEW-05 | Single-date agenda = `scheduled==D` ∪ `due==D`, id-deduped (one row even if both match) | unit | `cargo test --test unit date_view::agenda_union_dedup` | ❌ W0 | ⬜ pending |
| SC4 / CORE-03 | Identical result over InMemory vs persistent SQLite; event log unchanged after `agenda` (no materialization) | integration | `cargo test --test integration date_view` | ❌ W0 | ⬜ pending |
| D-05 | `Completed`/`Waiting`/`Paused`/`Someday` excluded; `Proposed`/`Approved`/`Active` included | unit | `cargo test --test unit date_view::open_only` | ❌ W0 | ⬜ pending |
| D-06 | Task scheduled in the past does NOT appear in today's agenda (no overdue roll) | unit | `cargo test --test unit date_view::no_overdue_roll` | ❌ W0 | ⬜ pending |
| D-08 | Same-day tasks tie-break by `created_at` then `id` | unit | covered by `range_orders` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Key oracles / assertions

- **Union + dedup (SC3):** a task with `scheduled == D AND due == D` appears exactly once — `agenda.iter().filter(|i| i.id == x).count() == 1`.
- **Unscheduled never dropped (SC2):** create N open tasks, M with non-ISO/`None` `scheduled`; assert returned Vec includes all M, occupying the tail of the order.
- **Side-effect-free (SC4):** capture `service.events().len()` before and after `agenda(...)`/`date_range(...)`; assert unchanged (proves no materialization audit write).
- **Store parity (SC4):** run the same fixture through `TodoService::in_memory()` and a persistent SQLite service; assert ordering invariants hold across both (compare by stable key — in-memory uses seeded ids, persistent uses UUIDs).
- **No overdue roll (D-06):** task scheduled `2026-06-20`, agenda `2026-06-23` → task absent.

---

## Wave 0 Requirements

- [ ] `tests/unit/date_view.rs` — covers SC1, SC2, SC3, D-05, D-06, D-08 (in-memory, fast)
- [ ] register in `tests/unit.rs`: `#[path = "unit/date_view.rs"] mod date_view;`
- [ ] `tests/integration/date_view.rs` — covers SC4 parity + side-effect-free (persistent SQLite, mirror `goal_view.rs::persistent_service`)
- [ ] register in `tests/integration.rs`: `#[path = "integration/date_view.rs"] mod date_view;`
- [ ] No framework install needed — built-in `#[test]`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification (pure service-layer logic, no UI/CLI surface this phase).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`date_view.rs` unit + integration modules)
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use time::Date;
use time::format_description::parse as parse_format_description;

use super::goal::MAX_GOAL_DEPTH;
use super::{ServiceStore, TodoService, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ListFilter, apply_list_filter};
use crate::domain::{
    Horizon, ItemType, OPEN_STATUSES, TodoItem, normalize_to_period_start, terminal_status,
};

/// D-01: the single shared, serde-serializable nested period-view tree. The same
/// type and the same `assemble` walk are fed by BOTH the InMemory loader (this
/// plan) and the Persistent CTE loader (Plan 02), so the stores diverge only in
/// how they produce the flat working set — never in the tree shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeriodView {
    /// Lowercase horizon string (`"year"`/`"month"`/`"week"`).
    pub horizon: String,
    /// Canonical period-start anchor (`YYYY-MM-DD`) the roots match on.
    pub period_key: String,
    /// Root goals = goals whose `(horizon, scheduled)` equals `(horizon, period_key)`.
    pub roots: Vec<GoalNode>,
    /// Count of cycle/orphan/over-depth anomalies severed during the walk (SC3).
    pub anomaly_count: usize,
}

/// D-01/D-01a: a goal plus its decomposed children. `child_goals` and `tasks` are
/// SEPARATE vecs so an adapter can render goals and inline tasks distinctly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalNode {
    pub goal: TodoItem,
    pub child_goals: Vec<GoalNode>,
    pub tasks: Vec<TodoItem>,
}

impl TodoService {
    pub fn get(&mut self, item_id: &str) -> TodoResult<TodoItem> {
        match &mut self.store {
            ServiceStore::InMemory(items) => items
                .get(item_id)
                .cloned()
                .ok_or_else(|| TodoError::NotFound(item_id.to_string())),
            ServiceStore::Persistent(store) => store
                .get_item(item_id)?
                .ok_or_else(|| TodoError::NotFound(item_id.to_string())),
        }
    }

    pub fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
        match &mut self.store {
            ServiceStore::InMemory(items) => {
                let mut items = items.values().cloned().collect::<Vec<_>>();
                items.sort_by(|left, right| {
                    left.created_at
                        .cmp(&right.created_at)
                        .then_with(|| left.id.cmp(&right.id))
                });
                Ok(apply_list_filter(items, filter))
            }
            ServiceStore::Persistent(store) => store.list_items(filter),
        }
    }

    pub fn archive_items(&mut self) -> TodoResult<Vec<TodoItem>> {
        Ok(self
            .list_items(ListFilter {
                include_archived: true,
                ..Default::default()
            })?
            .into_iter()
            .filter(|item| terminal_status(item.status))
            .collect())
    }

    /// Single-date agenda (VIEW-05 / SC3, D-02): open tasks where
    /// `scheduled == date OR due == date`. A single date naturally dedups by id
    /// (each item is retained at most once). Due-included rows are NOT tagged
    /// (D-04) — the adapter discriminates via the `scheduled`/`due` fields.
    /// A junk `date` propagates `TodoError::Validation` from `parse_day`.
    pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>> {
        let day = parse_day(date)?;
        let mut items = self.open_tasks()?;
        items.retain(|item| {
            iso_day(item.scheduled.as_deref()) == Some(day)
                || iso_day(item.due.as_deref()) == Some(day)
        });
        sort_date_view(&mut items);
        Ok(items)
    }

    /// Arbitrary `[from, to]` range (VIEW-02 / SC1, D-03): open tasks whose
    /// `scheduled` falls within the inclusive bounds, scheduled-ONLY (no
    /// due-spanning — that is single-date agenda only). `time::Date` is `Ord`, so
    /// the bounds compare directly; non-ISO/None `scheduled` is excluded from the
    /// range match. Junk `from`/`to` propagate `TodoError::Validation`.
    pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>> {
        let (from, to) = (parse_day(from)?, parse_day(to)?);
        let mut items = self.open_tasks()?;
        items.retain(|item| {
            iso_day(item.scheduled.as_deref()).is_some_and(|day| from <= day && day <= to)
        });
        sort_date_view(&mut items);
        Ok(items)
    }

    /// Open (`Active`) tasks only, the shared base for the
    /// date-view methods. Composes `list_items` so InMemory and Persistent stores
    /// agree (SC4 parity); the open-only narrowing is the D-05 allowlist.
    fn open_tasks(&mut self) -> TodoResult<Vec<TodoItem>> {
        Ok(self
            .list_items(ListFilter {
                item_type: Some(ItemType::Task),
                ..Default::default()
            })?
            .into_iter()
            .filter(|item| OPEN_STATUSES.contains(&item.status))
            .collect())
    }

    /// Period-view rollup (VIEW-03/VIEW-04 / SC1/SC2/SC3): given a `horizon` and
    /// ANY in-period date string, return the root goal(s) anchored to that period
    /// plus their full descendant goal+task subtree as a nested [`PeriodView`].
    ///
    /// Signature decision (RESEARCH A2/Pitfall 2): the caller passes any date
    /// inside the period; this method normalizes it to the canonical period start
    /// via [`normalize_to_period_start`] before matching roots, so callers never
    /// hand-roll month/week math. A junk `period` propagates
    /// `TodoError::Validation` from `parse_day`.
    ///
    /// Side-effect-free (mirrors `agenda`/`date_range`): NO `save_*`, no event, no
    /// materialization. The traversal loads the working set ONCE and walks it in
    /// memory; a cyclic/orphaned `parent_id` terminates via the visited set +
    /// `MAX_GOAL_DEPTH` cap and bumps `anomaly_count` rather than erroring (SC3).
    pub fn period_view(&mut self, horizon: Horizon, period: &str) -> TodoResult<PeriodView> {
        let day = parse_day(period)?;
        let period_start = normalize_to_period_start(day, horizon);
        let period_key = format_iso_day(period_start)?;

        let working_set = match &mut self.store {
            ServiceStore::InMemory(_) => {
                self.load_period_subtree_in_memory(horizon, &period_key)?
            }
            // D-10/D-11: the Persistent store pushes the working-set load down to
            // the indexed recursive-CTE loader (Task 1). It produces the SAME
            // flat working set as the InMemory loader (goals at any status,
            // tasks open-only), so the shared `assemble()` below yields identical
            // tree shape across stores (parity proven in Plan 03).
            ServiceStore::Persistent(store) => {
                store.load_period_subtree(horizon.as_str(), &period_key)?
            }
        };

        let (roots, anomaly_count) = assemble(working_set, horizon, &period_key);

        Ok(PeriodView {
            horizon: horizon.as_str().to_string(),
            period_key,
            roots,
            anomaly_count,
        })
    }

    /// D-11 (InMemory half): build the flat working set for `period_view` over the
    /// in-memory store by composing the existing `list_items` read primitive.
    ///
    /// Seed = goals matching `(horizon, period_key)` exactly. Then walk `parent_id`
    /// downward: collect every goal/task whose `parent_id` is already in the
    /// frontier, deduping by id, until the frontier stops growing — so a descendant
    /// goal anchored to a DIFFERENT period (e.g. a finer week under a month root)
    /// still joins the set via its parent link (D-03).
    ///
    /// D-07 status policy (stated in SUMMARY, applied IDENTICALLY in the Plan 02
    /// CTE): GOALS are kept regardless of terminal status and traversed THROUGH
    /// (ADR-0006: a live child can outlive a terminal parent); TASKS are narrowed
    /// to `OPEN_STATUSES`. The goal predicate must NOT lean on `list_items`
    /// hidden-by-default (that would silently drop terminal goals and diverge from
    /// the CTE), so goals are loaded with `include_archived: true` and kept as-is.
    fn load_period_subtree_in_memory(
        &mut self,
        horizon: Horizon,
        period_key: &str,
    ) -> TodoResult<Vec<TodoItem>> {
        // Load ALL goals (terminal kept, per D-07) and ALL open tasks ONCE.
        let all_goals = self.list_items(ListFilter {
            item_type: Some(ItemType::Goal),
            include_archived: true,
            ..Default::default()
        })?;
        let open_tasks = self.open_tasks()?;

        // Seed frontier = goals anchored exactly to (horizon, period_key).
        let mut frontier: HashSet<String> = all_goals
            .iter()
            .filter(|goal| {
                goal.horizon.as_deref() == Some(horizon.as_str())
                    && goal.scheduled.as_deref() == Some(period_key)
            })
            .map(|goal| goal.id.clone())
            .collect();

        // Iteratively pull in any goal whose parent is already in the frontier.
        loop {
            let mut added = false;
            for goal in &all_goals {
                if frontier.contains(&goal.id) {
                    continue;
                }
                if goal
                    .parent_id
                    .as_deref()
                    .is_some_and(|parent_id| frontier.contains(parent_id))
                {
                    frontier.insert(goal.id.clone());
                    added = true;
                }
            }
            if !added {
                break;
            }
        }

        // Working set = every in-frontier goal + every open task whose parent is
        // an in-frontier goal. `assemble` re-indexes by parent_id from here.
        let mut working_set: Vec<TodoItem> = all_goals
            .into_iter()
            .filter(|goal| frontier.contains(&goal.id))
            .collect();
        working_set.extend(open_tasks.into_iter().filter(|task| {
            task.parent_id
                .as_deref()
                .is_some_and(|parent_id| frontier.contains(parent_id))
        }));
        Ok(working_set)
    }
}

/// Parse the ISO day out of a `scheduled`/`due` value. The leading-10-char window
/// matches both bare `"2026-06-23"` and timestamped `"2026-06-23T.."` values;
/// `None`, the legacy `"today"` sentinel, and junk all collapse to `None`
/// (D-07 — unscheduled, never an error here). Discarding the parse error is
/// intentional: a non-ISO date is an unscheduled signal, not a caller error.
fn iso_day(value: Option<&str>) -> Option<Date> {
    parse_day(value?.get(..10)?).ok()
}

/// D-08 deterministic order: `iso_day(scheduled)` ascending with `None`
/// (unscheduled) LAST, then `created_at`, then `id`. Single source for both
/// `sort_date_view` and `sort_child_goals` (D-05/IN-02 — no duplicated closure).
fn schedule_then_created_order(left: &TodoItem, right: &TodoItem) -> std::cmp::Ordering {
    let ka = iso_day(left.scheduled.as_deref());
    let kb = iso_day(right.scheduled.as_deref());
    ka.is_none()
        .cmp(&kb.is_none())
        .then_with(|| ka.cmp(&kb))
        .then_with(|| left.created_at.cmp(&right.created_at))
        .then_with(|| left.id.cmp(&right.id))
}

/// D-08 deterministic order: primary key is `iso_day(scheduled)` ascending with
/// `None` (unscheduled) LAST, then the existing `created_at -> id` tie-break
/// reused from `list_items`. No priority/alpha sort, no new semantics.
fn sort_date_view(items: &mut [TodoItem]) {
    items.sort_by(schedule_then_created_order);
}

/// Format a `Date` back to the engine's canonical `YYYY-MM-DD` anchor string (the
/// inverse of `parse_day`). Goal anchors are always stored canonical, so an exact
/// string match against this is the correct root predicate.
fn format_iso_day(date: Date) -> TodoResult<String> {
    let format = parse_format_description("[year]-[month]-[day]").map_err(|error| {
        TodoError::Internal(format!("failed to prepare date formatter: {error}"))
    })?;
    date.format(&format)
        .map_err(|error| TodoError::Internal(format!("failed to format period key: {error}")))
}

/// Store-agnostic tree builder shared by BOTH stores (D-01). Partitions the flat
/// working set into goals vs tasks, indexes them by `parent_id`, then descends
/// from the period roots building [`GoalNode`]s.
///
/// Roots (D-02) = every goal whose `(horizon, scheduled)` equals
/// `(horizon, period_key)` — NOT just `parent_id IS NULL` (sibling roots are all
/// roots). Descent follows `parent_id` regardless of a descendant's own period
/// (D-03). A `visited` set + `MAX_GOAL_DEPTH` depth cap make the walk finite over
/// cyclic/orphaned legacy data: on re-visit (cycle) or `depth > MAX_GOAL_DEPTH`
/// the branch is severed and `anomaly_count` bumped — NEVER an `Err` (D-09/SC3).
fn assemble(
    working_set: Vec<TodoItem>,
    horizon: Horizon,
    period_key: &str,
) -> (Vec<GoalNode>, usize) {
    let mut goals_by_parent: HashMap<Option<String>, Vec<TodoItem>> = HashMap::new();
    let mut tasks_by_parent: HashMap<String, Vec<TodoItem>> = HashMap::new();
    let mut root_ids: HashSet<String> = HashSet::new();

    for item in working_set {
        if item.item_type == ItemType::Goal {
            if item.horizon.as_deref() == Some(horizon.as_str())
                && item.scheduled.as_deref() == Some(period_key)
            {
                root_ids.insert(item.id.clone());
            }
            goals_by_parent
                .entry(item.parent_id.clone())
                .or_default()
                .push(item);
        } else if let Some(parent_id) = item.parent_id.clone() {
            tasks_by_parent.entry(parent_id).or_default().push(item);
        }
    }

    // Root goals carry parent_id = None for the canonical decomposition, but D-02
    // makes EVERY exact (horizon, period_key) match a root even if it has a parent
    // outside this view. Re-collect the actual root TodoItems by id, ordered by the
    // child-goal tie-break for determinism.
    let mut roots: Vec<TodoItem> = goals_by_parent
        .values()
        .flatten()
        .filter(|goal| root_ids.contains(&goal.id))
        .cloned()
        .collect();
    sort_child_goals(&mut roots);

    let mut anomaly_count = 0usize;
    let mut visited: HashSet<String> = HashSet::new();
    // Mark every root visited up front so a root that also happens to be a child
    // of another root is not nested twice (it stays a top-level sibling, D-02).
    for goal in &roots {
        visited.insert(goal.id.clone());
    }
    let nodes = roots
        .into_iter()
        .map(|goal| {
            build_node(
                goal,
                &goals_by_parent,
                &tasks_by_parent,
                &root_ids,
                &mut visited,
                1,
                &mut anomaly_count,
            )
        })
        .collect();
    (nodes, anomaly_count)
}

/// Recursively build a [`GoalNode`]: gather this goal's open tasks (D-04/D-05,
/// sorted with unscheduled last) and descend into its child goals (D-06, sorted
/// scheduled-asc then created_at/id). Mirrors goal.rs's visited+depth idiom but
/// DESCENDS and NEVER errors — a cycle/over-depth branch is severed and counted.
fn build_node(
    goal: TodoItem,
    goals_by_parent: &HashMap<Option<String>, Vec<TodoItem>>,
    tasks_by_parent: &HashMap<String, Vec<TodoItem>>,
    root_ids: &HashSet<String>,
    visited: &mut HashSet<String>,
    depth: usize,
    anomaly_count: &mut usize,
) -> GoalNode {
    // Inline tasks under this goal, sorted (unscheduled last via sort_date_view).
    let mut tasks = tasks_by_parent.get(&goal.id).cloned().unwrap_or_default();
    sort_date_view(&mut tasks);

    // Child goals, ordered then descended with the cycle/depth guard.
    let mut children = goals_by_parent
        .get(&Some(goal.id.clone()))
        .cloned()
        .unwrap_or_default();
    sort_child_goals(&mut children);

    let mut child_goals = Vec::new();
    for child in children {
        if root_ids.contains(&child.id) {
            // Already emitted as a top-level sibling root (D-02) — NOT an anomaly.
            // This check MUST precede `visited.insert` so a genuine non-root
            // cycle/over-depth re-visit still bumps `anomaly_count` below.
            continue;
        }
        if depth + 1 > MAX_GOAL_DEPTH || !visited.insert(child.id.clone()) {
            // Over-depth or cycle (re-visit): sever this branch, count it, never Err.
            *anomaly_count += 1;
            continue;
        }
        child_goals.push(build_node(
            child,
            goals_by_parent,
            tasks_by_parent,
            root_ids,
            visited,
            depth + 1,
            anomaly_count,
        ));
    }

    GoalNode {
        goal,
        child_goals,
        tasks,
    }
}

/// D-06 child-goal order: `iso_day(scheduled)` ascending (unscheduled last), then
/// the existing `created_at -> id` tie-break. Delegates to the single shared
/// `schedule_then_created_order` comparator (D-05/IN-02).
fn sort_child_goals(goals: &mut [TodoItem]) {
    goals.sort_by(schedule_then_created_order);
}

use std::collections::HashSet;

use super::{TodoService, parse_day};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::ListFilter;
use crate::domain::{Horizon, ItemType, is_period_start};

/// Maximum depth of the goal ancestor chain walked during nesting validation.
/// Bounds the traversal so a cyclic/legacy `parent_id` chain cannot drive an
/// unbounded loop (DoS guard, T-02-05).
pub(super) const MAX_GOAL_DEPTH: usize = 64;

impl TodoService {
    /// Validate and canonicalize a goal's period anchor.
    ///
    /// Strict-rejects an empty anchor, the `"today"` sentinel (a goal must be an
    /// explicit ISO date — unlike a task, GOAL-03/SC2), an unparseable date, and
    /// a date that is not the canonical period start for `horizon`. NEVER
    /// auto-snaps via `normalize_to_period_start` (Phase 1 lock). On success
    /// returns the trimmed canonical string.
    pub(super) fn validate_goal_anchor(
        &self,
        horizon: Horizon,
        scheduled: &str,
    ) -> TodoResult<String> {
        let trimmed = scheduled.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("today") {
            return Err(TodoError::Validation(
                "Goal anchor must be an explicit ISO date (YYYY-MM-DD), not empty or \"today\""
                    .to_string(),
            ));
        }
        let date = parse_day(trimmed)?;
        if !is_period_start(date, horizon) {
            return Err(TodoError::Validation(format!(
                "Goal anchor {trimmed} is not the canonical start of its {} period",
                horizon.as_str()
            )));
        }
        Ok(trimmed.to_string())
    }

    /// Validate a goal's parent relationship.
    ///
    /// A `None` parent (top-level goal) is always valid. Otherwise the parent
    /// must exist, be a `Goal`, carry a parseable horizon, and that horizon must
    /// be *strictly* coarser than the child's (equality is rejected — GOAL-04).
    /// Walks the ancestor chain with a visited set + depth cap to reject cycles
    /// and over-deep chains (T-02-05).
    pub(super) fn validate_goal_nesting(
        &mut self,
        parent_id: Option<&str>,
        child_horizon: Horizon,
    ) -> TodoResult<()> {
        let Some(parent_id) = parent_id else {
            return Ok(());
        };

        let parent = self.get(parent_id)?;
        if parent.item_type != ItemType::Goal {
            return Err(TodoError::Policy(format!(
                "Goal parent must be a goal: {parent_id}"
            )));
        }
        let parent_horizon = parent
            .horizon
            .as_deref()
            .ok_or_else(|| TodoError::Policy("Goal parent missing horizon".to_string()))?
            .parse::<Horizon>()
            .map_err(TodoError::Validation)?;
        if !parent_horizon.is_coarser_than(child_horizon) {
            return Err(TodoError::Policy(format!(
                "Goal parent horizon ({}) must be strictly coarser than child horizon ({})",
                parent_horizon.as_str(),
                child_horizon.as_str()
            )));
        }

        // Defensive ancestor walk: guards against legacy/cyclic data. The new
        // goal has no id yet, so a self-cycle is impossible at create time.
        let mut visited: HashSet<String> = HashSet::new();
        let mut depth = 0usize;
        let mut current = Some(parent);
        while let Some(node) = current {
            if !visited.insert(node.id.clone()) {
                return Err(TodoError::Policy(format!(
                    "Goal parent chain forms a cycle at {}",
                    node.id
                )));
            }
            depth += 1;
            if depth > MAX_GOAL_DEPTH {
                return Err(TodoError::Policy(format!(
                    "Goal parent chain exceeds maximum depth of {MAX_GOAL_DEPTH}"
                )));
            }
            current = match node.parent_id {
                Some(ref next_id) => Some(self.get(next_id)?),
                None => None,
            };
        }
        Ok(())
    }

    /// Reject a goal that duplicates an existing goal's
    /// `(horizon, canonical scheduled, parent_id)` identity triple (GOAL-05).
    /// Compares against the already-canonicalized `scheduled` string; top-level
    /// goals share `parent_id = None`.
    pub(super) fn ensure_goal_not_duplicate(
        &mut self,
        horizon: Horizon,
        canonical_scheduled: &str,
        parent_id: Option<&str>,
    ) -> TodoResult<()> {
        let existing = self.list_items(ListFilter {
            item_type: Some(ItemType::Goal),
            ..Default::default()
        })?;
        let duplicate = existing.into_iter().any(|item| {
            item.horizon.as_deref() == Some(horizon.as_str())
                && item.scheduled.as_deref() == Some(canonical_scheduled)
                && item.parent_id.as_deref() == parent_id
        });
        if duplicate {
            return Err(TodoError::Policy(format!(
                "Goal already exists for ({}, {}, {})",
                horizon.as_str(),
                canonical_scheduled,
                parent_id.unwrap_or("<root>")
            )));
        }
        Ok(())
    }
}

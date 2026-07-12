use serde_json::{Map, Value};
use thiserror::Error;

use crate::domain::Horizon;

pub type TodoResult<T> = Result<T, TodoError>;

#[derive(Debug, Error, PartialEq)]
pub enum TodoError {
    #[error(
        "Goal anchor {scheduled} is not the canonical start of its {} period",
        horizon.as_str()
    )]
    GoalInvalidAnchor { horizon: Horizon, scheduled: String },
    #[error(
        "Goal parent horizon ({}) must be strictly coarser than child horizon ({})",
        parent_horizon.as_str(),
        child_horizon.as_str()
    )]
    GoalParentHorizonNotCoarser {
        parent_horizon: Horizon,
        child_horizon: Horizon,
    },
    #[error(
        "Goal already exists for ({}, {}, {})",
        horizon.as_str(),
        scheduled,
        parent_id.as_deref().unwrap_or("<root>")
    )]
    GoalDuplicatePeriod {
        horizon: Horizon,
        scheduled: String,
        parent_id: Option<String>,
    },
    #[error("{0}")]
    Policy(String),
    #[error("Item not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl TodoError {
    pub fn api_code(&self) -> &'static str {
        match self {
            TodoError::GoalInvalidAnchor { .. } => "goal_invalid_anchor",
            TodoError::GoalParentHorizonNotCoarser { .. } => "goal_parent_horizon_not_coarser",
            TodoError::GoalDuplicatePeriod { .. } => "goal_duplicate_period",
            TodoError::Policy(_) => "policy_error",
            TodoError::Validation(_) => "validation_error",
            TodoError::NotFound(_) => "not_found",
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => {
                "internal_error"
            }
        }
    }

    pub fn cli_exit_code(&self) -> i32 {
        match self {
            TodoError::GoalInvalidAnchor { .. }
            | TodoError::GoalParentHorizonNotCoarser { .. }
            | TodoError::GoalDuplicatePeriod { .. }
            | TodoError::Policy(_)
            | TodoError::Validation(_) => 2,
            TodoError::NotFound(_) => 4,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => 1,
        }
    }

    pub fn http_status_code(&self) -> u16 {
        match self {
            TodoError::GoalInvalidAnchor { .. }
            | TodoError::GoalParentHorizonNotCoarser { .. }
            | TodoError::GoalDuplicatePeriod { .. }
            | TodoError::Policy(_)
            | TodoError::Validation(_) => 400,
            TodoError::NotFound(_) => 404,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => 500,
        }
    }

    pub fn api_metadata(&self) -> Map<String, Value> {
        let mut metadata = Map::new();

        match self {
            TodoError::GoalInvalidAnchor { horizon, scheduled } => {
                metadata.insert(
                    "horizon".to_string(),
                    Value::String(horizon.as_str().to_string()),
                );
                metadata.insert("scheduled".to_string(), Value::String(scheduled.clone()));
            }
            TodoError::GoalParentHorizonNotCoarser {
                parent_horizon,
                child_horizon,
            } => {
                metadata.insert(
                    "parent_horizon".to_string(),
                    Value::String(parent_horizon.as_str().to_string()),
                );
                metadata.insert(
                    "child_horizon".to_string(),
                    Value::String(child_horizon.as_str().to_string()),
                );
            }
            TodoError::GoalDuplicatePeriod {
                horizon,
                scheduled,
                parent_id,
            } => {
                metadata.insert(
                    "horizon".to_string(),
                    Value::String(horizon.as_str().to_string()),
                );
                metadata.insert("scheduled".to_string(), Value::String(scheduled.clone()));
                if let Some(parent_id) = parent_id {
                    metadata.insert("parent_id".to_string(), Value::String(parent_id.clone()));
                }
            }
            TodoError::Policy(_)
            | TodoError::NotFound(_)
            | TodoError::Validation(_)
            | TodoError::Storage(_)
            | TodoError::Migration(_)
            | TodoError::Internal(_) => {}
        }

        metadata
    }

    pub fn cli_exit_code_from_error(error: &anyhow::Error) -> Option<i32> {
        error
            .downcast_ref::<TodoError>()
            .map(TodoError::cli_exit_code)
    }
}

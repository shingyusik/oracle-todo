pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod interfaces;

/// Retention purge entry points: `todo_engine::retention::{plan, apply}`.
pub mod retention {
    pub use crate::application::retention::{
        RetentionCandidate, RetentionOutcome, RetentionPlan, RetentionWindow,
    };
    pub use crate::infrastructure::sqlite::retention::{apply, plan};
}

pub use retention::{RetentionCandidate, RetentionOutcome, RetentionPlan, RetentionWindow};

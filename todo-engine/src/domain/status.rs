use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Proposed,
    Approved,
    Active,
    Waiting,
    Paused,
    Completed,
    Cancelled,
    Dropped,
    Archived,
    Someday,
    Rejected,
}

/// Single source of truth for the "open" working-set statuses — the only
/// statuses that surface in date-view and period-view reads. Both the
/// application-ring period-view loader (`queries.rs`) and the infrastructure-ring
/// recursive-CTE loader (`sqlite/repo.rs`) derive their task-status predicate
/// from THIS constant so the InMemory and Persistent stores cannot diverge
/// (D-07 visibility parity). Adding/removing an open status here updates both
/// loaders in lockstep.
pub const OPEN_STATUSES: [ItemStatus; 3] = [
    ItemStatus::Proposed,
    ItemStatus::Approved,
    ItemStatus::Active,
];

pub fn terminal_status(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Completed
            | ItemStatus::Cancelled
            | ItemStatus::Dropped
            | ItemStatus::Archived
            | ItemStatus::Someday
            | ItemStatus::Rejected
    )
}

pub fn hidden_by_default_status(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Archived | ItemStatus::Dropped | ItemStatus::Cancelled
    )
}

impl ItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemStatus::Proposed => "proposed",
            ItemStatus::Approved => "approved",
            ItemStatus::Active => "active",
            ItemStatus::Waiting => "waiting",
            ItemStatus::Paused => "paused",
            ItemStatus::Completed => "completed",
            ItemStatus::Cancelled => "cancelled",
            ItemStatus::Dropped => "dropped",
            ItemStatus::Archived => "archived",
            ItemStatus::Someday => "someday",
            ItemStatus::Rejected => "rejected",
        }
    }
}

impl FromStr for ItemStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "proposed" => Ok(ItemStatus::Proposed),
            "approved" => Ok(ItemStatus::Approved),
            "active" => Ok(ItemStatus::Active),
            "waiting" => Ok(ItemStatus::Waiting),
            "paused" => Ok(ItemStatus::Paused),
            "completed" => Ok(ItemStatus::Completed),
            "cancelled" => Ok(ItemStatus::Cancelled),
            "dropped" => Ok(ItemStatus::Dropped),
            "archived" => Ok(ItemStatus::Archived),
            "someday" => Ok(ItemStatus::Someday),
            "rejected" => Ok(ItemStatus::Rejected),
            _ => Err(format!("unknown status: {value}")),
        }
    }
}

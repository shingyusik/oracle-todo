use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Active,
    Waiting,
    Paused,
    Completed,
    Cancelled,
    Dropped,
    Archived,
    Missed,
    Rejected,
}

pub fn terminal_status(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Completed
            | ItemStatus::Cancelled
            | ItemStatus::Dropped
            | ItemStatus::Archived
            | ItemStatus::Missed
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
            ItemStatus::Active => "active",
            ItemStatus::Waiting => "waiting",
            ItemStatus::Paused => "paused",
            ItemStatus::Completed => "completed",
            ItemStatus::Cancelled => "cancelled",
            ItemStatus::Dropped => "dropped",
            ItemStatus::Archived => "archived",
            ItemStatus::Missed => "missed",
            ItemStatus::Rejected => "rejected",
        }
    }
}

impl FromStr for ItemStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "active" => Ok(ItemStatus::Active),
            "waiting" => Ok(ItemStatus::Waiting),
            "paused" => Ok(ItemStatus::Paused),
            "completed" => Ok(ItemStatus::Completed),
            "cancelled" => Ok(ItemStatus::Cancelled),
            "dropped" => Ok(ItemStatus::Dropped),
            "archived" => Ok(ItemStatus::Archived),
            "missed" => Ok(ItemStatus::Missed),
            "rejected" => Ok(ItemStatus::Rejected),
            _ => Err(format!("unknown status: {value}")),
        }
    }
}

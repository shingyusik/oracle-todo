use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::str::FromStr;
use time::OffsetDateTime;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Area,
    Project,
    Routine,
    Task,
    Event,
    Review,
    ArchiveItem,
}

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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Actor {
    User,
    Oracle,
    System,
}

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub title: String,
    pub status: ItemStatus,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: String,
    pub occurrence_key: Option<String>,
    pub priority: Option<i64>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub horizon: Option<String>,
    pub proposed_by: Actor,
    pub approved_by: Option<Actor>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub approved_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub completed_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_materialized_at: Option<OffsetDateTime>,
    pub second_brain_refs: Vec<Value>,
    #[serde(rename = "metadata_")]
    pub metadata: Map<String, Value>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TodoEvent {
    pub id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub actor: Actor,
    pub action: String,
    pub object_type: String,
    pub object_id: String,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub reason: Option<String>,
}

impl TodoItem {
    pub fn new_task(
        id: impl Into<String>,
        title: impl Into<String>,
        actor: Actor,
        now: OffsetDateTime,
    ) -> Self {
        Self::new(id, ItemType::Task, title, actor, now)
    }

    pub fn new(
        id: impl Into<String>,
        item_type: ItemType,
        title: impl Into<String>,
        actor: Actor,
        now: OffsetDateTime,
    ) -> Self {
        let approved = actor == Actor::User;

        Self {
            id: id.into(),
            item_type,
            title: title.into(),
            status: if approved {
                ItemStatus::Approved
            } else {
                ItemStatus::Proposed
            },
            area_id: None,
            project_id: None,
            routine_id: None,
            parent_id: None,
            description: None,
            outcome: None,
            definition_of_done: None,
            standard: None,
            review_cycle: None,
            recurrence_rule: None,
            materialization_policy: "single_open".to_string(),
            occurrence_key: None,
            priority: None,
            due: None,
            scheduled: None,
            horizon: None,
            proposed_by: actor,
            approved_by: approved.then_some(Actor::User),
            approved_at: approved.then_some(now),
            completed_at: None,
            archived_at: None,
            last_materialized_at: None,
            second_brain_refs: Vec::new(),
            metadata: Map::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

impl ItemType {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemType::Area => "area",
            ItemType::Project => "project",
            ItemType::Routine => "routine",
            ItemType::Task => "task",
            ItemType::Event => "event",
            ItemType::Review => "review",
            ItemType::ArchiveItem => "archive_item",
        }
    }
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

impl Actor {
    pub fn as_str(self) -> &'static str {
        match self {
            Actor::User => "user",
            Actor::Oracle => "oracle",
            Actor::System => "system",
        }
    }
}

impl FromStr for Actor {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "user" => Ok(Actor::User),
            "oracle" => Ok(Actor::Oracle),
            "system" => Ok(Actor::System),
            _ => Err(format!("unknown actor: {value}")),
        }
    }
}

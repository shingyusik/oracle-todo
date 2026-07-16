use super::status::ItemStatus;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::str::FromStr;
use time::OffsetDateTime;

pub const DEFAULT_FUTURE_OCCURRENCES: i64 = 7;
pub const MAX_FUTURE_OCCURRENCES: i64 = 365;

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
    Goal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Actor {
    User,
    Agent,
    System,
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
    pub note: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: String,
    pub future_occurrences: i64,
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
    pub tags: Vec<String>,
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
        Self {
            id: id.into(),
            item_type,
            title: title.into(),
            status: ItemStatus::Active,
            area_id: None,
            project_id: None,
            routine_id: None,
            parent_id: None,
            description: None,
            note: None,
            outcome: None,
            definition_of_done: None,
            standard: None,
            review_cycle: None,
            recurrence_rule: None,
            materialization_policy: "single_open".to_string(),
            future_occurrences: DEFAULT_FUTURE_OCCURRENCES,
            occurrence_key: None,
            priority: None,
            due: None,
            scheduled: None,
            horizon: None,
            proposed_by: actor,
            approved_by: None,
            approved_at: None,
            completed_at: None,
            archived_at: None,
            last_materialized_at: None,
            second_brain_refs: Vec::new(),
            tags: Vec::new(),
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
            ItemType::Goal => "goal",
        }
    }
}

impl FromStr for ItemType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "area" => Ok(ItemType::Area),
            "project" => Ok(ItemType::Project),
            "routine" => Ok(ItemType::Routine),
            "task" => Ok(ItemType::Task),
            "event" => Ok(ItemType::Event),
            "review" => Ok(ItemType::Review),
            "archive_item" => Ok(ItemType::ArchiveItem),
            "goal" => Ok(ItemType::Goal),
            _ => Err(format!("unknown item type: {value}")),
        }
    }
}

impl Actor {
    pub fn as_str(self) -> &'static str {
        match self {
            Actor::User => "user",
            Actor::Agent => "agent",
            Actor::System => "system",
        }
    }
}

impl FromStr for Actor {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "user" => Ok(Actor::User),
            "agent" => Ok(Actor::Agent),
            "system" => Ok(Actor::System),
            _ => Err(format!("unknown actor: {value}")),
        }
    }
}

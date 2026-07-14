use super::TodoService;
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, Horizon, ItemStatus, ItemType, TodoItem};

#[derive(Default)]
pub struct CreateArea {
    pub title: String,
    pub review_cycle: Option<String>,
    pub standard: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

pub struct ProposeTask {
    pub actor: Actor,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

impl Default for ProposeTask {
    fn default() -> Self {
        Self {
            actor: Actor::Agent,
            area: None,
            project_id: None,
            routine_id: None,
            due: None,
            scheduled: None,
            priority: None,
            description: None,
            note: None,
            tags: Vec::new(),
        }
    }
}

pub struct ProposeProject {
    pub title: String,
    pub area: Option<String>,
    pub definition_of_done: Option<String>,
    pub outcome: Option<String>,
    pub due: Option<String>,
    pub actor: Actor,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

impl Default for ProposeProject {
    fn default() -> Self {
        Self {
            title: String::new(),
            area: None,
            definition_of_done: None,
            outcome: None,
            due: None,
            actor: Actor::Agent,
            note: None,
            tags: Vec::new(),
        }
    }
}

pub struct ProposeGoal {
    pub title: String,
    pub horizon: String,
    pub scheduled: String,
    pub parent_id: Option<String>,
    pub actor: Actor,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

impl Default for ProposeGoal {
    fn default() -> Self {
        Self {
            title: String::new(),
            horizon: String::new(),
            scheduled: String::new(),
            parent_id: None,
            actor: Actor::Agent,
            note: None,
            tags: Vec::new(),
        }
    }
}

pub struct ProposeRoutine {
    pub title: String,
    pub area: Option<String>,
    pub actor: Actor,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

impl Default for ProposeRoutine {
    fn default() -> Self {
        Self {
            title: String::new(),
            area: None,
            actor: Actor::Agent,
            recurrence_rule: None,
            materialization_policy: "single_open".to_string(),
            note: None,
            tags: Vec::new(),
        }
    }
}

pub struct ProposeEvent {
    pub title: String,
    pub actor: Actor,
    pub scheduled: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub due: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub participants: Vec<String>,
    pub commitment_type: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
}

impl Default for ProposeEvent {
    fn default() -> Self {
        Self {
            title: String::new(),
            actor: Actor::Agent,
            scheduled: None,
            area: None,
            project_id: None,
            due: None,
            priority: None,
            description: None,
            location: None,
            participants: Vec::new(),
            commitment_type: "appointment".to_string(),
            note: None,
            tags: Vec::new(),
        }
    }
}

impl TodoService {
    pub fn create_area(&mut self, request: CreateArea) -> TodoResult<TodoItem> {
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("area"),
            ItemType::Area,
            request.title,
            Actor::User,
            now,
        );
        item.status = ItemStatus::Active;
        item.review_cycle = request.review_cycle;
        item.standard = request.standard;
        item.note = request.note;
        item.tags = super::normalize_tags(request.tags);
        self.store_item_and_event(Actor::User, "create_area", None, item, None)
    }

    pub fn propose_task(
        &mut self,
        title: impl Into<String>,
        request: ProposeTask,
    ) -> TodoResult<TodoItem> {
        let area_id = self.find_area(request.area)?;
        let project_id = self.ensure_relation(request.project_id, ItemType::Project, "Project")?;
        let routine_id = self.ensure_relation(request.routine_id, ItemType::Routine, "Routine")?;
        let now = self.next_now();
        let mut item = TodoItem::new_task(self.next_id("task"), title, request.actor, now);
        item.area_id = area_id;
        item.project_id = project_id;
        item.routine_id = routine_id;
        item.due = request.due;
        item.scheduled = request.scheduled;
        item.priority = request.priority;
        item.description = request.description;
        item.note = request.note;
        item.tags = super::normalize_tags(request.tags);
        self.store_item_and_event(item.proposed_by, "propose_task", None, item, None)
    }

    pub fn propose_project(&mut self, request: ProposeProject) -> TodoResult<TodoItem> {
        let area_id = self.find_area(request.area)?;
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("project"),
            ItemType::Project,
            request.title,
            request.actor,
            now,
        );
        item.area_id = area_id;
        item.definition_of_done = request.definition_of_done;
        item.outcome = request.outcome;
        item.due = request.due;
        item.note = request.note;
        item.tags = super::normalize_tags(request.tags);
        self.store_item_and_event(item.proposed_by, "propose_project", None, item, None)
    }

    pub fn propose_goal(&mut self, request: ProposeGoal) -> TodoResult<TodoItem> {
        let horizon = request
            .horizon
            .parse::<Horizon>()
            .map_err(TodoError::Validation)?;
        let canonical = self.validate_goal_anchor(horizon, &request.scheduled)?;
        self.validate_goal_nesting(request.parent_id.as_deref(), horizon)?;

        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("goal"),
            ItemType::Goal,
            request.title,
            request.actor,
            now,
        );
        item.horizon = Some(horizon.as_str().to_string());
        item.scheduled = Some(canonical);
        item.parent_id = request.parent_id;
        item.note = request.note;
        item.tags = super::normalize_tags(request.tags);
        self.store_item_and_event(item.proposed_by, "propose_goal", None, item, None)
    }

    pub fn propose_routine(&mut self, request: ProposeRoutine) -> TodoResult<TodoItem> {
        if !matches!(
            request.materialization_policy.as_str(),
            "single_open" | "per_occurrence"
        ) {
            return Err(TodoError::Policy(format!(
                "Unsupported materialization_policy: {}",
                request.materialization_policy
            )));
        }
        let area_id = self.find_area(request.area)?;
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("rtn"),
            ItemType::Routine,
            request.title,
            request.actor,
            now,
        );
        item.area_id = area_id;
        item.recurrence_rule = request.recurrence_rule;
        item.materialization_policy = request.materialization_policy;
        item.note = request.note;
        item.tags = super::normalize_tags(request.tags);
        self.store_item_and_event(item.proposed_by, "propose_routine", None, item, None)
    }

    pub fn propose_event(&mut self, request: ProposeEvent) -> TodoResult<TodoItem> {
        let scheduled = request
            .scheduled
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| TodoError::Policy("Event requires scheduled time".to_string()))?;
        let area_id = self.find_area(request.area)?;
        let project_id = self.ensure_relation(request.project_id, ItemType::Project, "Project")?;
        let now = self.next_now();
        let mut item = TodoItem::new(
            self.next_id("evt"),
            ItemType::Event,
            request.title,
            request.actor,
            now,
        );
        item.area_id = area_id;
        item.project_id = project_id;
        item.due = request.due;
        item.scheduled = Some(scheduled);
        item.priority = request.priority;
        item.description = request.description;
        item.note = request.note;
        item.metadata.insert(
            "commitment_type".to_string(),
            serde_json::Value::String(request.commitment_type),
        );
        item.metadata.insert(
            "schedule_kind".to_string(),
            serde_json::Value::String("external_commitment".to_string()),
        );
        item.tags = super::normalize_tags(request.tags);
        if let Some(location) = request.location {
            item.metadata
                .insert("location".to_string(), serde_json::Value::String(location));
        }
        if !request.participants.is_empty() {
            item.metadata.insert(
                "participants".to_string(),
                serde_json::Value::Array(
                    request
                        .participants
                        .into_iter()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        self.store_item_and_event(item.proposed_by, "propose_event", None, item, None)
    }
}

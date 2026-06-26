use serde::Deserialize;

#[derive(Deserialize)]
pub(super) struct AreaBody {
    pub title: String,
    pub review_cycle: Option<String>,
    pub standard: Option<String>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct TaskProposeBody {
    pub title: String,
    pub area: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub actor: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ProjectProposeBody {
    pub title: String,
    pub area: Option<String>,
    pub definition_of_done: Option<String>,
    pub outcome: Option<String>,
    pub due: Option<String>,
    pub note: Option<String>,
    pub actor: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct GoalProposeBody {
    pub title: String,
    pub horizon: String,
    pub scheduled: String,
    pub parent_id: Option<String>,
    pub note: Option<String>,
    pub actor: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct RoutineProposeBody {
    pub title: String,
    pub area: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub note: Option<String>,
    pub actor: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct EventProposeBody {
    pub title: String,
    pub scheduled: String,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub due: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub location: Option<String>,
    pub participants: Option<Vec<String>>,
    pub commitment_type: Option<String>,
    pub actor: Option<String>,
}

#[derive(Deserialize, Default)]
pub(super) struct ReasonBody {
    pub reason: Option<String>,
}

#[derive(Deserialize, Default)]
pub(super) struct UpdateBody {
    pub title: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct AgendaQuery {
    pub date: String,
}

#[derive(Deserialize)]
pub(super) struct DateRangeQuery {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
pub(super) struct PeriodQuery {
    pub horizon: String,
    pub period: String,
}

#[derive(Deserialize)]
pub(super) struct ItemsQuery {
    pub status: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub query: Option<String>,
    pub include_archived: Option<String>,
}

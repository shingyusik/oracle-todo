use serde::Deserialize;

#[derive(Deserialize)]
pub(super) struct PageQuery {
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "default_page_limit")]
    pub limit: u32,
}
fn default_page_limit() -> u32 {
    50
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct AreaBody {
    pub title: String,
    pub review_cycle: Option<String>,
    pub standard: Option<String>,
    pub note: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TaskProposeBody {
    pub title: String,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub note: Option<String>,
    pub actor: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ProjectProposeBody {
    pub title: String,
    pub area: Option<String>,
    pub definition_of_done: Option<String>,
    pub outcome: Option<String>,
    pub due: Option<String>,
    pub note: Option<String>,
    pub actor: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GoalProposeBody {
    pub title: String,
    pub horizon: String,
    pub scheduled: String,
    pub parent_id: Option<String>,
    pub note: Option<String>,
    pub actor: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RoutineProposeBody {
    pub title: String,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub priority: Option<i64>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub future_occurrences: Option<i64>,
    pub note: Option<String>,
    pub actor: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EventProposeBody {
    pub title: String,
    pub scheduled: String,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub due: Option<String>,
    pub priority: Option<i64>,
    pub note: Option<String>,
    pub location: Option<String>,
    pub participants: Option<Vec<String>>,
    pub commitment_type: Option<String>,
    pub actor: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RoutineMaterializeBody {
    pub future_occurrences: Option<i64>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(super) struct ReasonBody {
    pub reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MissBody {
    pub reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PostponeBody {
    pub today: String,
    pub scheduled: String,
    pub reason: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(super) struct UpdateBody {
    pub future_occurrences: Option<i64>,
    pub expected_updated_at: Option<String>,
    pub title: Option<String>,
    pub note: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub horizon: Option<String>,
    #[serde(default, deserialize_with = "nullable_priority")]
    pub priority: Option<Option<i64>>,
    pub tags: Option<Vec<String>>,
    pub location: Option<String>,
    pub participants: Option<Vec<String>>,
    pub commitment_type: Option<String>,
    pub reason: Option<String>,
}

fn nullable_priority<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
pub(super) struct ItemsQuery {
    #[serde(default)]
    pub offset: u32,
    pub limit: Option<u32>,
    pub scope: Option<String>,
    pub today: Option<String>,
    pub routine_id: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub horizon: Option<String>,
    pub scheduled: Option<String>,
    pub query: Option<String>,
    pub include_archived: Option<String>,
}

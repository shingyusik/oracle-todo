use serde::Serialize;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct DashboardResponse {
    pub request_id: Uuid,
    pub todo: DomainProjection<TodoDashboard>,
    pub ledger: DomainProjection<LedgerDashboard>,
    pub health: DomainProjection<HealthDashboard>,
    pub recent_activity: Vec<RecentActivityItem>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DomainProjection<T> {
    Ok {
        data: T,
    },
    Error {
        code: &'static str,
        message: &'static str,
        request_id: Uuid,
    },
}

impl<T> DomainProjection<T> {
    pub fn error(request_id: Uuid) -> Self {
        Self::Error {
            code: "domain_unavailable",
            message: "This data is currently unavailable.",
            request_id,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TodoDashboard {
    pub active: u64,
    pub today_completed: u64,
    pub today_incomplete: u64,
    pub today_missed: u64,
    pub today_total: u64,
    pub overdue: u64,
}

#[derive(Debug, Serialize)]
pub struct LedgerDashboard {
    pub period_start: Date,
    pub period_end: Date,
    pub currencies: Vec<LedgerCurrencyDashboard>,
}

#[derive(Debug, Serialize)]
pub struct LedgerCurrencyDashboard {
    pub currency_code: String,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_change_minor: i64,
}

#[derive(Debug, Serialize)]
pub struct HealthDashboard {
    pub latest_condition: Option<HealthMetricDashboard>,
    pub latest_sleep: Option<HealthMetricDashboard>,
    pub latest_bowel: Option<HealthMetricDashboard>,
    pub latest_medication: Option<HealthMetricDashboard>,
    pub recent_diet_tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct HealthMetricDashboard {
    #[serde(with = "time::serde::rfc3339")]
    pub timestamp: OffsetDateTime,
    pub name: String,
    pub value: f64,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecentActivityItem {
    pub domain: &'static str,
    pub action: &'static str,
    pub record_id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub timestamp: OffsetDateTime,
}

pub fn safe_action(action: &str) -> &'static str {
    match action {
        "archive" => "archive",
        "cancel" => "cancel",
        "cleanup" => "cleanup",
        "complete" => "complete",
        "create" | "create_area" => "create",
        "detach" => "detach",
        "drop" => "drop",
        "materialize_routine_task" => "materialize",
        "miss" => "miss",
        "pause" => "pause",
        "postpone" => "postpone",
        "propose_event" | "propose_goal" | "propose_project" | "propose_routine"
        | "propose_task" => "create",
        "purge" => "purge",
        "reopen" => "reopen",
        "restore" => "restore",
        "resume" => "resume",
        "update" | "update_item" => "update",
        _ => "other",
    }
}

pub fn safe_record_id(value: &str) -> String {
    if value.len() <= 128
        && !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        value.to_owned()
    } else {
        "redacted".to_owned()
    }
}

pub fn sort_and_bound_activity(activity: &mut Vec<RecentActivityItem>, limit: usize) {
    activity.sort_by(|left, right| {
        right
            .timestamp
            .cmp(&left.timestamp)
            .then_with(|| left.domain.cmp(right.domain))
            .then_with(|| left.record_id.cmp(&right.record_id))
            .then_with(|| left.action.cmp(right.action))
    });
    activity.truncate(limit);
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::{RecentActivityItem, sort_and_bound_activity};

    #[test]
    fn activity_has_a_stable_equal_time_order_and_hard_bound() {
        let timestamp = datetime!(2026-07-31 10:00 UTC);
        let mut activity = vec![
            RecentActivityItem {
                domain: "todo",
                action: "update",
                record_id: "b".into(),
                timestamp,
            },
            RecentActivityItem {
                domain: "health",
                action: "create",
                record_id: "c".into(),
                timestamp,
            },
            RecentActivityItem {
                domain: "ledger",
                action: "create",
                record_id: "a".into(),
                timestamp,
            },
        ];
        sort_and_bound_activity(&mut activity, 2);
        assert_eq!(
            activity
                .iter()
                .map(|item| (item.domain, item.record_id.as_str()))
                .collect::<Vec<_>>(),
            [("health", "c"), ("ledger", "a")]
        );
    }
}

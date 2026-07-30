use axum::{Json, Router, routing::get};
use health_engine::domain::HealthCategory;
use health_engine::domain::{DietEntry, HealthEvent};
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use ledger_engine::application::reports::YearMonth;
use ledger_engine::application::service::LedgerService;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use time::{Date, OffsetDateTime, UtcOffset};
use todo_engine::application::error::TodoError;
use todo_engine::application::service::TodoService;
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect_read_only};
use uuid::Uuid;

use crate::RavenApiState;
use crate::dto::dashboard::{
    DashboardResponse, DomainProjection, HealthDashboard, HealthMetricDashboard,
    LedgerCurrencyDashboard, LedgerDashboard, RecentActivityItem, TodoDashboard, safe_action,
    safe_record_id, sort_and_bound_activity,
};

const ACTIVITY_LIMIT: usize = 20;
const HEALTH_DIET_LIMIT: u16 = 8;

struct Projection<T> {
    data: T,
    activity: Vec<RecentActivityItem>,
}

#[derive(Clone, Copy)]
struct DashboardContext {
    local_date: Date,
}

impl DashboardContext {
    fn new(now: OffsetDateTime, local_offset: UtcOffset) -> Self {
        Self {
            local_date: now.to_offset(local_offset).date(),
        }
    }
}

pub fn router() -> Router<RavenApiState> {
    Router::new().route("/", get(dashboard))
}

async fn dashboard(state: axum::extract::State<RavenApiState>) -> Json<DashboardResponse> {
    let request_id = Uuid::new_v4();
    let context = DashboardContext::new(OffsetDateTime::now_utc(), state.local_offset());
    let todo_path = state.todo_db().to_path_buf();
    let ledger_path = state.ledger_db().to_path_buf();
    let health_path = state.health_db().to_path_buf();

    let todo = tokio::task::spawn_blocking(move || todo_projection(&todo_path, context));
    let ledger = tokio::task::spawn_blocking(move || ledger_projection(&ledger_path, context));
    let health = tokio::task::spawn_blocking(move || health_projection(&health_path));
    let (todo, ledger, health) = tokio::join!(todo, ledger, health);

    let mut activity = Vec::with_capacity(ACTIVITY_LIMIT * 3);
    let todo = match todo {
        Ok(Ok(projection)) => {
            activity.extend(projection.activity);
            DomainProjection::Ok {
                data: projection.data,
            }
        }
        Ok(Err(_)) | Err(_) => DomainProjection::error(request_id),
    };
    let ledger = match ledger {
        Ok(Ok(projection)) => {
            activity.extend(projection.activity);
            DomainProjection::Ok {
                data: projection.data,
            }
        }
        Ok(Err(_)) | Err(_) => DomainProjection::error(request_id),
    };
    let health = match health {
        Ok(Ok(projection)) => {
            activity.extend(projection.activity);
            DomainProjection::Ok {
                data: projection.data,
            }
        }
        Ok(Err(_)) | Err(_) => DomainProjection::error(request_id),
    };
    sort_and_bound_activity(&mut activity, ACTIVITY_LIMIT);

    Json(DashboardResponse {
        request_id,
        todo,
        ledger,
        health,
        recent_activity: activity,
    })
}

fn todo_projection(
    path: &std::path::Path,
    context: DashboardContext,
) -> Result<Projection<TodoDashboard>, todo_engine::application::error::TodoError> {
    let path = path
        .to_str()
        .ok_or_else(|| TodoError::Storage("unsupported database path".to_string()))?;
    let connection = connect_read_only(path)?;
    let repository = SqliteTodoRepository::new(connection);
    let activity = repository
        .recent_activity(ACTIVITY_LIMIT as u16)?
        .into_iter()
        .map(|event| RecentActivityItem {
            domain: "todo",
            action: safe_action(&event.action),
            record_id: safe_record_id(&event.record_id),
            timestamp: event.timestamp,
        })
        .collect();
    let mut service = TodoService::persistent(repository);
    let summary = service.dashboard_summary(context.local_date)?;
    Ok(Projection {
        data: TodoDashboard {
            active: summary.active,
            today_completed: summary.today_completed,
            today_incomplete: summary.today_incomplete,
            today_missed: summary.today_missed,
            today_total: summary.today_total,
            overdue: summary.overdue,
        },
        activity,
    })
}

fn ledger_projection(
    path: &std::path::Path,
    context: DashboardContext,
) -> Result<Projection<LedgerDashboard>, ledger_engine::application::error::LedgerError> {
    let repository = SqliteLedgerRepository::open_read_only(path)?;
    let service = LedgerService::new(repository);
    let summary = service.monthly_summary(YearMonth::new(
        context.local_date.year(),
        u8::from(context.local_date.month()),
    )?)?;
    let activity = service
        .recent_audit_activity(ACTIVITY_LIMIT as u16)?
        .into_iter()
        .map(|event| RecentActivityItem {
            domain: "ledger",
            action: safe_action(&event.action),
            record_id: safe_record_id(&event.record_id),
            timestamp: event.occurred_at,
        })
        .collect();
    Ok(Projection {
        data: LedgerDashboard {
            period_start: summary.range.start,
            period_end: summary.range.end,
            currencies: summary
                .currencies
                .into_iter()
                .map(|currency| LedgerCurrencyDashboard {
                    currency_code: currency.currency_code,
                    income_minor: currency.income_minor,
                    expense_minor: currency.expense_minor,
                    net_change_minor: currency.net_change_minor,
                })
                .collect(),
        },
        activity,
    })
}

fn health_projection(
    path: &std::path::Path,
) -> Result<Projection<HealthDashboard>, health_engine::application::error::HealthError> {
    let repository = SqliteHealthRepository::open_read_only(path)?;
    let snapshot = health_snapshot(
        repository.dashboard_latest_event(HealthCategory::Symptom, Some("overall_condition"))?,
        repository.dashboard_latest_event(HealthCategory::Sleep, None)?,
        repository.dashboard_latest_event(HealthCategory::Bowel, None)?,
        repository.dashboard_latest_event(HealthCategory::Medication, None)?,
        repository.dashboard_recent_diet(HEALTH_DIET_LIMIT)?,
    );
    let activity = repository
        .recent_audit_activity(ACTIVITY_LIMIT as u16)?
        .into_iter()
        .map(|event| RecentActivityItem {
            domain: "health",
            action: safe_action(&event.action),
            record_id: safe_record_id(&event.record_id),
            timestamp: event.occurred_at,
        })
        .collect();
    Ok(Projection {
        data: snapshot,
        activity,
    })
}

fn health_snapshot(
    condition: Option<HealthEvent>,
    sleep: Option<HealthEvent>,
    bowel: Option<HealthEvent>,
    medication: Option<HealthEvent>,
    diets: Vec<DietEntry>,
) -> HealthDashboard {
    let mut recent_diet_tags = Vec::new();
    for diet in diets {
        for tag in diet.tags() {
            if recent_diet_tags.len() == 8 {
                break;
            }
            if !recent_diet_tags.contains(tag) {
                recent_diet_tags.push(tag.clone());
            }
        }
    }
    HealthDashboard {
        latest_condition: condition.and_then(metric_snapshot),
        latest_sleep: sleep.and_then(metric_snapshot),
        latest_bowel: bowel.and_then(metric_snapshot),
        latest_medication: medication.and_then(metric_snapshot),
        recent_diet_tags,
    }
}

fn metric_snapshot(record: HealthEvent) -> Option<HealthMetricDashboard> {
    record.value_num().map(|value| HealthMetricDashboard {
        timestamp: record.occurred_at(),
        name: record.name().to_string(),
        value,
        unit: record.unit().map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use time::{OffsetDateTime, UtcOffset};

    use super::DashboardContext;

    #[test]
    fn request_context_uses_the_configured_offset_across_a_month_boundary() {
        let now = OffsetDateTime::parse(
            "2026-07-31T23:30:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .unwrap();
        let utc = DashboardContext::new(now, UtcOffset::UTC);
        let seoul = DashboardContext::new(now, UtcOffset::from_hms(9, 0, 0).unwrap());
        assert_eq!(utc.local_date.to_string(), "2026-07-31");
        assert_eq!(seoul.local_date.to_string(), "2026-08-01");
    }
}

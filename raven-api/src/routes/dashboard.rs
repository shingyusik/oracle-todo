use axum::{Json, Router, routing::get};
use health_engine::application::queries::TimelineItem;
use health_engine::domain::HealthCategory;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use ledger_engine::application::reports::YearMonth;
use ledger_engine::application::service::LedgerService;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use time::{Date, OffsetDateTime, UtcOffset};
use todo_engine::application::error::TodoError;
use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::TodoService;
use todo_engine::domain::{ItemStatus, ItemType};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect_read_only};
use uuid::Uuid;

use crate::RavenApiState;
use crate::dto::dashboard::{
    DashboardResponse, DomainProjection, HealthDashboard, HealthMetricDashboard,
    LedgerCurrencyDashboard, LedgerDashboard, RecentActivityItem, TodoDashboard, safe_action,
    safe_record_id, sort_and_bound_activity,
};

const ACTIVITY_LIMIT: usize = 20;
const HEALTH_SNAPSHOT_LIMIT: u16 = 100;

struct Projection<T> {
    data: T,
    activity: Vec<RecentActivityItem>,
}

pub fn router() -> Router<RavenApiState> {
    Router::new().route("/", get(dashboard))
}

async fn dashboard(state: axum::extract::State<RavenApiState>) -> Json<DashboardResponse> {
    let request_id = Uuid::new_v4();
    let todo_path = state.todo_db().to_path_buf();
    let ledger_path = state.ledger_db().to_path_buf();
    let health_path = state.health_db().to_path_buf();

    let todo = tokio::task::spawn_blocking(move || todo_projection(&todo_path));
    let ledger = tokio::task::spawn_blocking(move || ledger_projection(&ledger_path));
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
    let items = service.list_items(ListFilter {
        item_type: Some(ItemType::Task),
        status: Some(ItemStatus::Active),
        ..Default::default()
    })?;
    let today = local_today();
    let mut due_today = 0;
    let mut overdue = 0;
    for item in &items {
        let scheduled = persisted_date(item.scheduled.as_deref())?;
        let due = persisted_date(item.due.as_deref())?;
        if scheduled == Some(today) || due == Some(today) {
            due_today += 1;
        }
        if due.is_some_and(|due| due < today) {
            overdue += 1;
        }
    }
    Ok(Projection {
        data: TodoDashboard {
            active: items.len() as u64,
            today: due_today,
            overdue,
        },
        activity,
    })
}

fn ledger_projection(
    path: &std::path::Path,
) -> Result<Projection<LedgerDashboard>, ledger_engine::application::error::LedgerError> {
    let repository = SqliteLedgerRepository::open_read_only(path)?;
    let service = LedgerService::new(repository);
    let today = local_today();
    let summary =
        service.monthly_summary(YearMonth::new(today.year(), u8::from(today.month()))?)?;
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
    let snapshot = health_snapshot(repository.dashboard_timeline(HEALTH_SNAPSHOT_LIMIT)?);
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

fn health_snapshot(items: Vec<TimelineItem>) -> HealthDashboard {
    let mut dashboard = HealthDashboard {
        latest_condition: None,
        latest_sleep: None,
        latest_bowel: None,
        latest_medication: None,
        recent_diet_tags: Vec::new(),
    };
    for item in items {
        match item {
            TimelineItem::Diet { record } => {
                for tag in record.tags() {
                    if dashboard.recent_diet_tags.len() == 8 {
                        break;
                    }
                    if !dashboard.recent_diet_tags.contains(tag) {
                        dashboard.recent_diet_tags.push(tag.clone());
                    }
                }
            }
            TimelineItem::HealthEvent { record } => {
                let target = match record.category() {
                    HealthCategory::Symptom
                        if record.metric_key().as_str() == "overall_condition" =>
                    {
                        &mut dashboard.latest_condition
                    }
                    HealthCategory::Sleep => &mut dashboard.latest_sleep,
                    HealthCategory::Bowel => &mut dashboard.latest_bowel,
                    HealthCategory::Medication => &mut dashboard.latest_medication,
                    _ => continue,
                };
                if target.is_none() {
                    *target = record.value_num().map(|value| HealthMetricDashboard {
                        timestamp: record.occurred_at(),
                        name: record.name().to_string(),
                        value,
                        unit: record.unit().map(str::to_string),
                    });
                }
            }
        }
    }
    dashboard
}

fn local_today() -> Date {
    let offset = UtcOffset::from_hms(9, 0, 0).expect("valid Raven local offset");
    OffsetDateTime::now_utc().to_offset(offset).date()
}

fn persisted_date(value: Option<&str>) -> Result<Option<Date>, TodoError> {
    value
        .map(|value| Date::parse(value, &time::format_description::well_known::Iso8601::DATE))
        .transpose()
        .map_err(|_| TodoError::Storage("invalid persisted todo date".to_string()))
}

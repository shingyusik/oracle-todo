use health_engine::domain::{
    HealthEvent, HealthEventDetails, HealthEventRehydration, NewHealthEvent,
};
use time::{OffsetDateTime, macros::offset};

// Simulates persisted records written by older versions; never used by product code.
pub fn seed(
    path: &std::path::Path,
    occurred_at: OffsetDateTime,
    details: HealthEventDetails,
    daily: bool,
) -> HealthEvent {
    let input = NewHealthEvent::new(occurred_at, details, None).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = occurred_at
        .to_offset(time::UtcOffset::UTC)
        .format(time::macros::format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:9]Z"
        ))
        .unwrap();
    let date = occurred_at.to_offset(offset!(+9)).date().to_string();
    rusqlite::Connection::open(path).unwrap().execute(
        "INSERT INTO health_events (id,occurred_at,local_date,category,metric_key,name,value_num,unit,note,attributes_json,daily_upsert,created_at,updated_at,deleted_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,?10,?2,?2,NULL)",
        rusqlite::params![id,timestamp,date,serde_json::to_value(input.category()).unwrap().as_str().unwrap(),input.metric_key().as_str(),input.name(),input.value_num(),input.unit(),serde_json::to_string(input.attributes()).unwrap(),daily],
    ).unwrap();
    HealthEvent::rehydrate(HealthEventRehydration {
        id,
        occurred_at,
        category: input.category(),
        metric_key: input.metric_key().as_str().into(),
        name: input.name().into(),
        value_num: input.value_num(),
        unit: input.unit().map(str::to_owned),
        note: None,
        attributes: input.attributes().clone(),
        created_at: occurred_at,
        updated_at: occurred_at,
        deleted_at: None,
    })
    .unwrap()
}

use time::{OffsetDateTime, UtcOffset};

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();
}

pub fn local_today_string() -> String {
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    local_date_string_at(OffsetDateTime::now_utc(), offset)
}

pub fn local_date_string_at(now_utc: OffsetDateTime, offset: UtcOffset) -> String {
    now_utc.to_offset(offset).date().to_string()
}

use crate::application::error::{TodoError, TodoResult};
use time::{Date, OffsetDateTime, format_description::well_known::Rfc3339};

pub(super) fn priority(value: Option<i64>) -> TodoResult<()> {
    if value.is_some_and(|v| !(1..=10).contains(&v)) {
        return Err(TodoError::Validation(
            "priority must be between 1 and 10".into(),
        ));
    }
    Ok(())
}

pub(super) fn review_cycle(value: Option<&str>) -> TodoResult<()> {
    if value.is_some_and(|v| !matches!(v, "" | "daily" | "weekly" | "monthly" | "quarterly")) {
        return Err(TodoError::Validation(
            "review_cycle must be daily, weekly, monthly, or quarterly".into(),
        ));
    }
    Ok(())
}

pub(super) fn date(value: Option<&str>, field: &str, allow_time: bool) -> TodoResult<()> {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return Ok(());
    };
    let day = Date::parse(
        value,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .is_ok();
    if !(day || allow_time && OffsetDateTime::parse(value, &Rfc3339).is_ok()) {
        return Err(TodoError::Validation(format!(
            "{field} must be an ISO date{}",
            if allow_time {
                " or RFC 3339 timestamp"
            } else {
                ""
            }
        )));
    }
    Ok(())
}

pub(super) fn recurrence(rule: &str, today: Date) -> TodoResult<String> {
    let normalized = rule.trim().to_ascii_uppercase();
    let rule = if normalized.starts_with("RRULE:") {
        normalized
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>()
    } else {
        rule.trim().to_string()
    };
    for part in rule
        .trim()
        .to_ascii_uppercase()
        .trim_start_matches("RRULE:")
        .split(';')
    {
        if let Some((key, value)) = part.split_once('=') {
            if matches!(key, "BYMONTHDAY" | "BYMONTH") && value.contains(',') {
                return Err(TodoError::Validation(
                    "recurrence_rule must use a single month and month day".into(),
                ));
            }
            if key == "BYMONTHDAY"
                && !value
                    .parse::<i64>()
                    .is_ok_and(|v| v == -1 || (1..=31).contains(&v))
            {
                return Err(TodoError::Validation(
                    "recurrence_rule month day must be 1..31 or last day".into(),
                ));
            }
            if key == "INTERVAL" && value.parse::<i64>().is_ok_and(|v| v > 365) {
                return Err(TodoError::Validation(
                    "recurrence_rule interval must be between 1 and 365".into(),
                ));
            }
        }
    }
    if rule
        .split_whitespace()
        .any(|v| v.parse::<i64>().is_ok_and(|v| v > 365))
    {
        return Err(TodoError::Validation(
            "recurrence_rule interval must be between 1 and 365".into(),
        ));
    }
    crate::domain::future_occurrences(&rule, today, today.previous_day().unwrap_or(Date::MIN), 1)
        .map_err(|_| TodoError::Validation("Unsupported recurrence_rule".into()))?;
    Ok(rule)
}

pub(super) fn deprecated(description: Option<&str>, routine_id: Option<&str>) -> TodoResult<()> {
    if description.is_some() {
        return Err(TodoError::Validation(
            "description is deprecated; use note".into(),
        ));
    }
    if routine_id.is_some() {
        return Err(TodoError::Validation(
            "routine_id is assigned only by routine materialization".into(),
        ));
    }
    Ok(())
}

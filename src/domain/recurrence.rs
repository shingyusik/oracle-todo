use std::collections::BTreeSet;

use time::{Date, Duration, Month};

use crate::application::error::{TodoError, TodoResult};

pub fn occurrences(rule: &str, start: Date, end: Date) -> TodoResult<Vec<Date>> {
    if start > end {
        return Ok(Vec::new());
    }

    let original_rule = rule;
    let raw_rule = rule.trim().to_lowercase();
    let rule = match raw_rule.as_str() {
        "daily" | "매일" => "every day",
        "weekly" | "매주" => "every week",
        "monthly" | "매월" => "every month",
        "yearly" | "매년" => "every year",
        _ => raw_rule.as_str(),
    };

    if let Some(weekdays) = parse_weekday_set(rule) {
        if weekdays == [0, 1, 2, 3, 4, 5, 6] {
            return Ok(interval_occurrences(start, end, Duration::days(1)));
        }
        return Ok(weekday_set_occurrences(start, end, &weekdays, 1));
    }

    let Some((interval, unit, anchor)) = parse_interval_rule(rule) else {
        return unsupported(original_rule);
    };
    if interval < 1 {
        return unsupported(original_rule);
    }

    if matches!(unit, "day" | "days") {
        if anchor.is_some() {
            return unsupported(original_rule);
        }
        return Ok(interval_occurrences(
            start,
            end,
            Duration::days(interval as i64),
        ));
    }

    if matches!(unit, "week" | "weeks") {
        let Some(anchor) = anchor else {
            return Ok(interval_occurrences(
                start,
                end,
                Duration::weeks(interval as i64),
            ));
        };
        let Some(weekdays) = parse_weekday_set(anchor) else {
            return unsupported(original_rule);
        };
        return Ok(weekday_set_occurrences(start, end, &weekdays, interval));
    }

    if matches!(unit, "month" | "months") {
        let Some(anchor) = anchor else {
            return Ok(monthly_occurrences(start, end, 1, interval));
        };
        if anchor == "the last" {
            return Ok(monthly_last_occurrences(start, end, interval));
        }
        if let Some(day) = parse_monthly_day(anchor) {
            if !(1..=31).contains(&day) {
                return unsupported(original_rule);
            }
            return Ok(monthly_occurrences(start, end, day, interval));
        }
        return unsupported(original_rule);
    }

    if matches!(unit, "year" | "years") {
        if anchor.is_some() {
            return unsupported(original_rule);
        }
        return Ok(yearly_occurrences(start, end, interval));
    }

    unsupported(original_rule)
}

fn unsupported<T>(rule: &str) -> TodoResult<T> {
    Err(TodoError::Policy(format!(
        "Unsupported recurrence_rule: {rule}"
    )))
}

fn parse_interval_rule(rule: &str) -> Option<(i32, &str, Option<&str>)> {
    let rest = rule.strip_prefix("every ")?;
    let (core, anchor) = rest
        .split_once(" on ")
        .map_or((rest, None), |(core, anchor)| (core, Some(anchor.trim())));
    let mut parts = core.split_whitespace();
    let first = parts.next()?;
    let (interval, unit) = if first.chars().all(|char| char.is_ascii_digit()) {
        (first.parse().ok()?, parts.next()?)
    } else {
        (1, first)
    };
    if parts.next().is_some() {
        return None;
    }
    Some((interval, unit, anchor.filter(|value| !value.is_empty())))
}

fn parse_monthly_day(anchor: &str) -> Option<i32> {
    let value = anchor.strip_prefix("the ")?;
    let digits = value
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    let suffix = &value[digits.len()..];
    if !matches!(suffix, "" | "st" | "nd" | "rd" | "th") {
        return None;
    }
    digits.parse().ok()
}

fn parse_weekday_set(anchor: &str) -> Option<Vec<i32>> {
    let normalized = anchor.trim().to_lowercase();
    let weekdays = match normalized.as_str() {
        "weekday" | "weekdays" | "평일" | "월-금" => Some(vec![0, 1, 2, 3, 4]),
        "weekend" | "weekends" | "주말" | "토-일" => Some(vec![5, 6]),
        "월-일" => Some(vec![0, 1, 2, 3, 4, 5, 6]),
        value => weekday_alias(value).map(|weekday| vec![weekday]),
    };
    if weekdays.is_some() {
        return weekdays;
    }

    if let Some((left, right)) = normalized
        .split_once('-')
        .or_else(|| normalized.split_once('~'))
    {
        let start = weekday_alias(left.trim())?;
        let end = weekday_alias(right.trim())?;
        if start <= end {
            return Some((start..=end).collect());
        }
        return Some((start..=6).chain(0..=end).collect());
    }

    if normalized.contains(',')
        || normalized.contains('/')
        || normalized.contains(char::is_whitespace)
    {
        let mut out = Vec::new();
        for part in
            normalized.split(|char: char| char == ',' || char == '/' || char.is_whitespace())
        {
            if part.is_empty() {
                continue;
            }
            let weekday = weekday_alias(part)?;
            if !out.contains(&weekday) {
                out.push(weekday);
            }
        }
        return (!out.is_empty()).then_some(out);
    }

    if normalized
        .chars()
        .all(|char| "월화수목금토일".contains(char))
    {
        let mut out = Vec::new();
        for char in normalized.chars() {
            let weekday = weekday_alias(&char.to_string())?;
            if !out.contains(&weekday) {
                out.push(weekday);
            }
        }
        return (!out.is_empty()).then_some(out);
    }

    None
}

fn weekday_alias(value: &str) -> Option<i32> {
    match value {
        "mon" | "monday" | "월" => Some(0),
        "tue" | "tuesday" | "화" => Some(1),
        "wed" | "wednesday" | "수" => Some(2),
        "thu" | "thursday" | "목" => Some(3),
        "fri" | "friday" | "금" => Some(4),
        "sat" | "saturday" | "토" => Some(5),
        "sun" | "sunday" | "일" => Some(6),
        _ => None,
    }
}

fn interval_occurrences(start: Date, end: Date, step: Duration) -> Vec<Date> {
    let mut current = start;
    let mut out = Vec::new();
    while current <= end {
        out.push(current);
        current += step;
    }
    out
}

fn weekday_set_occurrences(
    start: Date,
    end: Date,
    weekdays: &[i32],
    interval_weeks: i32,
) -> Vec<Date> {
    weekdays
        .iter()
        .flat_map(|weekday| weekday_occurrences(start, end, *weekday, interval_weeks))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn weekday_occurrences(start: Date, end: Date, weekday: i32, interval_weeks: i32) -> Vec<Date> {
    let days_until_weekday = (weekday - weekday_index(start)).rem_euclid(7);
    let first = start + Duration::days(days_until_weekday as i64);
    interval_occurrences(first, end, Duration::weeks(interval_weeks as i64))
}

fn weekday_index(date: Date) -> i32 {
    date.weekday().number_from_monday() as i32 - 1
}

fn monthly_occurrences(start: Date, end: Date, day: i32, interval_months: i32) -> Vec<Date> {
    let mut current = first_of_month(start.year(), start.month());
    let mut out = Vec::new();
    while current <= end {
        let occurrence_day = day.min(last_day_of_month(current.year(), current.month()) as i32);
        let occurrence = date(current.year(), current.month(), occurrence_day as u8);
        if start <= occurrence && occurrence <= end {
            out.push(occurrence);
        }
        current = add_months(current, interval_months);
    }
    out
}

fn monthly_last_occurrences(start: Date, end: Date, interval_months: i32) -> Vec<Date> {
    let mut current = first_of_month(start.year(), start.month());
    let mut out = Vec::new();
    while current <= end {
        let occurrence = date(
            current.year(),
            current.month(),
            last_day_of_month(current.year(), current.month()),
        );
        if start <= occurrence && occurrence <= end {
            out.push(occurrence);
        }
        current = add_months(current, interval_months);
    }
    out
}

fn yearly_occurrences(start: Date, end: Date, interval_years: i32) -> Vec<Date> {
    let mut out = Vec::new();
    for year in start.year()..=end.year() {
        if (year - start.year()) % interval_years != 0 {
            continue;
        }
        let occurrence = date(year, Month::January, 1);
        if start <= occurrence && occurrence <= end {
            out.push(occurrence);
        }
    }
    out
}

fn add_months(value: Date, months: i32) -> Date {
    let month_index = u8::from(value.month()) as i32 - 1 + months;
    let year = value.year() + month_index.div_euclid(12);
    let month = Month::try_from((month_index.rem_euclid(12) + 1) as u8)
        .expect("month rem_euclid result is always 1..=12");
    let day = value.day().min(last_day_of_month(year, month));
    date(year, month, day)
}

fn first_of_month(year: i32, month: Month) -> Date {
    date(year, month, 1)
}

fn last_day_of_month(year: i32, month: Month) -> u8 {
    (28..=31)
        .rev()
        .find(|day| Date::from_calendar_date(year, month, *day).is_ok())
        .expect("every month has at least 28 days")
}

fn date(year: i32, month: Month, day: u8) -> Date {
    Date::from_calendar_date(year, month, day).expect("date components are validated")
}

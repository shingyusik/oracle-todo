//! Pure Raven event <-> Google Calendar event mapping (no I/O).
//!
//! Raven `scheduled` is either a date (`YYYY-MM-DD`) or an RFC 3339 timestamp. Google
//! all-day events use `start.date`/`end.date` with an exclusive end; timed events use
//! `start.dateTime`/`end.dateTime` plus `timeZone`. Times written by sync always carry
//! the configured offset (`+09:00` for Asia/Seoul), never `Z`, and are compared as
//! instants.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use todo_engine::domain::{ItemStatus, TodoItem};

/// Title used on both sides when the other side has an empty title.
pub const UNTITLED: &str = "(No title)";
/// `extendedProperties.private` key carrying the Raven item id.
pub const RAVEN_ITEM_ID_PROPERTY: &str = "raven_item_id";
/// `metadata.external_source.system` of Google-imported Raven events.
pub const EXTERNAL_SYSTEM: &str = "google_calendar";
/// Default duration of all-day events.
pub const DEFAULT_DURATION_DAYS: i64 = 1;
/// Upper bound accepted for stored durations (one year).
const MAX_DURATION_SECONDS: i64 = 366 * 86_400;
const MAX_DURATION_DAYS: i64 = 366;

/// Deterministic Google event id for a Raven-pushed event:
/// `"raven"` + first 32 hex digits of `sha256(raven_item_id)` (valid base32hex).
pub fn google_event_id_for(raven_item_id: &str) -> String {
    let digest = Sha256::digest(raven_item_id.as_bytes());
    format!("raven{}", &hex(&digest)[..32])
}

/// `"<calendar_id>/<event_id>"`, the `external_source.id` of an imported Raven event.
pub fn external_source_id(calendar_id: &str, google_event_id: &str) -> String {
    format!("{calendar_id}/{google_event_id}")
}

/// Google event id when `item.metadata.external_source` points at `calendar_id`.
pub fn imported_google_event_id(item: &TodoItem, calendar_id: &str) -> Option<String> {
    let source = item.external_source()?;
    if source.system != EXTERNAL_SYSTEM {
        return None;
    }
    source
        .id
        .strip_prefix(calendar_id)
        .and_then(|rest| rest.strip_prefix('/'))
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

/// A Google start or end value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventTime {
    /// All-day (`date`).
    Date(Date),
    /// Timed (`dateTime` + optional `timeZone`).
    DateTime {
        at: OffsetDateTime,
        time_zone: Option<String>,
    },
}

impl EventTime {
    pub fn date(date: Date) -> Self {
        Self::Date(date)
    }

    pub fn date_time(at: OffsetDateTime, time_zone: Option<String>) -> Self {
        Self::DateTime { at, time_zone }
    }

    /// Calendar day in `offset` (all-day dates are taken as-is).
    pub fn day_in(&self, offset: UtcOffset) -> Date {
        match self {
            Self::Date(date) => *date,
            Self::DateTime { at, .. } => at.to_offset(offset).date(),
        }
    }

    /// Google wire form. Writes always null the other variant so PATCH can switch kinds.
    /// Timestamps keep their own offset ([`google_times`] puts them in the configured one).
    pub fn to_json(&self) -> Value {
        match self {
            Self::Date(date) => json!({
                "date": format_date(*date),
                "dateTime": Value::Null,
                "timeZone": Value::Null,
            }),
            Self::DateTime { at, time_zone } => json!({
                "date": Value::Null,
                "dateTime": format_instant(*at, at.offset()),
                "timeZone": time_zone,
            }),
        }
    }

    /// Parses a Google `start`/`end` object.
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        if let Some(text) = object.get("dateTime").and_then(Value::as_str) {
            let at = OffsetDateTime::parse(text, &Rfc3339).ok()?;
            let time_zone = object
                .get("timeZone")
                .and_then(Value::as_str)
                .filter(|zone| !zone.is_empty())
                .map(str::to_owned);
            return Some(Self::DateTime { at, time_zone });
        }
        object
            .get("date")
            .and_then(Value::as_str)
            .and_then(parse_date)
            .map(Self::Date)
    }
}

/// Google event `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GEventStatus {
    Confirmed,
    Tentative,
    Cancelled,
}

impl GEventStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Tentative => "tentative",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "confirmed" => Some(Self::Confirmed),
            "tentative" => Some(Self::Tentative),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// A Google event as read from the API (only the fields sync uses).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GEvent {
    pub id: String,
    pub status: GEventStatus,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: Option<EventTime>,
    pub end: Option<EventTime>,
    pub updated: Option<OffsetDateTime>,
    pub etag: Option<String>,
    /// `recurrence` present or `recurringEventId` set.
    pub recurring: bool,
    /// `eventType`; `None` means `default`.
    pub event_type: Option<String>,
    /// `extendedProperties.private.raven_item_id`.
    pub raven_item_id: Option<String>,
}

impl GEvent {
    /// A confirmed event with no fields set; fill the public fields as needed.
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            status: GEventStatus::Confirmed,
            summary: None,
            description: None,
            location: None,
            start: None,
            end: None,
            updated: None,
            etag: None,
            recurring: false,
            event_type: None,
            raven_item_id: None,
        }
    }

    /// A cancelled (deleted) event as returned by incremental sync.
    pub fn cancelled(id: impl Into<String>) -> Self {
        Self {
            status: GEventStatus::Cancelled,
            ..Self::new(id)
        }
    }

    pub fn is_default_type(&self) -> bool {
        self.event_type
            .as_deref()
            .is_none_or(|kind| kind == "default")
    }

    /// Parses a Google Calendar `Event` resource. `None` when `id` is missing.
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let text = |key: &str| object.get(key).and_then(Value::as_str).map(str::to_owned);
        let id = text("id").filter(|id| !id.is_empty())?;
        let status = text("status")
            .as_deref()
            .and_then(GEventStatus::parse)
            .unwrap_or(GEventStatus::Confirmed);
        let recurring = object
            .get("recurrence")
            .and_then(Value::as_array)
            .is_some_and(|rules| !rules.is_empty())
            || object
                .get("recurringEventId")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty());
        let raven_item_id = object
            .get("extendedProperties")
            .and_then(|props| props.get("private"))
            .and_then(|private| private.get(RAVEN_ITEM_ID_PROPERTY))
            .and_then(Value::as_str)
            .map(str::to_owned);
        Some(Self {
            id,
            status,
            summary: text("summary"),
            description: text("description"),
            location: text("location"),
            start: object.get("start").and_then(EventTime::from_json),
            end: object.get("end").and_then(EventTime::from_json),
            updated: text("updated").and_then(|at| OffsetDateTime::parse(&at, &Rfc3339).ok()),
            etag: text("etag"),
            recurring,
            event_type: text("eventType"),
            raven_item_id,
        })
    }
}

/// An insert body or a PATCH body; `None` fields are not sent.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GEventWrite {
    /// Only for inserts (the deterministic id).
    pub id: Option<String>,
    pub summary: Option<String>,
    /// `Some("")` clears the description.
    pub description: Option<String>,
    /// `Some("")` clears the location.
    pub location: Option<String>,
    /// `start` and `end` are always written together.
    pub start: Option<EventTime>,
    pub end: Option<EventTime>,
    pub status: Option<GEventStatus>,
    /// `extendedProperties.private.raven_item_id`.
    pub raven_item_id: Option<String>,
}

impl GEventWrite {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    /// Google request body (insert or PATCH).
    pub fn to_json(&self) -> Value {
        let mut body = Map::new();
        if let Some(id) = &self.id {
            body.insert("id".into(), json!(id));
        }
        if let Some(summary) = &self.summary {
            body.insert("summary".into(), json!(summary));
        }
        if let Some(description) = &self.description {
            body.insert("description".into(), json!(description));
        }
        if let Some(location) = &self.location {
            body.insert("location".into(), json!(location));
        }
        if let Some(start) = &self.start {
            body.insert("start".into(), start.to_json());
        }
        if let Some(end) = &self.end {
            body.insert("end".into(), end.to_json());
        }
        if let Some(status) = self.status {
            body.insert("status".into(), json!(status.as_str()));
        }
        if let Some(raven_item_id) = &self.raven_item_id {
            body.insert(
                "extendedProperties".into(),
                json!({ "private": { RAVEN_ITEM_ID_PROPERTY: raven_item_id } }),
            );
        }
        Value::Object(body)
    }
}

/// Settings mapping depends on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MapConfig {
    /// IANA name sent as `timeZone` (default `Asia/Seoul`).
    pub time_zone: String,
    /// Offset used to write timestamps (must match `time_zone`).
    pub offset: UtcOffset,
    pub default_duration_minutes: u32,
    pub sync_note: bool,
}

impl Default for MapConfig {
    fn default() -> Self {
        Self {
            time_zone: "Asia/Seoul".to_owned(),
            offset: UtcOffset::from_hms(9, 0, 0).expect("valid offset"),
            default_duration_minutes: 60,
            sync_note: true,
        }
    }
}

/// Raven `scheduled`, parsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schedule {
    Date(Date),
    At(OffsetDateTime),
}

impl Schedule {
    pub fn parse(scheduled: &str) -> Option<Self> {
        let scheduled = scheduled.trim();
        if scheduled.len() == 10 {
            return parse_date(scheduled).map(Self::Date);
        }
        OffsetDateTime::parse(scheduled, &Rfc3339)
            .ok()
            .map(Self::At)
    }

    pub fn of(item: &TodoItem) -> Option<Self> {
        item.scheduled.as_deref().and_then(Self::parse)
    }

    pub fn from_event_time(time: &EventTime) -> Self {
        match time {
            EventTime::Date(date) => Self::Date(*date),
            EventTime::DateTime { at, .. } => Self::At(*at),
        }
    }

    pub fn day_in(self, offset: UtcOffset) -> Date {
        match self {
            Self::Date(date) => date,
            Self::At(at) => at.to_offset(offset).date(),
        }
    }

    /// Raven `scheduled` text: date, or a seconds-precision timestamp in `offset`.
    pub fn to_raven(self, offset: UtcOffset) -> String {
        match self {
            Self::Date(date) => format_date(date),
            Self::At(at) => format_instant(at, offset),
        }
    }

    fn canonical(self) -> String {
        match self {
            Self::Date(date) => format!("d:{}", format_date(date)),
            Self::At(at) => format!("t:{}", at.unix_timestamp()),
        }
    }
}

/// Stored per-link durations.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Durations {
    pub seconds: Option<i64>,
    pub days: Option<i64>,
}

impl Durations {
    /// Durations implied by a Google event's start/end (kind of `start` decides).
    pub fn from_google(start: &EventTime, end: Option<&EventTime>) -> Self {
        match (start, end) {
            (EventTime::Date(start), Some(EventTime::Date(end))) => Self {
                seconds: None,
                days: Some(((*end - *start).whole_days()).clamp(1, MAX_DURATION_DAYS)),
            },
            (EventTime::DateTime { at: start, .. }, Some(EventTime::DateTime { at: end, .. })) => {
                Self {
                    seconds: Some(
                        (*end - *start)
                            .whole_seconds()
                            .clamp(0, MAX_DURATION_SECONDS),
                    ),
                    days: None,
                }
            }
            _ => Self::default(),
        }
    }
}

/// Google start/end for a Raven schedule using the stored or default duration.
pub fn google_times(
    schedule: Schedule,
    durations: Durations,
    time_zone: Option<&str>,
    config: &MapConfig,
) -> (EventTime, EventTime) {
    match schedule {
        Schedule::Date(date) => {
            let days = durations
                .days
                .unwrap_or(DEFAULT_DURATION_DAYS)
                .clamp(1, MAX_DURATION_DAYS);
            let end = date.checked_add(Duration::days(days)).unwrap_or(date);
            (EventTime::Date(date), EventTime::Date(end))
        }
        Schedule::At(at) => {
            let at = truncate_seconds(at).to_offset(config.offset);
            let seconds = durations
                .seconds
                .unwrap_or(i64::from(config.default_duration_minutes) * 60)
                .clamp(0, MAX_DURATION_SECONDS);
            let zone = Some(time_zone.unwrap_or(&config.time_zone).to_owned());
            let end = at.checked_add(Duration::seconds(seconds)).unwrap_or(at);
            (
                EventTime::DateTime {
                    at,
                    time_zone: zone.clone(),
                },
                EventTime::DateTime {
                    at: end,
                    time_zone: zone,
                },
            )
        }
    }
}

/// The synced fields of one side, normalized.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncedFields {
    pub title: String,
    pub schedule: Option<Schedule>,
    pub note: String,
    pub location: String,
}

impl SyncedFields {
    pub fn of_raven(item: &TodoItem) -> Self {
        Self {
            title: title_or_untitled(&item.title),
            schedule: Schedule::of(item),
            note: item.note.clone().unwrap_or_default(),
            location: raven_location(item).unwrap_or_default(),
        }
    }

    pub fn of_google(event: &GEvent) -> Self {
        Self {
            title: title_or_untitled(event.summary.as_deref().unwrap_or_default()),
            schedule: event.start.as_ref().map(Schedule::from_event_time),
            note: event.description.clone().unwrap_or_default(),
            location: event.location.clone().unwrap_or_default(),
        }
    }

    pub fn hashes(&self, status: Option<GEventStatus>) -> FieldHashes {
        FieldHashes {
            title: field_hash("title", &self.title),
            start: field_hash(
                "start",
                &self.schedule.map(Schedule::canonical).unwrap_or_default(),
            ),
            note: field_hash("note", &self.note),
            location: field_hash("location", &self.location),
            status: status.map(|status| field_hash("status", status.as_str())),
        }
    }
}

/// Per-field hashes of the last agreed state (`links.base_hashes`, JSON).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldHashes {
    pub title: String,
    pub start: String,
    pub note: String,
    pub location: String,
    /// Google status pushed last (Raven-only direction).
    #[serde(default)]
    pub status: Option<String>,
}

impl FieldHashes {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_owned())
    }

    pub fn from_json(text: &str) -> Option<Self> {
        serde_json::from_str(text).ok()
    }
}

/// Hex hash of one canonical field value (32 hex digits of sha256).
pub fn field_hash(field: &str, canonical: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(field.as_bytes());
    hasher.update([0]);
    hasher.update(canonical.as_bytes());
    hex(&hasher.finalize())[..32].to_owned()
}

/// Google status a Raven status maps to (push only).
pub fn google_status_for(status: ItemStatus) -> GEventStatus {
    if status == ItemStatus::Paused {
        GEventStatus::Tentative
    } else {
        GEventStatus::Confirmed
    }
}

pub fn raven_location(item: &TodoItem) -> Option<String> {
    item.metadata
        .get("location")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn title_or_untitled(title: &str) -> String {
    if title.trim().is_empty() {
        UNTITLED.to_owned()
    } else {
        title.to_owned()
    }
}

/// Full insert body for a Raven event. `None` when `scheduled` is missing or invalid.
pub fn google_insert(
    item: &TodoItem,
    durations: Durations,
    time_zone: Option<&str>,
    config: &MapConfig,
) -> Option<GEventWrite> {
    let fields = SyncedFields::of_raven(item);
    let (start, end) = google_times(fields.schedule?, durations, time_zone, config);
    Some(GEventWrite {
        id: Some(google_event_id_for(&item.id)),
        summary: Some(fields.title),
        description: (config.sync_note && !fields.note.is_empty()).then_some(fields.note),
        location: (!fields.location.is_empty()).then_some(fields.location),
        start: Some(start),
        end: Some(end),
        status: Some(google_status_for(item.status)),
        raven_item_id: Some(item.id.clone()),
    })
}

/// A new Raven event built from a Google event (create with `Actor::System`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewRavenEvent {
    pub title: String,
    pub scheduled: String,
    pub note: Option<String>,
    pub location: Option<String>,
    pub external_source: todo_engine::domain::ExternalSource,
}

impl NewRavenEvent {
    pub fn into_propose_event(self) -> todo_engine::application::service::ProposeEvent {
        todo_engine::application::service::ProposeEvent {
            title: self.title,
            actor: todo_engine::domain::Actor::System,
            scheduled: Some(self.scheduled),
            location: self.location,
            note: self.note,
            external_source: Some(self.external_source),
            ..Default::default()
        }
    }
}

/// Raven-side update; `None` fields stay unchanged. `Some("")` clears note/location.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RavenUpdate {
    pub title: Option<String>,
    pub scheduled: Option<String>,
    pub note: Option<String>,
    pub location: Option<String>,
}

impl RavenUpdate {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    pub fn into_update_item(self, reason: &str) -> todo_engine::application::service::UpdateItem {
        todo_engine::application::service::UpdateItem {
            title: self.title,
            scheduled: self.scheduled,
            note: self.note,
            location: self.location,
            reason: Some(reason.to_owned()),
            ..Default::default()
        }
    }
}

/// Raven event for a Google event. `None` when the Google event has no start.
pub fn raven_from_google(
    event: &GEvent,
    calendar_id: &str,
    config: &MapConfig,
) -> Option<NewRavenEvent> {
    let fields = SyncedFields::of_google(event);
    let scheduled = fields.schedule?.to_raven(config.offset);
    let non_empty = |value: String| (!value.is_empty()).then_some(value);
    Some(NewRavenEvent {
        title: fields.title,
        scheduled,
        note: if config.sync_note {
            non_empty(fields.note)
        } else {
            None
        },
        location: non_empty(fields.location),
        external_source: todo_engine::domain::ExternalSource {
            system: EXTERNAL_SYSTEM.to_owned(),
            id: external_source_id(calendar_id, &event.id),
        },
    })
}

pub fn format_date(date: Date) -> String {
    date.format(format_description!("[year]-[month]-[day]"))
        .unwrap_or_default()
}

pub fn parse_date(text: &str) -> Option<Date> {
    Date::parse(text, format_description!("[year]-[month]-[day]")).ok()
}

/// RFC 3339 in `offset`, whole seconds (e.g. `2026-07-14T10:00:00+09:00`).
pub fn format_instant(at: OffsetDateTime, offset: UtcOffset) -> String {
    truncate_seconds(at)
        .to_offset(offset)
        .format(&Rfc3339)
        .unwrap_or_default()
}

fn truncate_seconds(at: OffsetDateTime) -> OffsetDateTime {
    at.replace_nanosecond(0).unwrap_or(at)
}

#[cfg(test)]
mod tests;

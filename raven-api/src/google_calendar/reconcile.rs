//! Pure two-way reconciliation of Raven events, Google changes and stored links.
//!
//! [`reconcile`] does no I/O: the runtime fetches Raven events (including archived),
//! the Google changes of this pass and the links of the selected calendar, executes the
//! returned [`Plan`] and stores each action's [`Link`] after the writes succeed
//! (overwriting `google_etag`/`google_updated` from the Google response and
//! `raven_item_id`/`raven_updated_at` from the Raven result).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use todo_engine::domain::{ItemStatus, ItemType, TodoItem};

use super::mapping::{
    Durations, EventTime, FieldHashes, GEvent, GEventStatus, GEventWrite, MapConfig, NewRavenEvent,
    RavenUpdate, Schedule, SyncedFields, google_event_id_for, google_insert, google_status_for,
    google_times, imported_google_event_id, raven_from_google,
};

/// `reason` of Raven writes made by sync.
pub const SYNC_REASON: &str = "google_calendar_sync";
/// `reason` of Raven archives caused by a Google deletion.
pub const DELETED_REASON: &str = "google_calendar_deleted";
/// First-sync window: today − this many days (in the configured offset).
pub const FIRST_SYNC_WINDOW_DAYS: i64 = 7;
/// Mass-change guard: at least this many deletions are always allowed.
pub const GUARD_MIN: u64 = 10;
/// Mass-change guard: percent of links allowed to be deleted in one pass.
pub const GUARD_PERCENT: u64 = 20;
const MAX_POSTPONE_CHAIN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkOrigin {
    Raven,
    Google,
}

impl LinkOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Raven => "raven",
            Self::Google => "google",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "raven" => Some(Self::Raven),
            "google" => Some(Self::Google),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkState {
    /// Two-way synced.
    Active,
    /// Raven completed/missed: Google event kept, later Google edits ignored.
    Frozen,
    /// One side deleted the event; kept so a Google restore can be re-imported.
    Deleted,
    /// The linked Raven item vanished while active; the Google event is never deleted.
    Orphaned,
    /// The Google event became recurring or otherwise unsupported.
    Unsupported,
    /// Writes keep failing (runtime-managed); reconciled like `Active`.
    Error,
}

impl LinkState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Frozen => "frozen",
            Self::Deleted => "deleted",
            Self::Orphaned => "orphaned",
            Self::Unsupported => "unsupported",
            Self::Error => "error",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "frozen" => Some(Self::Frozen),
            "deleted" => Some(Self::Deleted),
            "orphaned" => Some(Self::Orphaned),
            "unsupported" => Some(Self::Unsupported),
            "error" => Some(Self::Error),
            _ => None,
        }
    }

    fn is_live(self) -> bool {
        matches!(self, Self::Active | Self::Frozen | Self::Error)
    }
}

/// One `links` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub calendar_id: String,
    pub google_event_id: String,
    pub raven_item_id: String,
    pub origin: LinkOrigin,
    pub state: LinkState,
    pub google_etag: Option<String>,
    pub google_updated: Option<OffsetDateTime>,
    pub google_time_zone: Option<String>,
    pub raven_updated_at: OffsetDateTime,
    pub base_hashes: FieldHashes,
    pub duration_seconds: Option<i64>,
    pub duration_days: Option<i64>,
    pub last_synced_at: OffsetDateTime,
    pub error_kind: Option<String>,
    pub error_count: i64,
}

impl Link {
    /// A fresh active link with an unknown base (every differing field is resolved
    /// newer-wins without counting a conflict).
    pub fn new(
        calendar_id: impl Into<String>,
        google_event_id: impl Into<String>,
        raven_item_id: impl Into<String>,
        origin: LinkOrigin,
        now: OffsetDateTime,
    ) -> Self {
        Self {
            calendar_id: calendar_id.into(),
            google_event_id: google_event_id.into(),
            raven_item_id: raven_item_id.into(),
            origin,
            state: LinkState::Active,
            google_etag: None,
            google_updated: None,
            google_time_zone: None,
            raven_updated_at: now,
            base_hashes: FieldHashes::default(),
            duration_seconds: None,
            duration_days: None,
            last_synced_at: now,
            error_kind: None,
            error_count: 0,
        }
    }

    pub fn durations(&self) -> Durations {
        Durations {
            seconds: self.duration_seconds,
            days: self.duration_days,
        }
    }
}

/// A Google change of this pass (incremental list or full resync).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GChange {
    Event(Box<GEvent>),
    /// Confirmed gone (`events.get` 404/410) after a full resync.
    Deleted {
        id: String,
    },
}

impl GChange {
    pub fn event(event: GEvent) -> Self {
        Self::Event(Box::new(event))
    }

    pub fn deleted(id: impl Into<String>) -> Self {
        Self::Deleted { id: id.into() }
    }

    pub fn id(&self) -> &str {
        match self {
            Self::Event(event) => &event.id,
            Self::Deleted { id } => id,
        }
    }

    /// Deleted or `status: cancelled`.
    pub fn is_deleted(&self) -> bool {
        match self {
            Self::Event(event) => event.status == GEventStatus::Cancelled,
            Self::Deleted { .. } => true,
        }
    }

    fn live(&self) -> Option<&GEvent> {
        match self {
            Self::Event(event) if event.status != GEventStatus::Cancelled => Some(event),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncConfig {
    pub calendar_id: String,
    pub map: MapConfig,
    /// Lower bound for pushing/importing unlinked events (`settings.push_since`);
    /// `None` = today − 7 days in `map.offset`.
    pub push_since: Option<Date>,
    pub allow_mass_delete: bool,
}

impl SyncConfig {
    pub fn new(calendar_id: impl Into<String>) -> Self {
        Self {
            calendar_id: calendar_id.into(),
            map: MapConfig::default(),
            push_since: None,
            allow_mass_delete: false,
        }
    }

    /// `push_since`, else today − 7 days in the configured offset.
    pub fn window_start(&self, now: OffsetDateTime) -> Date {
        self.push_since
            .unwrap_or_else(|| first_sync_window_start(now, self.map.offset))
    }
}

/// today − 7 days in `offset` (the value the runtime stores as `push_since`).
pub fn first_sync_window_start(now: OffsetDateTime, offset: UtcOffset) -> Date {
    let today = now.to_offset(offset).date();
    today
        .checked_sub(Duration::days(FIRST_SYNC_WINDOW_DAYS))
        .unwrap_or(today)
}

/// Last-sync counters (status JSON `counts`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SyncCounts {
    pub google_created: u64,
    pub google_updated: u64,
    pub google_deleted: u64,
    pub raven_created: u64,
    pub raven_updated: u64,
    pub raven_archived: u64,
    pub conflicts: u64,
    pub skipped_recurring: u64,
    pub skipped_terminal: u64,
    pub failed: u64,
}

/// The mass-change guard tripped; deletions/archives were removed from the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuardTrip {
    pub google_deletes: u64,
    pub raven_archives: u64,
    pub threshold: u64,
}

/// A PATCH of an existing Google event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GooglePatch {
    /// `If-Match` value (412 → refetch next pass).
    pub if_match: Option<String>,
    pub event: GEventWrite,
}

/// An `update_item_if_current` of a Raven event (Conflict → retry next pass).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RavenChange {
    pub expected_updated_at: OffsetDateTime,
    pub update: RavenUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Insert with the deterministic id (409 → get; cancelled → patch to confirmed).
    InsertGoogle {
        raven_item_id: String,
        event: GEventWrite,
        link: Link,
    },
    /// Two-way field merge result; either side may be `None`.
    Update {
        raven_item_id: String,
        google_event_id: String,
        google: Option<GooglePatch>,
        raven: Option<RavenChange>,
        link: Link,
    },
    /// Delete the Google event (`sendUpdates=none`; 404/410 = success).
    DeleteGoogle {
        raven_item_id: String,
        google_event_id: String,
        link: Link,
    },
    /// Create a Raven event (`Actor::System`), then store `link` with the new id.
    CreateRaven {
        google_event_id: String,
        event: NewRavenEvent,
        link: Link,
    },
    /// Archive the Raven event with reason [`DELETED_REASON`].
    ArchiveRaven {
        raven_item_id: String,
        google_event_id: String,
        expected_updated_at: OffsetDateTime,
        link: Link,
    },
    /// Link-only change (freeze, orphan, unsupported, refreshed base/etag).
    SaveLink(Link),
    DeleteLink {
        calendar_id: String,
        google_event_id: String,
    },
}

impl Action {
    fn is_mass_change(&self) -> bool {
        matches!(self, Self::DeleteGoogle { .. } | Self::ArchiveRaven { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Plan {
    pub actions: Vec<Action>,
    /// Planned counts (the runtime adjusts `failed` while executing).
    pub counts: SyncCounts,
    pub guard: Option<GuardTrip>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MergeMode {
    TwoWay,
    /// Raven terminal (completed/missed): push Raven changes, ignore Google.
    PushOnly,
    /// Reopened after freeze, or forced: write every Raven field to Google.
    ForcePush,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pick {
    Keep,
    Push,
    Pull,
}

fn is_closed(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Archived | ItemStatus::Dropped | ItemStatus::Cancelled | ItemStatus::Rejected
    )
}

fn is_finished(status: ItemStatus) -> bool {
    matches!(status, ItemStatus::Completed | ItemStatus::Missed)
}

fn is_pushable(status: ItemStatus) -> bool {
    matches!(status, ItemStatus::Active | ItemStatus::Paused)
}

fn supported(event: &GEvent) -> bool {
    !event.recurring && event.is_default_type()
}

struct Ctx<'a> {
    cfg: &'a SyncConfig,
    now: OffsetDateTime,
    window: Date,
    raven: HashMap<&'a str, &'a TodoItem>,
    changes: HashMap<&'a str, &'a GChange>,
    links_by_raven: HashMap<&'a str, &'a Link>,
    links_by_google: HashMap<&'a str, &'a Link>,
    plan: Plan,
    handled_raven: HashSet<String>,
    handled_google: HashSet<String>,
}

/// Plans one sync pass. See the module docs for how the runtime applies it.
pub fn reconcile(
    raven: &[TodoItem],
    google: &[GChange],
    links: &[Link],
    cfg: &SyncConfig,
    now: OffsetDateTime,
) -> Plan {
    let links: Vec<&Link> = links
        .iter()
        .filter(|link| link.calendar_id == cfg.calendar_id)
        .collect();
    let mut ctx = Ctx {
        cfg,
        now,
        window: cfg.window_start(now),
        raven: raven
            .iter()
            .filter(|item| item.item_type == ItemType::Event)
            .map(|item| (item.id.as_str(), item))
            .collect(),
        changes: google.iter().map(|change| (change.id(), change)).collect(),
        links_by_raven: links
            .iter()
            .map(|link| (link.raven_item_id.as_str(), *link))
            .collect(),
        links_by_google: links
            .iter()
            .map(|link| (link.google_event_id.as_str(), *link))
            .collect(),
        plan: Plan::default(),
        handled_raven: HashSet::new(),
        handled_google: HashSet::new(),
    };

    let relinks = ctx.postpone_relinks(raven);
    let mut sorted = links.clone();
    sorted.sort_by(|a, b| a.google_event_id.cmp(&b.google_event_id));
    for link in sorted {
        let target = relinks.get(link.google_event_id.as_str()).copied();
        ctx.linked(link, target);
    }
    for item in raven {
        ctx.unlinked_raven(item);
    }
    for change in google {
        ctx.unlinked_google(change);
    }
    let total_links = links.iter().filter(|link| link.state.is_live()).count() as u64;
    ctx.apply_guard(total_links);
    ctx.plan
}

/// New base hash for one field after a merge decision.
fn settle(pick: Pick, r: &str, g: &str, slot: &mut String) {
    match pick {
        Pick::Keep if r == g => *slot = r.to_owned(),
        Pick::Keep => {}
        Pick::Push => *slot = r.to_owned(),
        Pick::Pull => *slot = g.to_owned(),
    }
}

impl<'a> Ctx<'a> {
    /// Unlinked active follow-ups whose `postponed_from` chain reaches a live link.
    fn postpone_relinks(&mut self, raven: &'a [TodoItem]) -> HashMap<&'a str, &'a TodoItem> {
        let mut relinks = HashMap::new();
        for item in raven {
            if item.item_type != ItemType::Event
                || !is_pushable(item.status)
                || self.links_by_raven.contains_key(item.id.as_str())
            {
                continue;
            }
            let mut current = item;
            let mut seen = HashSet::new();
            for _ in 0..MAX_POSTPONE_CHAIN {
                let Some(source_id) = current
                    .metadata
                    .get("postponed_from")
                    .and_then(serde_json::Value::as_str)
                else {
                    break;
                };
                if !seen.insert(source_id) {
                    break;
                }
                if let Some(link) = self.links_by_raven.get(source_id)
                    && matches!(link.state, LinkState::Active | LinkState::Frozen)
                    && !relinks.contains_key(link.google_event_id.as_str())
                    && self
                        .raven
                        .get(source_id)
                        .is_none_or(|source| source.status == ItemStatus::Missed)
                {
                    relinks.insert(link.google_event_id.as_str(), item);
                    self.handled_raven.insert(source_id.to_owned());
                    break;
                }
                match self.raven.get(source_id) {
                    Some(source) => current = source,
                    None => break,
                }
            }
        }
        relinks
    }

    fn linked(&mut self, link: &Link, relink_target: Option<&'a TodoItem>) {
        let google_id = link.google_event_id.clone();
        self.handled_google.insert(google_id.clone());
        let change = self.changes.get(google_id.as_str()).copied();
        let item = relink_target.or_else(|| self.raven.get(link.raven_item_id.as_str()).copied());
        if let Some(item) = item {
            self.handled_raven.insert(item.id.clone());
        }
        let deleted = change.is_some_and(GChange::is_deleted);
        let live = change.and_then(GChange::live);

        match link.state {
            LinkState::Orphaned | LinkState::Unsupported => {
                if deleted {
                    self.delete_link(link);
                }
            }
            LinkState::Deleted => {
                if let Some(event) = live.filter(|event| supported(event)) {
                    self.create_raven(event, Some(link));
                } else if item.is_none() {
                    self.delete_link(link);
                }
            }
            LinkState::Active | LinkState::Frozen | LinkState::Error => {
                let Some(item) = item else {
                    if deleted {
                        self.delete_link(link);
                    } else {
                        self.save_link(link, |next| next.state = LinkState::Orphaned);
                    }
                    return;
                };
                self.linked_item(link, item, change);
            }
        }
    }

    fn linked_item(&mut self, link: &Link, item: &TodoItem, change: Option<&GChange>) {
        let deleted = change.is_some_and(GChange::is_deleted);
        let live = change.and_then(GChange::live);
        if is_closed(item.status) {
            if deleted {
                self.save_link(link, |next| next.state = LinkState::Deleted);
            } else {
                let next = self.next_link(link, |next| {
                    next.state = LinkState::Deleted;
                    next.raven_item_id = item.id.clone();
                    next.raven_updated_at = item.updated_at;
                });
                self.plan.counts.google_deleted += 1;
                self.plan.actions.push(Action::DeleteGoogle {
                    raven_item_id: item.id.clone(),
                    google_event_id: link.google_event_id.clone(),
                    link: next,
                });
            }
            return;
        }
        if deleted {
            if link.state == LinkState::Frozen || is_finished(item.status) {
                self.delete_link(link);
            } else {
                let next = self.next_link(link, |next| {
                    next.state = LinkState::Deleted;
                    next.raven_item_id = item.id.clone();
                });
                self.plan.counts.raven_archived += 1;
                self.plan.actions.push(Action::ArchiveRaven {
                    raven_item_id: item.id.clone(),
                    google_event_id: link.google_event_id.clone(),
                    expected_updated_at: item.updated_at,
                    link: next,
                });
            }
            return;
        }
        if let Some(event) = live
            && !supported(event)
        {
            self.plan.counts.skipped_recurring += u64::from(event.recurring);
            self.save_link(link, |next| next.state = LinkState::Unsupported);
            return;
        }
        let (mode, state) = if link.state == LinkState::Frozen {
            if is_finished(item.status) {
                return;
            }
            (MergeMode::ForcePush, LinkState::Active)
        } else if is_finished(item.status) {
            (MergeMode::PushOnly, LinkState::Frozen)
        } else {
            (MergeMode::TwoWay, LinkState::Active)
        };
        self.merge(link, item, live, mode, state);
    }

    fn merge(
        &mut self,
        link: &Link,
        item: &TodoItem,
        google: Option<&GEvent>,
        mode: MergeMode,
        state: LinkState,
    ) {
        let cfg = &self.cfg.map;
        let merged_google = google.filter(|event| {
            mode == MergeMode::TwoWay && (event.etag.is_none() || event.etag != link.google_etag)
        });
        let base = &link.base_hashes;
        let raven_fields = SyncedFields::of_raven(item);
        let desired_status = google_status_for(item.status);
        // Hashing the current Raven fields equals the base when Raven is unchanged.
        let r = raven_fields.hashes(Some(desired_status));
        let google_fields = merged_google.map(SyncedFields::of_google);
        let gf = google_fields.as_ref();
        let g = gf
            .map(|fields| fields.hashes(None))
            .unwrap_or_else(|| base.clone());
        let raven_newer = merged_google
            .and_then(|event| event.updated)
            .is_none_or(|updated| item.updated_at >= updated);
        let mut conflict = false;
        let mut pick = |r: &str, g: &str, b: &str, empty: Option<(bool, bool)>| {
            if mode == MergeMode::ForcePush {
                return Pick::Push;
            }
            let (r_changed, g_changed) = (r != b, g != b);
            match (r_changed, g_changed) {
                (false, false) => Pick::Keep,
                // Unknown base and unseen Google value: never blank Google.
                (true, false) if b.is_empty() && empty.is_some_and(|(r_empty, _)| r_empty) => {
                    Pick::Keep
                }
                (true, false) => Pick::Push,
                (false, true) => Pick::Pull,
                (true, true) if r == g => Pick::Keep,
                (true, true) => {
                    if b.is_empty() {
                        // Unknown base (adoption, note sync re-enabled): prefer content.
                        match empty {
                            Some((true, false)) => return Pick::Pull,
                            Some((false, true)) => return Pick::Push,
                            _ => {}
                        }
                    } else {
                        conflict = true;
                    }
                    if raven_newer { Pick::Push } else { Pick::Pull }
                }
            }
        };
        let empties = |raven: &str, google: Option<&str>| {
            Some((raven.is_empty(), google.is_none_or(str::is_empty)))
        };
        let title = pick(&r.title, &g.title, &base.title, None);
        let start = match pick(&r.start, &g.start, &base.start, None) {
            Pick::Pull if gf.and_then(|fields| fields.schedule).is_none() => Pick::Keep,
            Pick::Push if raven_fields.schedule.is_none() => Pick::Keep,
            pick => pick,
        };
        let note = if cfg.sync_note {
            pick(
                &r.note,
                &g.note,
                &base.note,
                empties(&raven_fields.note, gf.map(|fields| fields.note.as_str())),
            )
        } else {
            Pick::Keep
        };
        let location = pick(
            &r.location,
            &g.location,
            &base.location,
            empties(
                &raven_fields.location,
                gf.map(|fields| fields.location.as_str()),
            ),
        );

        let mut next = link.clone();
        next.raven_item_id = item.id.clone();
        next.state = state;
        next.raven_updated_at = item.updated_at;
        next.last_synced_at = self.now;
        next.error_kind = None;
        next.error_count = 0;
        if let Some(event) = google {
            next.google_etag = event.etag.clone().or(next.google_etag);
            next.google_updated = event.updated.or(next.google_updated);
        }
        if let Some(event) = merged_google
            && let Some(start) = &event.start
        {
            let durations = Durations::from_google(start, event.end.as_ref());
            next.duration_seconds = durations.seconds.or(next.duration_seconds);
            next.duration_days = durations.days.or(next.duration_days);
            if let EventTime::DateTime {
                time_zone: Some(zone),
                ..
            } = start
            {
                next.google_time_zone = Some(zone.clone());
            }
        }

        let mut new_base = base.clone();
        settle(title, &r.title, &g.title, &mut new_base.title);
        settle(start, &r.start, &g.start, &mut new_base.start);
        settle(location, &r.location, &g.location, &mut new_base.location);
        if cfg.sync_note {
            settle(note, &r.note, &g.note, &mut new_base.note);
        } else {
            new_base.note = String::new();
        }

        let mut patch = GEventWrite::default();
        let mut update = RavenUpdate::default();
        match title {
            Pick::Push => patch.summary = Some(raven_fields.title.clone()),
            Pick::Pull => update.title = gf.map(|fields| fields.title.clone()),
            Pick::Keep => {}
        }
        match (
            start,
            raven_fields.schedule,
            gf.and_then(|fields| fields.schedule),
        ) {
            (Pick::Push, Some(schedule), _) => {
                let (start, end) = google_times(
                    schedule,
                    next.durations(),
                    next.google_time_zone.as_deref(),
                    cfg,
                );
                patch.start = Some(start);
                patch.end = Some(end);
            }
            (Pick::Pull, _, Some(schedule)) => {
                update.scheduled = Some(schedule.to_raven(cfg.offset));
            }
            _ => {}
        }
        match note {
            Pick::Push => patch.description = Some(raven_fields.note.clone()),
            Pick::Pull => update.note = gf.map(|fields| fields.note.clone()),
            Pick::Keep => {}
        }
        match location {
            Pick::Push => patch.location = Some(raven_fields.location.clone()),
            Pick::Pull => update.location = gf.map(|fields| fields.location.clone()),
            Pick::Keep => {}
        }
        if mode == MergeMode::ForcePush || r.status != base.status {
            patch.status = Some(desired_status);
            new_base.status = r.status.clone();
        }
        next.base_hashes = new_base;

        if conflict {
            self.plan.counts.conflicts += 1;
        }
        if patch.is_empty() && update.is_empty() {
            if link.state == LinkState::Error {
                next.state = LinkState::Error;
                next.error_kind = link.error_kind.clone();
                next.error_count = link.error_count;
            }
            let mut unchanged = next.clone();
            unchanged.last_synced_at = link.last_synced_at;
            if unchanged != *link {
                self.plan.actions.push(Action::SaveLink(next));
            }
            return;
        }
        let google_patch = (!patch.is_empty()).then(|| GooglePatch {
            if_match: next.google_etag.clone(),
            event: patch,
        });
        let raven_change = (!update.is_empty()).then_some(RavenChange {
            expected_updated_at: item.updated_at,
            update,
        });
        self.plan.counts.google_updated += u64::from(google_patch.is_some());
        self.plan.counts.raven_updated += u64::from(raven_change.is_some());
        self.plan.actions.push(Action::Update {
            raven_item_id: item.id.clone(),
            google_event_id: link.google_event_id.clone(),
            google: google_patch,
            raven: raven_change,
            link: next,
        });
    }

    fn unlinked_raven(&mut self, item: &'a TodoItem) {
        if item.item_type != ItemType::Event
            || self.handled_raven.contains(&item.id)
            || self.links_by_raven.contains_key(item.id.as_str())
        {
            return;
        }
        let Some(schedule) = Schedule::of(item) else {
            return;
        };
        if schedule.day_in(self.cfg.map.offset) < self.window {
            return;
        }
        if !is_pushable(item.status) {
            self.plan.counts.skipped_terminal +=
                u64::from(is_finished(item.status) || is_closed(item.status));
            return;
        }
        // Already on Google (imported earlier, or pushed before links were forgotten).
        let imported = imported_google_event_id(item, &self.cfg.calendar_id);
        let known_id = imported
            .clone()
            .unwrap_or_else(|| google_event_id_for(&item.id));
        if self.links_by_google.contains_key(known_id.as_str())
            || self.handled_google.contains(&known_id)
        {
            return;
        }
        if let Some(change) = self.changes.get(known_id.as_str()).copied() {
            if let Some(event) = change.live().filter(|event| supported(event)) {
                self.adopt(item, event);
            }
            return;
        }
        if imported.is_some() {
            // Imported from this calendar but not seen this pass: never push a duplicate.
            return;
        }
        let Some(event) = google_insert(item, Durations::default(), None, &self.cfg.map) else {
            return;
        };
        let mut link = Link::new(
            &self.cfg.calendar_id,
            google_event_id_for(&item.id),
            &item.id,
            LinkOrigin::Raven,
            self.now,
        );
        link.raven_updated_at = item.updated_at;
        link.base_hashes =
            SyncedFields::of_raven(item).hashes(Some(google_status_for(item.status)));
        if !self.cfg.map.sync_note {
            link.base_hashes.note = String::new();
        }
        self.handled_raven.insert(item.id.clone());
        self.plan.counts.google_created += 1;
        self.plan.actions.push(Action::InsertGoogle {
            raven_item_id: item.id.clone(),
            event,
            link,
        });
    }

    /// Links an unlinked Raven event to the Google event it already corresponds to.
    fn adopt(&mut self, item: &TodoItem, event: &GEvent) {
        self.handled_google.insert(event.id.clone());
        self.handled_raven.insert(item.id.clone());
        let origin = if imported_google_event_id(item, &self.cfg.calendar_id).is_some() {
            LinkOrigin::Google
        } else {
            LinkOrigin::Raven
        };
        let link = Link::new(&self.cfg.calendar_id, &event.id, &item.id, origin, self.now);
        self.merge(
            &link,
            item,
            Some(event),
            MergeMode::TwoWay,
            LinkState::Active,
        );
    }

    fn unlinked_google(&mut self, change: &'a GChange) {
        let id = change.id();
        if self.handled_google.contains(id) || self.links_by_google.contains_key(id) {
            return;
        }
        let Some(event) = change.live() else {
            return;
        };
        self.handled_google.insert(id.to_owned());
        if event.recurring {
            self.plan.counts.skipped_recurring += 1;
            return;
        }
        if !event.is_default_type() {
            return;
        }
        if let Some(raven_id) = event.raven_item_id.as_deref()
            && let Some(item) = self.raven.get(raven_id).copied()
        {
            if is_pushable(item.status)
                && !self.links_by_raven.contains_key(raven_id)
                && !self.handled_raven.contains(raven_id)
            {
                self.adopt(item, event);
            }
            return;
        }
        let Some(start) = &event.start else {
            return;
        };
        if start.day_in(self.cfg.map.offset) < self.window {
            return;
        }
        self.create_raven(event, None);
    }

    fn create_raven(&mut self, event: &GEvent, previous: Option<&Link>) {
        let Some(new) = raven_from_google(event, &self.cfg.calendar_id, &self.cfg.map) else {
            return;
        };
        let mut link = Link::new(
            &self.cfg.calendar_id,
            &event.id,
            String::new(),
            LinkOrigin::Google,
            self.now,
        );
        if let Some(previous) = previous {
            link.origin = previous.origin;
        }
        link.google_etag = event.etag.clone();
        link.google_updated = event.updated;
        if let Some(start) = &event.start {
            let durations = Durations::from_google(start, event.end.as_ref());
            link.duration_seconds = durations.seconds;
            link.duration_days = durations.days;
            if let EventTime::DateTime {
                time_zone: Some(zone),
                ..
            } = start
            {
                link.google_time_zone = Some(zone.clone());
            }
        }
        let mut hashes = SyncedFields::of_google(event).hashes(Some(GEventStatus::Confirmed));
        if !self.cfg.map.sync_note {
            hashes.note = String::new();
        }
        link.base_hashes = hashes;
        self.plan.counts.raven_created += 1;
        self.plan.actions.push(Action::CreateRaven {
            google_event_id: event.id.clone(),
            event: new,
            link,
        });
    }

    fn next_link(&self, link: &Link, change: impl FnOnce(&mut Link)) -> Link {
        let mut next = link.clone();
        next.last_synced_at = self.now;
        change(&mut next);
        next
    }

    fn save_link(&mut self, link: &Link, change: impl FnOnce(&mut Link)) {
        let next = self.next_link(link, change);
        if next.state != link.state || next.raven_item_id != link.raven_item_id {
            self.plan.actions.push(Action::SaveLink(next));
        }
    }

    fn delete_link(&mut self, link: &Link) {
        self.plan.actions.push(Action::DeleteLink {
            calendar_id: link.calendar_id.clone(),
            google_event_id: link.google_event_id.clone(),
        });
    }

    fn apply_guard(&mut self, total_links: u64) {
        let threshold = GUARD_MIN.max(total_links * GUARD_PERCENT / 100);
        let google_deletes = self.plan.counts.google_deleted;
        let raven_archives = self.plan.counts.raven_archived;
        if (google_deletes <= threshold && raven_archives <= threshold)
            || self.cfg.allow_mass_delete
        {
            return;
        }
        self.plan.actions.retain(|action| !action.is_mass_change());
        self.plan.counts.google_deleted = 0;
        self.plan.counts.raven_archived = 0;
        self.plan.guard = Some(GuardTrip {
            google_deletes,
            raven_archives,
            threshold,
        });
    }
}

#[cfg(test)]
mod tests;

//! End-to-end sync scenarios against the in-process fake Google (temp home only).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use time::{Date, OffsetDateTime, UtcOffset};
use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::{ProposeEvent, TodoService, UpdateItem};
use todo_engine::domain::{Actor, ItemStatus, ItemType, TodoItem};
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

use super::client::GoogleApiError;
use super::mapping::{EventTime, GEvent, GEventStatus, google_event_id_for};
use super::reconcile::{DELETED_REASON, Link, LinkState, SYNC_REASON};
use super::secret::Secret;
use super::storage::{self, SettingsUpdate, SyncDb};
use super::testing::{FakeGoogle, TEST_CLIENT_JSON};
use super::*;

const CAL: &str = "primary@example.test";
const REDIRECT: &str = "http://127.0.0.1:4321/__raven/google-calendar/callback";

fn seoul() -> UtcOffset {
    UtcOffset::from_hms(9, 0, 0).unwrap()
}

fn today() -> Date {
    OffsetDateTime::now_utc().to_offset(seoul()).date()
}

fn day(offset: i64) -> Date {
    today() + time::Duration::days(offset)
}

struct Env {
    _dir: tempfile::TempDir,
    home: PathBuf,
    todo_db: PathBuf,
    fake: FakeGoogle,
    gc: GoogleCalendar,
}

impl Env {
    fn new() -> Self {
        Self::with(|builder| builder)
    }

    fn with(customize: impl FnOnce(GoogleCalendarBuilder) -> GoogleCalendarBuilder) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let todo_db = home.join("todo.sqlite");
        init_schema(&connect(todo_db.to_str().unwrap()).unwrap()).unwrap();
        let fake = FakeGoogle::new();
        let gc = customize(fake.builder(&home, &todo_db)).build().unwrap();
        let client = dir.path().join("client.json");
        std::fs::write(&client, TEST_CLIENT_JSON).unwrap();
        gc.set_oauth_client(&client).unwrap();
        Self {
            _dir: dir,
            home,
            todo_db,
            fake,
            gc,
        }
    }

    /// A second runtime over the same home (no cached access token).
    fn fresh_runtime(&self) -> GoogleCalendar {
        self.fake
            .builder(&self.home, &self.todo_db)
            .build()
            .unwrap()
    }

    fn todo(&self) -> TodoService {
        TodoService::persistent(SqliteTodoRepository::new(
            connect(self.todo_db.to_str().unwrap()).unwrap(),
        ))
    }

    fn add_event(&self, title: &str, scheduled: &str) -> TodoItem {
        self.todo()
            .propose_event(ProposeEvent {
                title: title.into(),
                scheduled: Some(scheduled.into()),
                ..ProposeEvent::default()
            })
            .unwrap()
    }

    fn item(&self, id: &str) -> TodoItem {
        self.todo().get(id).unwrap()
    }

    fn events(&self) -> Vec<TodoItem> {
        self.todo()
            .list_items(ListFilter {
                item_type: Some(ItemType::Event),
                include_archived: true,
                ..ListFilter::default()
            })
            .unwrap()
    }

    fn by_title(&self, title: &str) -> Vec<TodoItem> {
        self.events()
            .into_iter()
            .filter(|item| item.title == title)
            .collect()
    }

    async fn connect(&self) {
        let start = self.gc.begin_connect(REDIRECT).unwrap();
        let state = state_of(&start.authorization_url);
        self.gc
            .complete_connect(&state, &Secret::new("good-code"))
            .await
            .unwrap();
    }

    async fn connected_with_calendar(&self) {
        self.connect().await;
        self.gc.select_calendar(CAL).await.unwrap();
    }

    async fn sync(&self) -> storage::LastSync {
        self.sync_with(SyncOptions::default()).await
    }

    async fn sync_with(&self, options: SyncOptions) -> storage::LastSync {
        self.gc
            .sync(Trigger::Api, options)
            .await
            .unwrap()
            .last_sync
            .unwrap()
    }

    fn links(&self) -> Vec<Link> {
        SyncDb::open_existing(self.gc.paths())
            .unwrap()
            .map(|db| db.repo().links(CAL).unwrap())
            .unwrap_or_default()
    }

    fn link_for(&self, google_id: &str) -> Link {
        self.links()
            .into_iter()
            .find(|link| link.google_event_id == google_id)
            .unwrap()
    }
}

fn state_of(url: &str) -> Secret {
    let url = reqwest::Url::parse(url).unwrap();
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .unwrap()
        .1
        .into_owned();
    Secret::new(state)
}

fn all_day(id: &str, summary: &str, date: Date) -> GEvent {
    let mut event = GEvent::new(id);
    event.summary = Some(summary.into());
    event.start = Some(EventTime::Date(date));
    event.end = Some(EventTime::Date(date + time::Duration::days(1)));
    event
}

fn timed(date: Date, hour: u8) -> String {
    format!("{date}T{hour:02}:00:00Z")
}

fn title(env: &Env, id: &str, title: &str) {
    env.todo()
        .update_item(
            id,
            UpdateItem {
                title: Some(title.into()),
                ..UpdateItem::default()
            },
        )
        .unwrap();
}

#[tokio::test]
async fn first_sync_both_directions_within_window_then_steady_state() {
    let env = Env::new();
    let status = env.gc.status().unwrap();
    assert!(status.configured);
    assert_eq!(status.connection, "disconnected");

    env.connect().await;
    let calendars = env.gc.list_calendars().await.unwrap();
    assert_eq!(
        calendars
            .calendars
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        [CAL]
    );
    assert_eq!(
        env.gc.sync(Trigger::Api, SyncOptions::default()).await,
        Err(GoogleCalendarError::CalendarNotSelected)
    );
    env.gc.select_calendar(CAL).await.unwrap();

    let pushed = env.add_event("Dentist", &timed(day(1), 1));
    env.add_event("Old Raven", &day(-10).to_string());
    let done = env.add_event("Done", &day(2).to_string());
    env.todo().complete(&done.id, None).unwrap();
    env.fake.put_event(CAL, all_day("g-lunch", "Lunch", day(2)));
    env.fake
        .put_event(CAL, all_day("g-old", "Old Google", day(-10)));
    let mut recurring = all_day("g-weekly", "Weekly", day(1));
    recurring.recurring = true;
    env.fake.put_event(CAL, recurring);

    let preview = env.gc.preview().await.unwrap();
    assert!(preview.first_sync);
    assert_eq!(preview.counts.google_created, 1);
    assert_eq!(preview.counts.raven_created, 1);
    assert_eq!(preview.counts.skipped_recurring, 1);
    assert_eq!(preview.counts.skipped_terminal, 1);
    assert!(!env.gc.paths().sync_db().exists(), "preview writes nothing");
    assert!(env.gc.status().unwrap().first_sync_pending);

    let run = env.sync().await;
    assert_eq!(run.outcome, "ok");
    assert_eq!(run.counts.google_created, 1);
    assert_eq!(run.counts.raven_created, 1);
    let google = env
        .fake
        .event(CAL, &google_event_id_for(&pushed.id))
        .unwrap();
    assert_eq!(google.summary.as_deref(), Some("Dentist"));
    assert_eq!(google.raven_item_id.as_deref(), Some(pushed.id.as_str()));
    match google.start.unwrap() {
        EventTime::DateTime { at, time_zone } => {
            assert_eq!(at.offset(), seoul());
            assert_eq!(time_zone.as_deref(), Some("Asia/Seoul"));
        }
        other => panic!("{other:?}"),
    }
    let lunch = env.by_title("Lunch");
    assert_eq!(lunch.len(), 1);
    assert_eq!(
        lunch[0].scheduled.as_deref(),
        Some(day(2).to_string().as_str())
    );
    assert_eq!(
        lunch[0].external_source().unwrap().id,
        format!("{CAL}/g-lunch")
    );
    assert!(env.by_title("Old Google").is_empty());
    assert_eq!(env.fake.live_events(CAL).len(), 4, "old raven not pushed");

    let status = env.gc.status().unwrap();
    assert!(!status.first_sync_pending);
    assert_eq!(status.settings.push_since, Some(day(-7).to_string()));
    assert_eq!(status.links.total, 2);

    let writes = env.fake.writes();
    let events = env.events().len();
    let run = env.sync().await;
    assert_eq!(run.outcome, "nothing_to_do");
    assert_eq!(env.fake.writes(), writes, "steady state writes nothing");
    assert_eq!(env.events().len(), events);
}

async fn synced() -> (Env, TodoItem) {
    let env = Env::new();
    env.connected_with_calendar().await;
    let pushed = env.add_event("Dentist", &timed(day(1), 1));
    env.fake.put_event(CAL, all_day("g-lunch", "Lunch", day(2)));
    assert_eq!(env.sync().await.outcome, "ok");
    (env, pushed)
}

#[tokio::test]
async fn edits_and_deletions_propagate_both_ways() {
    let (env, pushed) = synced().await;
    let google_id = google_event_id_for(&pushed.id);

    title(&env, &pushed.id, "Dentist (moved)");
    let run = env.sync().await;
    assert_eq!(run.counts.google_updated, 1);
    assert_eq!(
        env.fake.event(CAL, &google_id).unwrap().summary.as_deref(),
        Some("Dentist (moved)")
    );

    env.fake.edit_event(CAL, "g-lunch", |event| {
        event.summary = Some("Team lunch".into());
        event.description = Some("bring cards".into());
    });
    let run = env.sync().await;
    assert_eq!(run.counts.raven_updated, 1);
    let lunch = env.by_title("Team lunch");
    assert_eq!(lunch.len(), 1);
    assert_eq!(lunch[0].note.as_deref(), Some("bring cards"));
    // Echo suppression: our own writes do not bounce back.
    assert_eq!(env.sync().await.outcome, "nothing_to_do");

    env.todo().archive(&pushed.id, None).unwrap();
    let run = env.sync().await;
    assert_eq!(run.counts.google_deleted, 1);
    assert_eq!(
        env.fake.event(CAL, &google_id).unwrap().status,
        GEventStatus::Cancelled
    );

    env.fake.delete_event_as_user(CAL, "g-lunch");
    let run = env.sync().await;
    assert_eq!(run.counts.raven_archived, 1);
    assert_eq!(env.item(&lunch[0].id).status, ItemStatus::Archived);
    assert_eq!(env.sync().await.outcome, "nothing_to_do");
}

#[tokio::test]
async fn sync_writes_to_raven_are_attributed_to_system() {
    let (env, _) = synced().await;
    let lunch = env.by_title("Lunch").remove(0);
    env.fake.edit_event(CAL, "g-lunch", |event| {
        event.summary = Some("Team lunch".into());
    });
    assert_eq!(env.sync().await.counts.raven_updated, 1);
    env.fake.delete_event_as_user(CAL, "g-lunch");
    assert_eq!(env.sync().await.counts.raven_archived, 1);

    let audit: Vec<_> = SqliteTodoRepository::new(connect(env.todo_db.to_str().unwrap()).unwrap())
        .list_events_for_item(&lunch.id)
        .unwrap()
        .into_iter()
        .map(|event| (event.actor, event.action, event.reason))
        .collect();
    assert_eq!(
        audit,
        [
            (
                Actor::System,
                "propose_event".to_owned(),
                Some(SYNC_REASON.to_owned())
            ),
            (
                Actor::System,
                "update_item".to_owned(),
                Some(SYNC_REASON.to_owned())
            ),
            (
                Actor::System,
                "archive".to_owned(),
                Some(DELETED_REASON.to_owned())
            ),
        ]
    );
}

#[tokio::test]
async fn completed_event_freezes_link_and_ignores_google_edits() {
    let (env, pushed) = synced().await;
    let google_id = google_event_id_for(&pushed.id);
    env.todo().complete(&pushed.id, None).unwrap();
    env.sync().await;
    assert_eq!(
        env.fake.event(CAL, &google_id).unwrap().status,
        GEventStatus::Confirmed,
        "completed keeps the Google event"
    );
    assert_eq!(env.link_for(&google_id).state, LinkState::Frozen);

    env.fake.edit_event(CAL, &google_id, |event| {
        event.summary = Some("renamed on Google".into());
    });
    env.sync().await;
    assert_eq!(env.item(&pushed.id).title, "Dentist");
}

#[tokio::test]
async fn postpone_relinks_the_same_google_event_as_all_day() {
    let (env, pushed) = synced().await;
    let google_id = google_event_id_for(&pushed.id);
    let (_, follow_up) = env
        .todo()
        .postpone(&pushed.id, &day(3).to_string(), &today().to_string(), None)
        .unwrap();
    let before = env.fake.live_events(CAL).len();
    env.sync().await;
    assert_eq!(
        env.fake.live_events(CAL).len(),
        before,
        "no new Google event"
    );
    let event = env.fake.event(CAL, &google_id).unwrap();
    assert_eq!(event.start, Some(EventTime::Date(day(3))));
    assert_eq!(env.link_for(&google_id).raven_item_id, follow_up.id);
}

#[tokio::test]
async fn conflicting_edits_resolve_newer_wins() {
    let (env, pushed) = synced().await;
    let google_id = google_event_id_for(&pushed.id);
    title(&env, &pushed.id, "Raven title");
    std::thread::sleep(Duration::from_millis(5));
    env.fake.edit_event(CAL, &google_id, |event| {
        event.summary = Some("Google title".into());
    });
    let run = env.sync().await;
    assert_eq!(run.counts.conflicts, 1);
    assert_eq!(env.item(&pushed.id).title, "Google title");
    assert_eq!(
        env.fake.event(CAL, &google_id).unwrap().summary.as_deref(),
        Some("Google title")
    );
}

#[tokio::test]
async fn mass_delete_guard_trips_until_allowed() {
    let env = Env::new();
    env.connected_with_calendar().await;
    let items: Vec<_> = (0..12)
        .map(|n| env.add_event(&format!("Event {n}"), &day(1).to_string()))
        .collect();
    env.sync().await;
    for item in &items {
        env.todo().archive(&item.id, None).unwrap();
    }
    let run = env.sync().await;
    assert_eq!(run.outcome, "guard_tripped");
    assert_eq!(env.fake.live_events(CAL).len(), 12, "nothing deleted");
    let run = env
        .sync_with(SyncOptions {
            dry_run: false,
            allow_mass_delete: true,
        })
        .await;
    assert_eq!(run.counts.google_deleted, 12);
    assert!(env.fake.live_events(CAL).is_empty());
}

#[tokio::test]
async fn gone_sync_token_triggers_full_resync_with_get_confirmation() {
    let (env, pushed) = synced().await;
    env.fake.delete_event_as_user(CAL, "g-lunch");
    env.fake.expire_sync_tokens();
    let run = env.sync().await;
    assert_eq!(run.counts.raven_archived, 1);
    assert_eq!(env.by_title("Lunch")[0].status, ItemStatus::Archived);
    assert_eq!(env.item(&pushed.id).status, ItemStatus::Active);
    assert_eq!(
        env.link_for(&google_event_id_for(&pushed.id)).state,
        LinkState::Active
    );
    assert!(env.fake.lock().calls.contains(&"get_event"));
    assert_eq!(env.sync().await.outcome, "nothing_to_do");
}

#[tokio::test]
async fn invalid_grant_marks_reauth_required() {
    let (env, _) = synced().await;
    env.fake.lock().refresh_invalid = true;
    let gc = env.fresh_runtime();
    let report = gc.sync(Trigger::Api, SyncOptions::default()).await.unwrap();
    assert_eq!(report.last_sync.unwrap().outcome, "reauth_required");
    assert_eq!(gc.status().unwrap().connection, "reauth_required");
    assert_eq!(
        gc.sync(Trigger::Api, SyncOptions::default()).await,
        Err(GoogleCalendarError::ReauthRequired)
    );
    assert!(gc.scheduled_check().await.is_none());
}

#[tokio::test]
async fn crash_between_writes_never_duplicates() {
    let env = Env::new();
    env.connected_with_calendar().await;
    let item = env.add_event("Dentist", &day(1).to_string());
    env.fake.crash_after_next("insert_event");
    let run = env.sync().await;
    assert_eq!(run.outcome, "failed");
    assert_eq!(env.fake.live_events(CAL).len(), 1, "insert landed");
    assert!(env.links().is_empty(), "link not saved");

    env.fake.put_event(CAL, all_day("g-lunch", "Lunch", day(2)));
    let run = env.sync().await;
    assert_eq!(run.outcome, "ok");
    assert_eq!(env.fake.live_events(CAL).len(), 2);
    assert_eq!(env.by_title("Lunch").len(), 1);
    assert!(env.links().iter().any(|link| link.raven_item_id == item.id));

    // Lose every link and the sync token, as if the process died before saving them.
    let db = SyncDb::open(env.gc.paths()).unwrap();
    db.repo().forget_calendar(CAL).unwrap();
    drop(db);
    let run = env.sync().await;
    assert_eq!(run.counts.google_created, 0);
    assert_eq!(run.counts.raven_created, 0);
    assert_eq!(env.fake.live_events(CAL).len(), 2);
    assert_eq!(env.by_title("Lunch").len(), 1);
    assert_eq!(env.by_title("Dentist").len(), 1);
    assert_eq!(env.links().len(), 2, "re-adopted");
}

#[tokio::test]
async fn rate_limits_back_off_with_retry_after() {
    let slept = Arc::new(Mutex::new(Vec::new()));
    let recorded = slept.clone();
    let env = Env::with(move |builder| {
        builder.sleeper(Arc::new(move |duration| {
            recorded.lock().unwrap().push(duration);
            Box::pin(async {})
        }))
    });
    env.connected_with_calendar().await;
    env.add_event("Dentist", &day(1).to_string());
    env.fake.fail_next(
        "insert_event",
        GoogleApiError::RateLimited {
            retry_after: Some(Duration::from_secs(7)),
        },
    );
    let run = env.sync().await;
    assert_eq!(run.outcome, "ok");
    assert_eq!(*slept.lock().unwrap(), [Duration::from_secs(7)]);

    env.add_event("Second", &day(1).to_string());
    for _ in 0..MAX_RATE_LIMIT_ATTEMPTS {
        env.fake.fail_next(
            "insert_event",
            GoogleApiError::RateLimited { retry_after: None },
        );
    }
    let run = env.sync().await;
    assert_eq!(run.outcome, "failed");
    assert_eq!(run.error_kind.as_deref(), Some("rate_limited"));
    assert_eq!(
        env.sync().await.counts.google_created,
        1,
        "retried next pass"
    );
}

#[tokio::test]
async fn writes_per_pass_are_capped() {
    let env = Env::new();
    env.connected_with_calendar().await;
    for n in 0..(MAX_WRITES_PER_PASS + 5) {
        env.add_event(&format!("Event {n}"), &day(1).to_string());
    }
    let run = env.sync().await;
    assert_eq!(run.outcome, "partial");
    assert_eq!(run.counts.google_created as usize, MAX_WRITES_PER_PASS);
    let run = env.sync().await;
    assert_eq!(run.counts.google_created, 5);
    assert_eq!(run.outcome, "ok");
}

#[tokio::test]
async fn parked_inbound_event_is_retried_and_cleared() {
    let (env, _) = synced().await;
    let lunch = env.by_title("Lunch").remove(0);
    env.fake.delete_event_as_user(CAL, "g-lunch");
    // Also deliver it through pending_inbound (e.g. after an earlier Raven failure).
    let db = SyncDb::open(env.gc.paths()).unwrap();
    db.repo()
        .record_pending_failure(CAL, "g-lunch", "raven_conflict", OffsetDateTime::now_utc())
        .unwrap();
    drop(db);
    let run = env.sync().await;
    assert_eq!(run.counts.raven_archived, 1);
    assert_eq!(env.item(&lunch.id).status, ItemStatus::Archived);
    let db = SyncDb::open(env.gc.paths()).unwrap();
    assert!(db.repo().pending(CAL).unwrap().is_empty(), "cleared");
}

#[tokio::test]
async fn aborted_pass_keeps_inbound_deletions_for_the_next_pass() {
    let (env, _) = synced().await;
    let lunch = env.by_title("Lunch").remove(0);
    env.fake.delete_event_as_user(CAL, "g-lunch");
    // A precondition failure on an unrelated write must not lose the deletion.
    env.fake.fail_next("list_events", GoogleApiError::Server);
    let run = env.sync().await;
    assert_eq!(run.outcome, "failed");
    assert_eq!(run.error_kind.as_deref(), Some("server"));
    let run = env.sync().await;
    assert_eq!(run.counts.raven_archived, 1);
    assert_eq!(env.item(&lunch.id).status, ItemStatus::Archived);
}

#[tokio::test]
async fn changing_calendar_unlinks_without_deleting_google_events() {
    let (env, _) = synced().await;
    let status = env.gc.create_calendar("Raven").await.unwrap();
    let calendar = status.calendar.unwrap();
    assert_ne!(calendar.id, CAL);
    assert_eq!(calendar.summary.as_deref(), Some("Raven"));
    assert!(status.first_sync_pending);
    assert!(env.links().is_empty());
    assert_eq!(env.fake.live_events(CAL).len(), 2, "old calendar untouched");
    let run = env.sync().await;
    assert_eq!(
        run.counts.google_created, 2,
        "both Raven events pushed anew"
    );
    assert_eq!(env.fake.live_events(&calendar.id).len(), 2);
    assert_eq!(env.fake.live_events(CAL).len(), 2);
}

#[tokio::test]
async fn disconnect_revokes_and_keeps_or_forgets_links() {
    let (env, _) = synced().await;
    let status = env.gc.disconnect(false).await.unwrap();
    assert_eq!(status.connection, "disconnected");
    assert_eq!(env.fake.lock().revoked, 1);
    assert!(!env.gc.paths().token_file().exists());
    assert_eq!(status.links.total, 2);
    assert_eq!(
        env.gc.sync(Trigger::Api, SyncOptions::default()).await,
        Err(GoogleCalendarError::NotConnected)
    );
    env.connect().await;
    let status = env.gc.disconnect(true).await.unwrap();
    assert!(!env.gc.paths().sync_db().exists());
    assert!(status.first_sync_pending);
    assert_eq!(status.settings.calendar_id.as_deref(), Some(CAL));
}

#[tokio::test]
async fn connect_state_is_single_use_and_expires() {
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock = now.clone();
    let env = Env::with(move |builder| builder.monotonic(Arc::new(move || *clock.lock().unwrap())));
    let start = env.gc.begin_connect(REDIRECT).unwrap();
    assert!(
        start
            .authorization_url
            .starts_with("https://accounts.google.com/")
    );
    let state = state_of(&start.authorization_url);
    let code = Secret::new("good-code");
    env.gc.complete_connect(&state, &code).await.unwrap();
    assert_eq!(
        env.fake.lock().exchanged_redirect_uris,
        [REDIRECT.to_owned()]
    );
    assert_eq!(
        env.gc.complete_connect(&state, &code).await,
        Err(GoogleCalendarError::Validation { field: "state" })
    );

    let start = env.gc.begin_connect(REDIRECT).unwrap();
    *now.lock().unwrap() += CONNECT_TTL + Duration::from_secs(1);
    assert_eq!(
        env.gc
            .complete_connect(&state_of(&start.authorization_url), &code)
            .await,
        Err(GoogleCalendarError::Validation { field: "state" })
    );
    let url = format!("{REDIRECT}?error=access_denied&state=x");
    assert_eq!(
        env.gc.complete_connect_url(&url).await,
        Err(GoogleCalendarError::Validation { field: "code" })
    );
}

#[tokio::test]
async fn access_token_refreshes_sixty_seconds_before_expiry() {
    let now = Arc::new(Mutex::new(Instant::now()));
    let clock = now.clone();
    let env = Env::with(move |builder| builder.monotonic(Arc::new(move || *clock.lock().unwrap())));
    env.connected_with_calendar().await;
    assert_eq!(env.fake.lock().refreshes, 0, "exchange grant is cached");
    *now.lock().unwrap() +=
        Duration::from_secs(3600) - TOKEN_REFRESH_MARGIN - Duration::from_secs(1);
    env.gc.list_calendars().await.unwrap();
    assert_eq!(env.fake.lock().refreshes, 0);
    *now.lock().unwrap() += Duration::from_secs(2);
    env.gc.list_calendars().await.unwrap();
    assert_eq!(env.fake.lock().refreshes, 1);
}

#[tokio::test]
async fn unauthorized_call_refreshes_once_and_retries() {
    let (env, _) = synced().await;
    env.fake
        .fail_next("list_calendars", GoogleApiError::Unauthorized);
    env.gc.list_calendars().await.unwrap();
    assert_eq!(env.fake.lock().refreshes, 1);
}

#[tokio::test]
async fn scheduler_runs_only_after_first_sync_and_when_enabled() {
    let env = Env::new();
    env.connected_with_calendar().await;
    env.add_event("Dentist", &day(1).to_string());
    env.gc
        .update_settings(SettingsUpdate {
            enabled: Some(true),
            ..SettingsUpdate::default()
        })
        .unwrap();
    assert!(
        env.gc.scheduled_check().await.is_none(),
        "first sync pending"
    );
    env.sync().await;
    env.add_event("Later", &day(1).to_string());
    let report = env.gc.scheduled_check().await.unwrap();
    let run = report.last_sync.unwrap();
    assert_eq!(run.trigger, "scheduled");
    assert_eq!(run.counts.google_created, 1);

    let disabled = env
        .fake
        .builder(&env.home, &env.todo_db)
        .env_disabled(true)
        .build()
        .unwrap();
    assert!(disabled.scheduled_check().await.is_none());
    assert_eq!(disabled.status().unwrap().env_override, Some("disabled"));
    // Manual sync stays allowed under the kill switch.
    assert!(
        disabled
            .sync(Trigger::Cli, SyncOptions::default())
            .await
            .is_ok()
    );

    env.gc
        .update_settings(SettingsUpdate {
            enabled: Some(false),
            ..SettingsUpdate::default()
        })
        .unwrap();
    assert!(env.gc.scheduled_check().await.is_none());
}

#[tokio::test]
async fn sync_lock_rejects_concurrent_runs_but_not_dry_runs() {
    let (env, _) = synced().await;
    let _lock = storage::try_lock(env.gc.paths()).unwrap().unwrap();
    assert_eq!(
        env.gc.sync(Trigger::Api, SyncOptions::default()).await,
        Err(GoogleCalendarError::SyncInProgress)
    );
    let report = env
        .gc
        .sync(
            Trigger::Api,
            SyncOptions {
                dry_run: true,
                allow_mass_delete: false,
            },
        )
        .await
        .unwrap();
    assert!(report.dry_run);
}

#[tokio::test]
async fn not_configured_and_not_connected_are_reported() {
    let env = Env::new();
    std::fs::remove_file(env.gc.paths().oauth_client_file()).unwrap();
    assert!(!env.gc.status().unwrap().configured);
    assert_eq!(
        env.gc.begin_connect(REDIRECT).unwrap_err(),
        GoogleCalendarError::NotConfigured
    );
    assert_eq!(
        env.gc.preview().await,
        Err(GoogleCalendarError::NotConfigured)
    );
    let env = Env::new();
    assert_eq!(
        env.gc.list_calendars().await,
        Err(GoogleCalendarError::NotConnected)
    );
}

#[tokio::test]
async fn logs_never_contain_titles_tokens_or_ids() {
    use tracing_subscriber::fmt::MakeWriter;

    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);
    impl std::io::Write for Capture {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl<'a> MakeWriter<'a> for Capture {
        type Writer = Capture;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    async fn scenario() -> (Env, TodoItem) {
        let (env, pushed) = synced().await;
        env.fake.expire_sync_tokens();
        env.sync().await;
        env.gc.disconnect(false).await.unwrap();
        (env, pushed)
    }
    // With a single registered dispatcher tracing-core computes callsite interest from
    // whichever thread registers the callsite (other tests run without a subscriber),
    // which can hide events from this scoped subscriber. A second live dispatcher makes
    // interest consider every registered dispatcher.
    let _second = tracing::Dispatch::new(tracing_subscriber::registry());
    let capture = Capture::default();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_max_level(tracing::Level::DEBUG)
        .with_writer(capture.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    tracing::callsite::rebuild_interest_cache();
    let (_env, pushed) = scenario().await;
    let logs = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
    for event in [
        "google_calendar_connected",
        "google_calendar_sync_started",
        "google_calendar_sync_completed",
        "google_calendar_full_resync",
        "google_calendar_disconnected",
    ] {
        assert!(logs.contains(event), "{event}");
    }
    for secret in [
        "Dentist",
        "Lunch",
        "fake-refresh-token",
        "fake-access",
        "good-code",
        "test-client-secret",
        CAL,
        pushed.id.as_str(),
    ] {
        assert!(!logs.contains(secret), "{secret} leaked");
    }
}

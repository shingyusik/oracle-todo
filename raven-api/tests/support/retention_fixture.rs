//! Synthetic Raven home seeded with archived records on both sides of a 30-day cutoff.
//! Shared by raven-api unit/integration tests and raven-cli tests via `#[path]`.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use health_engine::application::commands::{CreateDietEntry, CreateHealthEvent, MediaUpload};
use health_engine::application::service::HealthService;
use health_engine::domain::{BowelAttributes, HealthEventDetails, MealType};
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{TransferCommand, TransferOperationKey};
use ledger_engine::domain::{EntryType, Money, TransactionCategoryKind};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use rusqlite::{Connection, params};
use time::format_description::well_known::Rfc3339;
use time::macros::datetime;
use time::{Duration, OffsetDateTime};

pub const PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 10, b'I', b'D', b'A', b'T',
    0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4, 0, 0, 0, 0, b'I', b'E', b'N',
    b'D', 0xae, 0x42, 0x60, 0x82,
];

/// Synthetic record titles; captured logs must never contain them.
pub const SECRET_TITLES: [&str; 4] = [
    "synthetic-old-task",
    "synthetic-old-lunch",
    "synthetic-old-transfer",
    "synthetic-old-toast",
];

pub struct FixtureHome {
    pub dir: tempfile::TempDir,
    pub home: PathBuf,
}

impl FixtureHome {
    /// An empty home: no stores exist.
    pub fn empty() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        Self { dir, home }
    }

    /// A home with all three stores and the media directory initialized.
    pub fn initialized() -> Self {
        let fixture = Self::empty();
        let conn =
            todo_engine::infrastructure::sqlite::connect(fixture.todo_db().to_str().unwrap())
                .unwrap();
        todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();
        drop(conn);
        SqliteLedgerRepository::open(fixture.ledger_db()).unwrap();
        SqliteHealthRepository::open(fixture.health_db()).unwrap();
        LocalMediaStore::new(fixture.media_dir()).unwrap();
        fixture
    }

    pub fn todo_db(&self) -> PathBuf {
        self.home.join("todo.sqlite")
    }

    pub fn ledger_db(&self) -> PathBuf {
        self.home.join("ledger.sqlite")
    }

    pub fn health_db(&self) -> PathBuf {
        self.home.join("health.sqlite")
    }

    pub fn media_dir(&self) -> PathBuf {
        self.home.join("media/health")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.home.join("backups/retention")
    }

    pub fn backup_names(&self) -> Vec<String> {
        let mut names = match std::fs::read_dir(self.backups_dir()) {
            Ok(entries) => entries
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .filter(|name| !name.starts_with('.'))
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        };
        names.sort();
        names
    }
}

pub fn rfc3339(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap()
}

pub fn days_ago(days: i64) -> String {
    rfc3339(OffsetDateTime::now_utc() - Duration::days(days))
}

/// Health's canonical persisted UTC timestamp shape.
pub fn health_days_ago(days: i64) -> String {
    (OffsetDateTime::now_utc() - Duration::days(days))
        .format(time::macros::format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:9]Z"
        ))
        .unwrap()
}

/// Ids of the seeded records.
#[derive(Debug, Default)]
pub struct Seeded {
    pub todo_old: Vec<String>,
    pub todo_young: Vec<String>,
    pub ledger_old_entry: String,
    pub ledger_young_entry: String,
    pub ledger_old_transfer: String,
    pub health_old_diet: String,
    pub health_old_media: String,
    pub health_old_media_path: PathBuf,
    pub health_old_bowel: String,
    pub health_young_diet: String,
}

/// Old = archived 40 days ago, young = 10 days ago (Ledger: archived now, so its
/// audit snapshot stays consistent for `doctor`). Expected purge with 30 days:
/// todo_item=2, ledger_entry=1, ledger_transfer=1, health_diet=1, health_bowel=1, health_media=1.
pub fn seed(fixture: &FixtureHome) -> Seeded {
    let mut seeded = Seeded::default();
    seed_todo(fixture, &mut seeded);
    seed_ledger(fixture, &mut seeded);
    seed_health(fixture, &mut seeded);
    seeded
}

fn seed_todo(fixture: &FixtureHome, seeded: &mut Seeded) {
    let conn = Connection::open(fixture.todo_db()).unwrap();
    let rows = [
        (
            "00000000-0000-4000-8000-000000000001",
            "synthetic-old-task",
            "archived",
            40,
        ),
        (
            "00000000-0000-4000-8000-000000000002",
            "synthetic-old-dropped",
            "dropped",
            45,
        ),
        (
            "00000000-0000-4000-8000-000000000003",
            "synthetic-young",
            "archived",
            10,
        ),
        (
            "00000000-0000-4000-8000-000000000004",
            "synthetic-done",
            "completed",
            90,
        ),
    ];
    for (id, title, status, days) in rows {
        let at = days_ago(days);
        conn.execute(
            "INSERT INTO items (id, type, title, status, materialization_policy,
                future_occurrences, proposed_by, archived_at, metadata, created_at, updated_at)
             VALUES (?1, 'task', ?2, ?3, 'per_occurrence', 3, 'user', ?4, '{}', ?5, ?4)",
            params![id, title, status, at, days_ago(400)],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO events (id, at, actor, action, object_type, object_id, before, after, reason)
             VALUES (?1, ?2, 'user', 'create', 'task', ?3, NULL, '{\"title\":\"x\"}', NULL)",
            params![format!("{id}-ev"), days_ago(400), id],
        )
        .unwrap();
        if status == "archived" || status == "dropped" {
            if days > 30 {
                seeded.todo_old.push(id.to_owned());
            } else {
                seeded.todo_young.push(id.to_owned());
            }
        }
    }
}

fn ledger_entry(content: &str) -> CreateEntry {
    CreateEntry {
        date: "2026-07-30".into(),
        written_at: datetime!(2026-07-30 09:10:11 UTC),
        content: content.into(),
        category: Some("Food".into()),
        account: "Wallet".into(),
        entry_type: EntryType::Expense,
        amount: Money::from_minor_units(12_500),
        currency: "KRW".into(),
        transfer_group: None,
        source: "test".into(),
        notes: None,
        actor: "tester".into(),
    }
}

fn seed_ledger(fixture: &FixtureHome, seeded: &mut Seeded) {
    let path = fixture.ledger_db();
    let mut service = LedgerService::new(SqliteLedgerRepository::open(&path).unwrap());
    let currency = service
        .create_currency(CreateCurrency {
            code: "KRW".into(),
            name: "Korean won".into(),
            symbol: "W".into(),
            decimal_places: 0,
            actor: "seed".into(),
        })
        .unwrap();
    let category = service
        .create_account_category(CreateAccountCategory {
            name: "Cash".into(),
            parent: None,
            liability: false,
            actor: "seed".into(),
        })
        .unwrap();
    for name in ["Wallet", "Savings"] {
        service
            .create_account(CreateAccount {
                name: name.into(),
                category: category.id().to_string(),
                currency: currency.id().to_string(),
                opening_balance: Money::from_minor_units(100_000),
                purpose: None,
                actor: "seed".into(),
            })
            .unwrap();
    }
    service
        .create_category(CreateTransactionCategory {
            name: "Food".into(),
            parent: None,
            kind: TransactionCategoryKind::Expense,
            actor: "seed".into(),
        })
        .unwrap();
    let old = service
        .create_entry(ledger_entry("synthetic-old-lunch"))
        .unwrap();
    let young = service
        .create_entry(ledger_entry("synthetic-young-lunch"))
        .unwrap();
    service
        .create_entry(ledger_entry("synthetic-active"))
        .unwrap();
    service.archive_entry(old.id()).unwrap();
    service.archive_entry(young.id()).unwrap();
    let transfer = service
        .transfer(TransferCommand {
            operation_key: TransferOperationKey::generate(),
            date: "2026-07-30".into(),
            written_at: datetime!(2026-07-30 10:11:12 UTC),
            content: "synthetic-old-transfer".into(),
            from_account: "Wallet".into(),
            to_account: "Savings".into(),
            amount: Money::from_minor_units(50_000),
            currency: "KRW".into(),
            source: "test".into(),
            notes: None,
            actor: "tester".into(),
        })
        .unwrap();
    let group = transfer.transfer_group_id.clone();
    service.archive_entry(&transfer.out_entry_id).unwrap();
    drop(service);
    let conn = Connection::open(&path).unwrap();
    let old_at = days_ago(40);
    conn.execute(
        "UPDATE ledger_entries SET deleted_at = ?2, updated_at = ?2, created_at = ?2 WHERE id = ?1",
        params![old.id(), old_at],
    )
    .unwrap();
    conn.execute(
        "UPDATE ledger_entries SET deleted_at = ?2, updated_at = ?2, created_at = ?2
         WHERE transfer_group_id = ?1",
        params![group, old_at],
    )
    .unwrap();
    seeded.ledger_old_entry = old.id().to_string();
    seeded.ledger_young_entry = young.id().to_string();
    seeded.ledger_old_transfer = group;
}

fn seed_health(fixture: &FixtureHome, seeded: &mut Seeded) {
    let mut service = HealthService::new(
        SqliteHealthRepository::open(fixture.health_db()).unwrap(),
        LocalMediaStore::new(fixture.media_dir()).unwrap(),
    );
    let diet = |food: &str, photo: bool| CreateDietEntry {
        occurred_at: datetime!(2026-07-30 12:00:00 +09:00),
        meal_type: MealType::Lunch,
        food_name: food.to_string(),
        note: None,
        tags: vec!["synthetic-tag".to_string()],
        media: photo.then(|| MediaUpload::new("image/png", PNG)),
        actor: "integration-test".to_string(),
    };
    let old = service
        .create_diet(diet("synthetic-old-toast", true))
        .unwrap();
    let young = service
        .create_diet(diet("synthetic-young-toast", false))
        .unwrap();
    let bowel = service
        .create_event(CreateHealthEvent {
            occurred_at: datetime!(2026-07-30 09:00:00 +09:00),
            details: HealthEventDetails::Bowel(BowelAttributes::new(4, false).unwrap()),
            note: None,
            actor: "integration-test".to_string(),
        })
        .unwrap();
    service.archive_diet(old.id().as_str()).unwrap();
    service.archive_diet(young.id().as_str()).unwrap();
    service.archive_event(bowel.id().as_str()).unwrap();
    let media_id = old.media_id().unwrap().as_str().to_string();
    seeded.health_old_media_path = service
        .get_media(&media_id)
        .unwrap()
        .relative_path()
        .to_path_buf();
    drop(service);
    let conn = Connection::open(fixture.health_db()).unwrap();
    for (table, id, days) in [
        ("diet_entries", old.id().as_str(), 40),
        ("diet_entries", young.id().as_str(), 10),
        ("health_events", bowel.id().as_str(), 40),
    ] {
        conn.execute(
            &format!(
                "UPDATE {table} SET deleted_at = ?2, updated_at = ?2, created_at = ?2 WHERE id = ?1"
            ),
            params![id, health_days_ago(days)],
        )
        .unwrap();
    }
    seeded.health_old_diet = old.id().as_str().to_string();
    seeded.health_young_diet = young.id().as_str().to_string();
    seeded.health_old_bowel = bowel.id().as_str().to_string();
    seeded.health_old_media = media_id;
}

pub fn count(db: &Path, sql: &str, value: &str) -> i64 {
    Connection::open(db)
        .unwrap()
        .query_row(sql, [value], |row| row.get(0))
        .unwrap()
}

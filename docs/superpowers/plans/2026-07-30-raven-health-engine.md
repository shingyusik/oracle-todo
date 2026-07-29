# Raven Health Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-user Rust Health Journal engine for diet, images, bowel, medication, weight, sleep, lab, symptoms, daily upsert, timelines, and trends.

**Architecture:** `health-engine` owns typed health policy and a separate `health.sqlite`. Common health events use typed core columns plus validated category attributes; diet tags and media metadata use normalized tables and files under `media/health`.

**Tech Stack:** Rust 2024, rusqlite 0.32 bundled, serde, time, uuid, sha2, infer/image MIME validation, thiserror, tempfile

## Global Constraints

- Requires the Raven foundation plan and `RavenPaths::health_db()/health_media_dir()`.
- Port behavior from `shingyusik/personal-health-tracker` commit
  `18e268124b398a83a27c395b6854e122f0c86625`; do not follow a moving branch.
- Raven is single-user; no tenant IDs or remote-auth concepts enter domain tables.
- Images are JPEG/PNG/WebP, generated-path only, default maximum 10 MiB, SQLite metadata rather than blobs.
- Category policy: Bristol 1–7, sleep `0 < hours <= 24`, symptom/condition integer 1–10, positive medication dose and weight.
- Daily upsert identity is local date plus category plus stable `metric_key`.
- Archive/restore/purge applies to Health records and always writes audit history.
- Correlation output is descriptive and uses the following 24-hour window.

---

### Task 1: Health domain model and validation

**Files:**
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Create: `health-engine/Cargo.toml`
- Create: `health-engine/src/lib.rs`
- Create: `health-engine/src/domain/mod.rs`
- Create: `health-engine/src/domain/diet.rs`
- Create: `health-engine/src/domain/event.rs`
- Create: `health-engine/src/domain/media.rs`
- Create: `health-engine/tests/unit.rs`
- Create: `health-engine/tests/unit/diet.rs`
- Create: `health-engine/tests/unit/event.rs`

**Interfaces:**
- Produces: `MealType`, `DietEntry`, `HealthCategory`, `HealthEvent`, `MedicationUnit`, and category-specific validated attributes.
- Consumes: no storage or HTTP types.

- [ ] **Step 1: Write failing validation tests**

```rust
#[test]
fn normalizes_diet_tags_and_meal_types() {
    assert_eq!(
        normalize_tags([" Coffee ", "coffee", "WHEAT"]),
        vec!["coffee", "wheat"],
    );
    assert_eq!("late_night".parse::<MealType>().unwrap(), MealType::LateNight);
}

#[test]
fn validates_bowel_sleep_and_medication() {
    assert!(BowelAttributes::new(4, false).is_ok());
    assert!(BowelAttributes::new(8, false).is_err());
    assert!(SleepValue::hours(24.0).is_ok());
    assert!(SleepValue::hours(24.1).is_err());
    assert!(MedicationAttributes::new("Medicine", 1.0, MedicationUnit::Tablet).is_ok());
}
```

- [ ] **Step 2: Run unit tests**

Run: `cargo test -p health-engine --test unit`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement pure domain types**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthCategory { Weight, Bowel, Sleep, Lab, Symptom, Medication }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HealthEvent {
    pub id: String,
    pub occurred_at: OffsetDateTime,
    pub category: HealthCategory,
    pub metric_key: String,
    pub name: String,
    pub value_num: Option<f64>,
    pub unit: Option<String>,
    pub note: Option<String>,
    pub attributes: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub deleted_at: Option<OffsetDateTime>,
}
```

Represent allowed medication units as an enum:
`tablet`, `capsule`, `packet`, `mg`, `g`, `ml`, `drop`, `dose`. Validate finite
numbers, required names/metric keys, and bounded values without I/O.

- [ ] **Step 4: Run domain tests**

Run: `cargo test -p health-engine --test unit && cargo fmt --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock health-engine
git commit -m "[ADD] Define Raven Health domain" -m "- 식단·건강 이벤트와 카테고리별 값 규칙 정의
- 태그 정규화와 복약 단위 계약 추가"
```

### Task 2: Health schema and repository

**Files:**
- Create: `health-engine/src/application/mod.rs`
- Create: `health-engine/src/application/error.rs`
- Create: `health-engine/src/application/ports.rs`
- Create: `health-engine/src/infrastructure/mod.rs`
- Create: `health-engine/src/infrastructure/sqlite/mod.rs`
- Create: `health-engine/src/infrastructure/sqlite/schema.rs`
- Create: `health-engine/src/infrastructure/sqlite/mapping.rs`
- Create: `health-engine/src/infrastructure/sqlite/repository.rs`
- Create: `health-engine/tests/integration.rs`
- Create: `health-engine/tests/integration/schema.rs`
- Create: `health-engine/tests/integration/repository.rs`

**Interfaces:**
- Produces: `HealthRepository`, `HealthTransaction`, and `SqliteHealthRepository`.
- Consumes: Task 1 domain models.

- [ ] **Step 1: Write failing schema tests**

```rust
#[test]
fn creates_health_tables_and_daily_metric_index() {
    let repo = SqliteHealthRepository::open_in_memory().unwrap();
    for table in ["diet_entries", "diet_tags", "diet_entry_tags",
                  "health_events", "media_files", "audit_events"] {
        assert!(repo.table_exists_for_test(table).unwrap(), "missing {table}");
    }
    assert!(repo.index_exists_for_test("uq_health_daily_metric").unwrap());
}
```

- [ ] **Step 2: Run schema tests**

Run: `cargo test -p health-engine --test integration schema`

Expected: FAIL because infrastructure is absent.

- [ ] **Step 3: Implement additive schema**

Create the six tables with foreign keys and indexes for occurrence time,
category, metric key, deleted state, tag name, and media checksum.
`media_files` includes `cleanup_pending` so a committed domain purge can retry
byte deletion without losing the relative path. Enforce the
active daily uniqueness rule with a partial index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_daily_metric
ON health_events(local_date, category, metric_key)
WHERE deleted_at IS NULL AND daily_upsert = 1;
```

The repository stores UTC timestamps plus the derived configured local date.
It enables foreign keys and uses immediate transactions for writes.

- [ ] **Step 4: Run repository tests**

Run: `cargo test -p health-engine --test integration`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add health-engine
git commit -m "[ADD] Persist Raven Health records" -m "- 식단·이벤트·태그·미디어·감사 SQLite 스키마 추가
- 일일 지표 중복 방지와 additive 초기화 보장"
```

### Task 3: Diet and media service

**Files:**
- Create: `health-engine/src/application/commands.rs`
- Create: `health-engine/src/application/service.rs`
- Create: `health-engine/src/application/diet.rs`
- Create: `health-engine/src/application/media.rs`
- Create: `health-engine/src/infrastructure/media.rs`
- Test: `health-engine/tests/integration/diet.rs`
- Test: `health-engine/tests/integration/media.rs`

**Interfaces:**
- Produces: `HealthService`, `CreateDietEntry`, `UpdateDietEntry`, `MediaStore`, and `StoredMedia`.
- Consumes: `HealthRepository` and configured media directory/size limit.

- [ ] **Step 1: Write failing diet/media tests**

```rust
#[test]
fn creates_diet_with_deduplicated_tags_and_audit() {
    let mut service = service();
    let entry = service.create_diet(create_diet(["coffee", " Coffee "])).unwrap();
    assert_eq!(entry.tags, vec!["coffee"]);
    assert_eq!(service.audit_for(&entry.id).unwrap().len(), 1);
}

#[test]
fn rejects_non_image_and_oversized_upload() {
    let mut service = service_with_limit(8);
    assert!(matches!(
        service.store_media("text/plain", b"not-image"),
        Err(HealthError::UnsupportedMedia)
    ));
}
```

- [ ] **Step 2: Run focused tests**

Run: `cargo test -p health-engine --test integration diet && cargo test -p health-engine --test integration media`

Expected: FAIL because service/media ports are absent.

- [ ] **Step 3: Implement diet and safe local media**

```rust
pub trait MediaStore {
    fn stage(&self, content_type: &str, bytes: &[u8]) -> HealthResult<StagedMedia>;
    fn finalize(&self, staged: StagedMedia) -> HealthResult<StoredMedia>;
    fn remove(&self, relative_path: &Path) -> HealthResult<()>;
}
```

Validate MIME against bytes, hash with SHA-256, generate a UUID filename,
prevent path traversal, and write through a temporary file. Finalize before
the database transaction; remove the finalized file if metadata/audit commit
fails. Diet creation links normalized tags and optional media metadata in one
transaction.

- [ ] **Step 4: Run diet/media tests**

Run: `cargo test -p health-engine --test integration diet && cargo test -p health-engine --test integration media`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add health-engine
git commit -m "[ADD] Add Health diet and media service" -m "- 식단 태그와 감사 기록을 원자적으로 저장
- 이미지 형식·크기·경로 검증과 실패 정리 구현"
```

### Task 4: Health events and daily upsert

**Files:**
- Create: `health-engine/src/application/events.rs`
- Modify: `health-engine/src/application/service.rs`
- Modify: `health-engine/src/application/commands.rs`
- Modify: `health-engine/src/application/ports.rs`
- Modify: `health-engine/src/infrastructure/sqlite/repository.rs`
- Test: `health-engine/tests/integration/events.rs`
- Test: `health-engine/tests/integration/daily_upsert.rs`

**Interfaces:**
- Produces: `CreateHealthEvent`, `UpdateHealthEvent`, `DailyMetricInput`, and `upsert_daily_metrics`.
- Consumes: validated Task 1 category types and repository transaction.

- [ ] **Step 1: Write failing event/upsert tests**

```rust
#[test]
fn daily_weight_upsert_updates_instead_of_duplicating() {
    let mut service = service();
    service.upsert_daily_metrics(vec![weight("2026-07-30", 68.2)]).unwrap();
    service.upsert_daily_metrics(vec![weight("2026-07-30", 67.9)]).unwrap();
    let rows = service.list_metrics(metric_query("weight")).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].value_num, Some(67.9));
}

#[test]
fn validates_every_supported_category() {
    assert!(service().create_event(bowel(4, false)).is_ok());
    assert!(service().create_event(condition(11)).is_err());
    assert!(service().create_event(medication("", 1.0, "tablet")).is_err());
}
```

- [ ] **Step 2: Run event tests**

Run: `cargo test -p health-engine --test integration events && cargo test -p health-engine --test integration daily_upsert`

Expected: FAIL because event service methods are absent.

- [ ] **Step 3: Implement category commands and batch transaction**

```rust
pub fn upsert_daily_metrics(
    &mut self,
    inputs: Vec<DailyMetricInput>,
) -> HealthResult<Vec<HealthEvent>> {
    let validated = inputs.into_iter().map(ValidatedDailyMetric::try_from)
        .collect::<HealthResult<Vec<_>>>()?;
    self.repository.transaction(|tx| {
        validated.into_iter().map(|metric| tx.upsert_daily_metric(metric))
            .collect()
    })
}
```

Validate the full batch before writing. Upsert weight, sleep, lab, and overall
condition by local date/category/metric key and add one audit event per changed
record with a shared request ID.

- [ ] **Step 4: Run the Health suite**

Run: `cargo test -p health-engine`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add health-engine
git commit -m "[ADD] Add Health events and daily upsert" -m "- 배변·복약·체중·수면·검사·증상 정책 구현
- 일일 지표 배치 검증과 중복 없는 갱신 보장"
```

### Task 5: Health lifecycle, Timeline, and Trends

**Files:**
- Create: `health-engine/src/application/lifecycle.rs`
- Create: `health-engine/src/application/queries.rs`
- Create: `health-engine/src/application/trends.rs`
- Modify: `health-engine/src/application/service.rs`
- Test: `health-engine/tests/integration/lifecycle.rs`
- Test: `health-engine/tests/integration/timeline.rs`
- Test: `health-engine/tests/integration/trends.rs`

**Interfaces:**
- Produces: archive/restore/purge for diet/events, `TimelineItem`, `HealthQuery`, and `HealthTrends`.
- Consumes: active records by default and archived records only when requested.

- [ ] **Step 1: Write failing lifecycle and trend tests**

```rust
#[test]
fn possible_reaction_counts_symptoms_in_following_24_hours_only() {
    let service = service_with_diet_and_symptoms();
    let trends = service.trends(30).unwrap();
    assert_eq!(trends.possible_tag_reactions[0].tag, "coffee");
    assert_eq!(trends.possible_tag_reactions[0].events_within_24h, 1);
}

#[test]
fn purge_keeps_audit_and_schedules_orphan_media_cleanup() {
    let mut service = service_with_diet_image();
    let id = service.first_diet_id();
    service.purge_diet(&id, &id).unwrap();
    assert!(service.audit_for(&id).unwrap().iter().any(|event| event.action == "purge"));
}
```

- [ ] **Step 2: Run focused tests**

Run: `cargo test -p health-engine --test integration lifecycle && cargo test -p health-engine --test integration timeline && cargo test -p health-engine --test integration trends`

Expected: FAIL because lifecycle/read projections are absent.

- [ ] **Step 3: Implement projections and cleanup-safe purge**

Build Timeline as a stable descending merge of diet and health events. Trends
returns top tags, bowel averages by day, symptom/medication frequencies,
weight/sleep/lab/condition series, and 24-hour descriptive correlations.
Archive/restore changes `deleted_at`; purge commits audit and row deletion
before attempting file removal. Mark the associated `media_files` row
`cleanup_pending = 1`, remove the bytes after commit, and delete the media row
only after successful byte removal. Startup retries pending rows.

```rust
impl<R: HealthRepository, M: MediaStore> HealthService<R, M> {
    pub fn timeline(&self, query: HealthQuery) -> HealthResult<Vec<TimelineItem>>;
    pub fn trends(&self, days: u16) -> HealthResult<HealthTrends>;
    pub fn archive_diet(&mut self, id: &str) -> HealthResult<DietEntry>;
    pub fn restore_diet(&mut self, id: &str) -> HealthResult<DietEntry>;
    pub fn purge_diet(&mut self, id: &str, confirmation: &str) -> HealthResult<()>;
}
```

- [ ] **Step 4: Run all Health tests and clippy**

Run: `cargo test -p health-engine && cargo clippy -p health-engine --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add health-engine
git commit -m "[ADD] Add Health lifecycle and trends" -m "- Timeline과 건강·식단 추세 투영 추가
- archive·restore·확인형 purge 및 미디어 정리 재시도 구현"
```

### Task 6: Raven Health CLI

**Files:**
- Modify: `raven-cli/Cargo.toml`
- Modify: `raven-cli/src/cli.rs`
- Modify: `raven-cli/src/commands/mod.rs`
- Create: `raven-cli/src/commands/health.rs`
- Modify: `raven-cli/src/commands/init.rs`
- Test: `raven-cli/tests/health_cli.rs`

**Interfaces:**
- Produces: `raven health diet|bowel|medication|metric|timeline|trends`.
- Consumes: `HealthService<SqliteHealthRepository, LocalMediaStore>`.

- [ ] **Step 1: Write failing CLI round-trip tests**

```rust
#[test]
fn health_diet_add_and_timeline_json_round_trip() {
    let home = tempfile::tempdir().unwrap();
    raven(home.path()).args([
        "health", "diet", "add", "--at", "2026-07-30T12:30:00+09:00",
        "--meal", "lunch", "--food", "Bibimbap", "--tags", "wheat,spicy",
    ]).assert().success();
    raven(home.path()).args(["health", "timeline", "--format", "json"])
        .assert().success().stdout(predicate::str::contains("\"meal_type\":\"lunch\""));
}
```

- [ ] **Step 2: Run the CLI test**

Run: `cargo test -p raven-cli --test health_cli`

Expected: FAIL because the Health command is absent.

- [ ] **Step 3: Add structured subcommands**

Map clap inputs to application commands for each record type. Support
`--json`, table/JSON reads, archive/restore/purge confirmation, image file
input, and stable exit mapping. Extend `raven init`/`health-check` to initialize
and inspect `health.sqlite` plus the media directory.

```rust
#[derive(Debug, Subcommand)]
pub enum HealthCommand {
    Diet { #[command(subcommand)] command: DietCommand },
    Bowel { #[command(subcommand)] command: BowelCommand },
    Medication { #[command(subcommand)] command: MedicationCommand },
    Metric { #[command(subcommand)] command: MetricCommand },
    Timeline(TimelineArgs),
    Trends(TrendsArgs),
}
```

- [ ] **Step 4: Run Health and Raven gates**

Run: `cargo test -p health-engine && cargo test -p raven-cli --test health_cli && cargo fmt --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.lock raven-cli health-engine
git commit -m "[ADD] Expose Health Journal through Raven CLI" -m "- 식단·배변·복약·지표·Timeline·Trends 명령 추가
- Raven init과 health-check에 health.sqlite와 미디어 경로 연결"
```

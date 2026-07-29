# Raven Ledger Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a policy-enforced Rust Ledger engine with integer money, master data, atomic transfers, audit history, reversible deletion, reports, and structured Raven CLI commands.

**Architecture:** `ledger-engine` follows domain/application/infrastructure boundaries and adapts the proven Rust SQLite behavior from `moneymanager-chat-ledger`. `LedgerService<R: LedgerRepository>` owns every mutation; `SqliteLedgerRepository` persists to `ledger.sqlite`.

**Tech Stack:** Rust 2024, rusqlite 0.32 bundled, serde, time, uuid, thiserror, clap, tempfile

## Global Constraints

- Requires the Raven foundation plan and `RavenPaths::ledger_db()`.
- Port behavior from `shingyusik/moneymanager-chat-ledger` commit
  `1d5ce2f6bf72526a1c232eab0f40907cc45c37ad`; do not follow a moving branch.
- Amount columns use integer minor units; SQLite `REAL` is forbidden for money.
- Transfer rows are created only as one atomic pair.
- New entries receive engine-generated UUIDs; caller-supplied create IDs are rejected.
- Archive is reversible; purge requires exact record confirmation and preserves audit history.
- CLI input is explicit flags or `--json`; no natural-language parsing or rejected-chat storage.
- All writes and their `audit_events` row commit in one transaction.

---

### Task 1: Ledger domain types and money conversion

**Files:**
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Create: `ledger-engine/Cargo.toml`
- Create: `ledger-engine/src/lib.rs`
- Create: `ledger-engine/src/domain/mod.rs`
- Create: `ledger-engine/src/domain/money.rs`
- Create: `ledger-engine/src/domain/entry.rs`
- Create: `ledger-engine/src/domain/refs.rs`
- Test: `ledger-engine/tests/unit.rs`
- Create: `ledger-engine/tests/unit/money.rs`
- Create: `ledger-engine/tests/unit/model.rs`

**Interfaces:**
- Produces: `Money::parse(decimal, decimal_places)`, `EntryType`, `LedgerEntry`, `Currency`, `AccountCategory`, `Account`, and `TransactionCategory`.
- Consumes: no database or CLI types.

- [ ] **Step 1: Write failing domain tests**

```rust
#[test]
fn parses_krw_and_decimal_currency_without_floats() {
    assert_eq!(Money::parse("12000", 0).unwrap().minor_units(), 12_000);
    assert_eq!(Money::parse("12.34", 2).unwrap().minor_units(), 1_234);
    assert!(Money::parse("12.345", 2).is_err());
}

#[test]
fn entry_type_controls_balance_direction() {
    assert_eq!(EntryType::Expense.balance_sign(), -1);
    assert_eq!(EntryType::Income.balance_sign(), 1);
    assert_eq!(EntryType::AdjustmentOut.balance_sign(), -1);
}
```

- [ ] **Step 2: Run the unit binary**

Run: `cargo test -p ledger-engine --test unit`

Expected: FAIL because `ledger-engine` is not a workspace package.

- [ ] **Step 3: Implement focused domain modules**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Expense,
    Income,
    TransferOut,
    TransferIn,
    AdjustmentOut,
    AdjustmentIn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Money(i64);

impl Money {
    pub fn parse(value: &str, decimal_places: u8) -> Result<Self, MoneyError>;
    pub fn minor_units(self) -> i64 { self.0 }
}
```

Reject negative entry amounts, excess fractional digits, overflow, blank names,
unsupported currency precision, and malformed dates at the domain boundary.
Keep reference models free of rusqlite types.

- [ ] **Step 4: Run domain tests and formatting**

Run: `cargo test -p ledger-engine --test unit && cargo fmt --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock ledger-engine
git commit -m "[ADD] Define Raven Ledger domain" -m "- 정수 최소화폐단위 변환과 거래 방향 규칙 추가
- 계좌·통화·분류·원장 엔트리 모델 정의"
```

### Task 2: Additive Ledger schema and repository port

**Files:**
- Create: `ledger-engine/src/application/mod.rs`
- Create: `ledger-engine/src/application/error.rs`
- Create: `ledger-engine/src/application/ports.rs`
- Create: `ledger-engine/src/infrastructure/mod.rs`
- Create: `ledger-engine/src/infrastructure/sqlite/mod.rs`
- Create: `ledger-engine/src/infrastructure/sqlite/schema.rs`
- Create: `ledger-engine/src/infrastructure/sqlite/mapping.rs`
- Create: `ledger-engine/src/infrastructure/sqlite/repository.rs`
- Create: `ledger-engine/tests/integration.rs`
- Create: `ledger-engine/tests/integration/schema.rs`
- Create: `ledger-engine/tests/integration/repository.rs`

**Interfaces:**
- Produces: `LedgerRepository` transaction-oriented port and `SqliteLedgerRepository::open(path)`.
- Consumes: Task 1 domain types.

- [ ] **Step 1: Write failing schema and repository tests**

```rust
#[test]
fn schema_uses_integer_money_and_required_indexes() {
    let repo = SqliteLedgerRepository::open_in_memory().unwrap();
    let amount_type = repo.column_type_for_test("ledger_entries", "amount_minor").unwrap();
    assert_eq!(amount_type, "INTEGER");
    assert!(repo.index_exists_for_test("idx_ledger_entries_date").unwrap());
    assert!(repo.index_exists_for_test("idx_ledger_entries_transfer_group").unwrap());
}

#[test]
fn schema_initialization_is_idempotent() {
    let repo = SqliteLedgerRepository::open_in_memory().unwrap();
    repo.init_schema().unwrap();
    repo.init_schema().unwrap();
}
```

- [ ] **Step 2: Run repository tests**

Run: `cargo test -p ledger-engine --test integration schema`

Expected: FAIL because the repository is absent.

- [ ] **Step 3: Implement schema and port**

```rust
pub trait LedgerRepository {
    fn transaction<T>(
        &mut self,
        action: impl FnOnce(&mut dyn LedgerTransaction) -> LedgerResult<T>,
    ) -> LedgerResult<T>;
    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>>;
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>>;
}
```

Create tables `currencies`, `account_categories`, `accounts`,
`transaction_categories`, `ledger_entries`, and `audit_events`. Add foreign
keys, `deleted_at`, date/account/category/transfer indexes, and a unique
currency-code index. Use `PRAGMA foreign_keys = ON` and additive
`CREATE TABLE/INDEX IF NOT EXISTS`.

- [ ] **Step 4: Run integration tests**

Run: `cargo test -p ledger-engine --test integration && cargo fmt --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ledger-engine
git commit -m "[ADD] Persist Raven Ledger records" -m "- 정수 금액과 감사 이벤트를 위한 additive SQLite 스키마 추가
- 트랜잭션 기반 저장소 포트와 rusqlite 어댑터 구현"
```

### Task 3: Master data and entry service policy

**Files:**
- Create: `ledger-engine/src/application/commands.rs`
- Create: `ledger-engine/src/application/service.rs`
- Create: `ledger-engine/src/application/entries.rs`
- Create: `ledger-engine/src/application/references.rs`
- Modify: `ledger-engine/src/application/mod.rs`
- Test: `ledger-engine/tests/integration/service_policy.rs`
- Test: `ledger-engine/tests/integration/audit.rs`

**Interfaces:**
- Produces: `LedgerService`, `CreateEntry`, `UpdateEntry`, and master-data create/update commands.
- Consumes: `LedgerRepository`, domain money/reference types.

- [ ] **Step 1: Write failing service-policy tests**

```rust
#[test]
fn expense_requires_active_category_and_writes_audit() {
    let mut service = seeded_service();
    let error = service.create_entry(expense_without_category()).unwrap_err();
    assert!(matches!(error, LedgerError::Validation { field: "category", .. }));

    let entry = service.create_entry(valid_expense()).unwrap();
    assert_eq!(service.audit_for(&entry.id).unwrap().len(), 1);
}

#[test]
fn create_ignores_no_caller_id_because_command_has_no_id_field() {
    let entry = seeded_service().create_entry(valid_expense()).unwrap();
    assert!(!entry.id.is_empty());
}
```

- [ ] **Step 2: Run service tests**

Run: `cargo test -p ledger-engine --test integration service_policy`

Expected: FAIL because service commands are undefined.

- [ ] **Step 3: Implement minimal service methods**

```rust
impl<R: LedgerRepository> LedgerService<R> {
    pub fn create_entry(&mut self, command: CreateEntry) -> LedgerResult<LedgerEntry>;
    pub fn update_entry(&mut self, id: &str, command: UpdateEntry) -> LedgerResult<LedgerEntry>;
    pub fn create_account(&mut self, command: CreateAccount) -> LedgerResult<Account>;
    pub fn create_category(
        &mut self,
        command: CreateTransactionCategory,
    ) -> LedgerResult<TransactionCategory>;
}
```

Resolve references by ID, code, or unique active name. Require categories for
expense/income, forbid category/transfer-group input for manual transfers,
allow optional valid category for adjustments, and preserve historical
references during update. Insert before/after audit JSON in the same immediate
transaction.

- [ ] **Step 4: Run service and repository tests**

Run: `cargo test -p ledger-engine`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ledger-engine
git commit -m "[ADD] Enforce Raven Ledger entry policy" -m "- 마스터 참조와 거래 유형별 검증을 서비스 계층에 집중
- 생성·수정과 감사 이벤트를 단일 트랜잭션으로 보장"
```

### Task 4: Atomic transfers and reversible lifecycle

**Files:**
- Create: `ledger-engine/src/application/transfers.rs`
- Create: `ledger-engine/src/application/lifecycle.rs`
- Modify: `ledger-engine/src/application/service.rs`
- Modify: `ledger-engine/src/application/ports.rs`
- Modify: `ledger-engine/src/infrastructure/sqlite/repository.rs`
- Test: `ledger-engine/tests/integration/transfers.rs`
- Test: `ledger-engine/tests/integration/lifecycle.rs`

**Interfaces:**
- Produces: `TransferCommand`, `TransferResult`, `archive_entry`, `restore_entry`, and `purge_entry(id, confirmation)`.
- Consumes: Task 3 service and repository transactions.

- [ ] **Step 1: Write failing atomicity and lifecycle tests**

```rust
#[test]
fn transfer_creates_exactly_two_rows_and_one_group() {
    let result = seeded_service().transfer(valid_transfer()).unwrap();
    assert_ne!(result.out_entry_id, result.in_entry_id);
    assert_eq!(result.transfer_group_id.len(), 36);
}

#[test]
fn purge_requires_exact_confirmation_and_keeps_audit() {
    let mut service = service_with_entry();
    let id = service.first_entry_id();
    assert!(matches!(
        service.purge_entry(&id, "wrong"),
        Err(LedgerError::ConfirmationMismatch)
    ));
    service.purge_entry(&id, &id).unwrap();
    assert!(service.entry_including_archived(&id).unwrap().is_none());
    assert!(!service.audit_for(&id).unwrap().is_empty());
}
```

- [ ] **Step 2: Run focused tests**

Run: `cargo test -p ledger-engine --test integration transfers && cargo test -p ledger-engine --test integration lifecycle`

Expected: FAIL because transfer and lifecycle methods are absent.

- [ ] **Step 3: Implement operations in repository transactions**

```rust
pub fn transfer(&mut self, command: TransferCommand) -> LedgerResult<TransferResult> {
    validate_distinct_compatible_accounts(&command)?;
    self.repository.transaction(|tx| {
        let group_id = Uuid::new_v4().to_string();
        let out = tx.insert_entry(command.out_entry(group_id.clone()))?;
        let input = tx.insert_entry(command.in_entry(group_id.clone()))?;
        tx.insert_audit(AuditEvent::transfer(&out, &input))?;
        Ok(TransferResult::new(group_id, out.id, input.id))
    })
}
```

Archive and restore update `deleted_at`; purge inserts the audit snapshot then
deletes the row. Refuse master-data purge while referenced.

- [ ] **Step 4: Run the Ledger suite**

Run: `cargo test -p ledger-engine`

Expected: PASS, including rollback when the second transfer insert fails.

- [ ] **Step 5: Commit**

```bash
git add ledger-engine
git commit -m "[ADD] Add atomic Ledger transfers and lifecycle" -m "- 이체 쌍과 감사 기록의 원자성 보장
- archive·restore·확인형 purge 정책 구현"
```

### Task 5: Queries, reports, doctor, and export

**Files:**
- Create: `ledger-engine/src/application/queries.rs`
- Create: `ledger-engine/src/application/reports.rs`
- Create: `ledger-engine/src/application/doctor.rs`
- Create: `ledger-engine/src/application/export.rs`
- Modify: `ledger-engine/src/application/service.rs`
- Test: `ledger-engine/tests/integration/queries.rs`
- Test: `ledger-engine/tests/integration/reports.rs`
- Copy fixture intent from pinned source:
  `crates/ledger-core/tests/fixtures/parity/`
- Create: `ledger-engine/tests/fixtures/parity/`

**Interfaces:**
- Produces: `EntryQuery`, `EntryView`, `LedgerSummary`, `DoctorReport`, and `ExportView`.
- Consumes: non-deleted entries by default and resolved master references.

- [ ] **Step 1: Add failing parity and report tests**

```rust
#[test]
fn monthly_summary_uses_type_direction_and_excludes_archived() {
    let service = service_with_income_expense_and_archived_entry();
    let summary = service.monthly_summary(YearMonth::new(2026, 7).unwrap()).unwrap();
    assert_eq!(summary.income_minor, 3_200_000);
    assert_eq!(summary.expense_minor, 1_900_000);
}

#[test]
fn doctor_detects_broken_transfer_pairs() {
    let report = service_with_corrupt_fixture().doctor().unwrap();
    assert!(report.issues.iter().any(|issue| issue.code == "transfer_pair_invalid"));
}
```

- [ ] **Step 2: Run query/report tests**

Run: `cargo test -p ledger-engine --test integration queries && cargo test -p ledger-engine --test integration reports`

Expected: FAIL because read models are absent.

- [ ] **Step 3: Implement read-only projections**

```rust
pub struct EntryQuery {
    pub date_from: Option<Date>,
    pub date_to: Option<Date>,
    pub entry_type: Option<EntryType>,
    pub account: Option<String>,
    pub category: Option<String>,
    pub content: Option<String>,
    pub include_archived: bool,
    pub offset: u32,
    pub limit: u16,
}
```

Port the source fixture expectations while converting float expectations to
minor units. Add account/category breakdowns, comparison windows, concise
briefing, transfer show, doctor checks, and deterministic JSON export.

- [ ] **Step 4: Run all Ledger tests**

Run: `cargo test -p ledger-engine && cargo clippy -p ledger-engine --all-targets -- -D warnings`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ledger-engine
git commit -m "[ADD] Add Ledger queries and reports" -m "- 기간·계좌·분류 조회와 월별 분석 투영 추가
- doctor·briefing·구조화 export 및 원본 fixture 동등성 검증"
```

### Task 6: Raven Ledger CLI

**Files:**
- Modify: `raven-cli/Cargo.toml`
- Modify: `raven-cli/src/cli.rs`
- Modify: `raven-cli/src/commands/mod.rs`
- Create: `raven-cli/src/commands/ledger.rs`
- Modify: `raven-cli/src/commands/init.rs`
- Test: `raven-cli/tests/ledger_cli.rs`

**Interfaces:**
- Produces: `raven ledger entry|transfer|account|category|currency|reports|doctor|export`.
- Consumes: `LedgerService<SqliteLedgerRepository>` and `RavenPaths::ledger_db()`.

- [ ] **Step 1: Write failing structured CLI tests**

```rust
#[test]
fn ledger_entry_add_and_json_list_round_trip() {
    let home = tempfile::tempdir().unwrap();
    seed_ledger_refs(home.path());
    raven(home.path())
        .args(["ledger", "entry", "add", "--date", "2026-07-30",
               "--type", "expense", "--amount", "12000", "--currency", "KRW",
               "--account", "card", "--category", "food", "--content", "Lunch"])
        .assert().success();
    raven(home.path()).args(["ledger", "entry", "list", "--format", "json"])
        .assert().success().stdout(predicate::str::contains("\"amount_minor\":12000"));
}
```

- [ ] **Step 2: Run the CLI test**

Run: `cargo test -p raven-cli --test ledger_cli`

Expected: FAIL because the Ledger subcommand is absent.

- [ ] **Step 3: Implement clap DTO conversion**

Map every CLI args type to an application command; do not expose repository
types. Support `--format table|json` for reads and `--json` for schema-validated
mutation objects. Return exit 2 for validation/conflict, 4 for not-found, and
1 for storage/internal errors.

```rust
#[derive(Debug, Subcommand)]
pub enum LedgerCommand {
    Entry { #[command(subcommand)] command: LedgerEntryCommand },
    Transfer(TransferArgs),
    Account { #[command(subcommand)] command: AccountCommand },
    Category { #[command(subcommand)] command: CategoryCommand },
    Currency { #[command(subcommand)] command: CurrencyCommand },
    Reports(ReportArgs),
    Doctor,
    Export(ExportArgs),
}
```

Extend `raven init` and `health-check` to initialize/report `ledger.sqlite`.

- [ ] **Step 4: Run the Ledger and Raven gates**

Run: `cargo test -p ledger-engine && cargo test -p raven-cli --test ledger_cli && cargo fmt --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.lock raven-cli ledger-engine
git commit -m "[ADD] Expose Ledger through Raven CLI" -m "- 구조화 entry·transfer·master·reports 명령 추가
- Raven init과 health-check에 ledger.sqlite 연결"
```

use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "raven",
    about = "Raven unified personal engine",
    arg_required_else_help = true,
    version
)]
pub struct Cli {
    #[arg(long, value_enum, default_value_t)]
    pub error_format: ErrorFormat,
    #[arg(long)]
    pub request_key: Option<String>,
    #[arg(long, default_value_t = 120, value_parser = clap::value_parser!(u64).range(1..=3600), requires = "request_key")]
    pub request_timeout_seconds: u64,

    #[arg(long, env = "RAVEN_HOME")]
    pub home: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Initialize Raven's data home and available engines.
    Init,
    /// Report the initialization and health of each engine.
    HealthCheck,
    /// Import data from an existing engine.
    Import {
        #[command(subcommand)]
        command: ImportCommand,
    },
    /// Run an existing ToDo command.
    #[command(disable_help_flag = true)]
    Todo {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<OsString>,
    },
    /// Use the policy-enforced Ledger engine.
    Ledger {
        #[command(subcommand)]
        command: Box<LedgerCommand>,
    },
    /// Use the structured Health Journal engine.
    Health {
        #[command(subcommand)]
        command: Box<HealthCommand>,
    },
    /// Serve the authenticated standalone Raven HTTP API.
    Api,
    /// Serve Raven's local UI and authenticated API.
    Ui(UiArgs),
}

#[derive(Debug, Args)]
pub struct UiArgs {
    /// Path to the bundled static UI artifact.
    #[arg(long)]
    pub ui_path: Option<PathBuf>,
    /// Loopback port to listen on.
    #[arg(long, default_value_t = 3002)]
    pub port: u16,
    /// Do not open the system browser.
    #[arg(long)]
    pub no_open: bool,
}

#[derive(Debug, Subcommand)]
pub enum ImportCommand {
    /// Copy an existing ToDo database into Raven.
    Todo {
        #[arg(long)]
        source_home: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
pub enum LedgerCommand {
    /// Query the UI tables using the same filters, sorts, groups and lookup IDs.
    Table {
        #[command(subcommand)]
        command: TableCommand,
    },
    /// Create, read, update, archive, or restore entries.
    Entry {
        #[command(subcommand)]
        command: LedgerEntryCommand,
    },
    /// Create an atomic, idempotent account transfer.
    Transfer(TransferArgs),
    /// Show a transfer pair by its group identifier.
    TransferShow(TransferShowArgs),
    /// Update both sides of an atomic transfer from a strict JSON object.
    TransferUpdate(TransferUpdateArgs),
    /// Manage account master data.
    Account {
        #[command(subcommand)]
        command: AccountCommand,
    },
    /// Manage account-category master data.
    AccountCategory {
        #[command(subcommand)]
        command: AccountCategoryCommand,
    },
    /// Manage transaction-category master data.
    Category {
        #[command(subcommand)]
        command: CategoryCommand,
    },
    /// Manage currency master data.
    Currency {
        #[command(subcommand)]
        command: CurrencyCommand,
    },
    /// Summarize entries for an inclusive date range.
    Reports(ReportArgs),
    /// List current account balances.
    Balances(PageReadArgs),
    /// Compare summaries for two explicit inclusive date ranges.
    Compare(CompareArgs),
    /// Page through audit history for one Ledger record.
    #[command(visible_alias = "history")]
    Audit(AuditArgs),
    /// Run bounded, read-only Ledger diagnostics.
    Doctor(DoctorArgs),
    /// Export deterministic Ledger schema v3 JSON.
    Export(ExportArgs),
}

#[derive(Debug, Subcommand)]
pub enum LedgerEntryCommand {
    Add(EntryAddArgs),
    Update(EntryUpdateArgs),
    List(EntryListArgs),
    Show(EntryShowArgs),
    Archive(EntryIdentityArgs),
    Restore(EntryIdentityArgs),
}

#[derive(Debug, Subcommand)]
pub enum HealthCommand {
    /// Query the UI tables using the same filters, sorts, groups and lookup IDs.
    Table {
        #[command(subcommand)]
        command: TableCommand,
    },
    /// Manage diet entries and optional images.
    Diet {
        #[command(subcommand)]
        command: DietCommand,
    },
    /// Manage bowel events.
    Bowel {
        #[command(subcommand)]
        command: BowelCommand,
    },
    /// Manage medication events.
    Medication {
        #[command(subcommand)]
        command: MedicationCommand,
    },
    /// Manage weight, sleep, lab, symptom, and condition metrics.
    Metric {
        #[command(subcommand)]
        command: MetricCommand,
    },
    /// Summarize an inclusive local-date range.
    Reports(ReportRangeArgs),
    /// Page through audit history for a Health record.
    Audit(HealthAuditArgs),
}

#[derive(Debug, Subcommand)]
pub enum DietCommand {
    Add(DietAddArgs),
    Update(DietUpdateArgs),
    List(DietListArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
}

#[derive(Debug, Subcommand)]
pub enum BowelCommand {
    Add(BowelAddArgs),
    Update(BowelUpdateArgs),
    List(HealthListArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
}

#[derive(Debug, Subcommand)]
pub enum MedicationCommand {
    Add(MedicationAddArgs),
    Update(MedicationUpdateArgs),
    List(MedicationListArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
}

#[derive(Debug, Subcommand)]
pub enum MetricCommand {
    DailyUpsert(MetricDailyUpsertArgs),
    List(MetricListArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum HealthEventCategoryArg {
    Weight,
    Sleep,
    Lab,
    Symptom,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum MealArg {
    Breakfast,
    Lunch,
    Dinner,
    Snack,
    LateNight,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum MedicationUnitArg {
    Tablet,
    Capsule,
    Packet,
    Mg,
    G,
    Ml,
    Drop,
    Dose,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum EntryMutationTypeArg {
    Expense,
    Income,
}

#[derive(Debug, Subcommand)]
pub enum TableCommand {
    /// Query the UI table from strict API-compatible JSON; output {items,next_offset}.
    Query(TableQueryArgs),
    /// List the IDs and labels accepted by table filters.
    Lookups(TableLookupArgs),
}

#[derive(Debug, Args)]
#[command(
    after_help = r#"Body fields: scope, offset (default 0), limit (1..50; default 50), filter_mode (and|or), filters, sorts, group_by, group_settings, context.reference_date (YYYY-MM-DD).
Each filter has field, operator and value: {text}, {list}, {range:{start,end}}, {relative:{amount,unit}} or {empty:true}.
Sorts use field and direction asc|desc, with at most 10 rules. Ledger requires at least one sort rule; Health accepts an empty list. Group settings require sort alphabetical|reverse_alphabetical|manual, hide_empty, manual_order and hidden_group_keys.

Example:
  --json '{"scope":"health.diet","filters":[{"field":"food","operator":"contains","value":{"text":"Rice"}}],"sorts":[{"field":"date","direction":"desc"}],"group_by":"none","group_settings":{"sort":"alphabetical","hide_empty":false,"manual_order":[],"hidden_group_keys":[]}}'

Health scopes: health.diet, health.bowel, health.medication, health.metrics.
Ledger scopes: ledger.transactions, ledger.accounts, ledger.categories.
Filter fields by scope:
  health.diet: date,meal_type,food,tags,has_photo
  health.bowel: date,bristol_scale,blood_visible
  health.medication: date,medication_name,medication_unit
  health.metrics: date,weight,sleep,crp,calprotectin,condition
  ledger.transactions: date,content,entry_type,account,category,currency,amount
  ledger.accounts: name,account_type,currency,current_balance
  ledger.categories: name,kind,parent
Operators vary by field type: is,is_not,contains,does_not_contain,starts_with,ends_with,is_before,is_after,is_on_or_before,is_on_or_after,is_between,is_relative_to_today,greater_than,less_than,is_empty,is_not_empty.
Sort fields by scope:
  health.diet: date,meal_type,food,created,updated
  health.bowel: date,bristol_scale,created,updated
  health.medication: date,medication_name,dose,created,updated
  health.metrics: date,weight,sleep,crp,calprotectin,condition
  ledger.transactions: date,content,account,category,amount,updated
  ledger.accounts: name,account_type,currency,current_balance
  ledger.categories: name,kind,parent
Group fields by scope (all accept none):
  health.diet: month,week,day,meal_type,tag,has_photo
  health.bowel: month,week,day,bristol_scale,blood_visible
  health.medication: month,week,day,medication_name,medication_unit
  health.metrics: month,week
  ledger.transactions: month,week,day,account,category,entry_type
  ledger.accounts: account_type,currency
  ledger.categories: kind,parent
Relative units are day|week|month and require context.reference_date. Dates in Health use UTC+09:00.
Use table lookups for selectable IDs. Output is JSON {items,next_offset}; reuse filters, sorts and groups with the returned offset."#
)]
pub struct TableQueryArgs {
    /// Strict API-compatible table query object. Unknown fields are rejected.
    #[arg(long)]
    pub json: String,
}

#[derive(Debug, Args)]
pub struct TableLookupArgs {
    /// health.diet|health.bowel|health.medication|health.metrics or ledger.transactions|ledger.accounts|ledger.categories.
    #[arg(long)]
    pub scope: String,
}

#[derive(Debug, Args)]
pub struct DietAddArgs {
    #[arg(long, conflicts_with_all = ["at", "meal", "food", "note", "tags", "image", "content_type"])]
    /// Strict object: required at (RFC3339), meal, food; optional note, tags (array), image ({path,content_type}). Example: {"at":"2026-09-30T12:00:00+09:00","meal":"lunch","food":"Rice","tags":["rice"]}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub meal: Option<MealArg>,
    #[arg(long)]
    pub food: Option<String>,
    #[arg(long)]
    pub note: Option<String>,
    #[arg(long, value_delimiter = ',')]
    pub tags: Vec<String>,
    #[arg(long)]
    pub image: Option<PathBuf>,
    #[arg(long, requires = "image")]
    pub content_type: Option<String>,
}

#[derive(Debug, Args)]
pub struct DietUpdateArgs {
    pub id: String,
    #[arg(long, conflicts_with_all = ["at", "meal", "food", "note", "clear_note", "tags", "image", "remove_image", "content_type", "expected_updated_at"])]
    /// Strict partial object: at, meal, food, note, clear_note, tags, image ({path,content_type}), remove_image, expected_updated_at. Omitted fields are preserved; clear_note/remove_image explicitly clear values. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub meal: Option<MealArg>,
    #[arg(long)]
    pub food: Option<String>,
    #[arg(long, conflicts_with = "clear_note")]
    pub note: Option<String>,
    #[arg(long)]
    pub clear_note: bool,
    #[arg(long, value_delimiter = ',')]
    pub tags: Option<Vec<String>>,
    #[arg(long, conflicts_with = "remove_image")]
    pub image: Option<PathBuf>,
    #[arg(long)]
    pub remove_image: bool,
    #[arg(long, requires = "image")]
    pub content_type: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub expected_updated_at: Option<String>,
}

#[derive(Debug, Args)]
pub struct BowelAddArgs {
    #[arg(long, conflicts_with_all = ["at", "bristol", "blood_visible", "note"])]
    /// Strict object: required at (RFC3339), bristol (1..7); optional blood_visible (default false), note. Example: {"at":"2026-09-30T12:00:00+09:00","bristol":4}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub bristol: Option<u8>,
    #[arg(long, default_value_t = false)]
    pub blood_visible: bool,
    #[arg(long)]
    pub note: Option<String>,
}

#[derive(Debug, Args)]
pub struct BowelUpdateArgs {
    pub id: String,
    #[arg(long, conflicts_with_all = ["at", "bristol", "blood_visible", "note", "clear_note", "expected_updated_at"])]
    /// Strict partial object: at, bristol, blood_visible, note, clear_note, expected_updated_at. Omitted fields are preserved; clear_note clears note. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub bristol: Option<u8>,
    #[arg(long)]
    pub blood_visible: Option<bool>,
    #[arg(long, conflicts_with = "clear_note")]
    pub note: Option<String>,
    #[arg(long)]
    pub clear_note: bool,
    #[arg(long, value_name = "RFC3339")]
    pub expected_updated_at: Option<String>,
}

#[derive(Debug, Args)]
pub struct MedicationAddArgs {
    #[arg(long, conflicts_with_all = ["at", "name", "dose", "unit", "note"])]
    /// Strict object: required at (RFC3339), name, dose (positive number), unit; optional note. Example: {"at":"2026-09-30T08:00:00+09:00","name":"Vitamin D","dose":1,"unit":"tablet"}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub dose: Option<f64>,
    #[arg(long)]
    pub unit: Option<MedicationUnitArg>,
    #[arg(long)]
    pub note: Option<String>,
}

#[derive(Debug, Args)]
pub struct MedicationUpdateArgs {
    pub id: String,
    #[arg(long, conflicts_with_all = ["at", "name", "dose", "unit", "note", "clear_note", "expected_updated_at"])]
    /// Strict partial object: at, name, dose, unit, note, clear_note, expected_updated_at. Omitted fields are preserved; clear_note clears note. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub dose: Option<f64>,
    #[arg(long)]
    pub unit: Option<MedicationUnitArg>,
    #[arg(long, conflicts_with = "clear_note")]
    pub note: Option<String>,
    #[arg(long)]
    pub clear_note: bool,
    #[arg(long, value_name = "RFC3339")]
    pub expected_updated_at: Option<String>,
}

#[derive(Debug, Args)]
pub struct MetricDailyUpsertArgs {
    #[arg(
        long,
        help = "Strict JSON array of daily metrics",
        long_help = "Strict JSON array. Required: at (RFC3339), category, value. Optional: key, name, unit, condition_note, expected_updated_at. Dates use fixed UTC+09:00. Canonical identities: weight/body_weight/Body weight/kg; sleep/sleep_duration/Sleep duration (hours; omit unit); lab/crp/CRP/mg/L; lab/fecal_calprotectin/Fecal calprotectin/µg/g; overall_condition/Overall condition (integer 1..10; omit key and unit). Weight and sleep keys/names and condition name default to canonical values; labs require key and unit. Existing daily values require expected_updated_at from metric show/list; only condition accepts condition_note. Unknown fields are rejected. Example: --json '[{\"at\":\"2026-09-30T07:00:00+09:00\",\"category\":\"weight\",\"value\":70.2}]'"
    )]
    pub json: String,
}

#[derive(Debug, Args)]
pub struct HealthListArgs {
    /// Inclusive date in UTC+09:00, using the same date filter as the UI table.
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub from: Option<String>,
    /// Inclusive date in UTC+09:00.
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub to: Option<String>,
    #[command(flatten)]
    pub page: HealthPageArgs,
}

#[derive(Debug, Args)]
pub struct DietListArgs {
    /// Case-insensitive food substring (UI contains filter).
    #[arg(long)]
    pub food: Option<String>,
    /// Match any normalized diet tag; comma-separated (UI is filter).
    #[arg(long, value_delimiter = ',')]
    pub tags: Vec<String>,
    #[arg(long, value_enum)]
    pub meal: Option<MealArg>,
    #[command(flatten)]
    pub list: HealthListArgs,
}

#[derive(Debug, Args)]
pub struct MedicationListArgs {
    /// Case-insensitive medication-name substring (UI contains filter).
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long, value_enum)]
    pub unit: Option<MedicationUnitArg>,
    #[command(flatten)]
    pub list: HealthListArgs,
}

#[derive(Debug, Args)]
pub struct HealthPageArgs {
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long, default_value_t = 100)]
    pub limit: u16,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
#[command(
    after_help = "This record list preserves historical metrics. For the UI daily metric table with date/value filters, sorts and groups, use raven health table query --help with scope health.metrics."
)]
pub struct MetricListArgs {
    #[arg(long, value_enum)]
    pub category: Option<HealthEventCategoryArg>,
    #[arg(long)]
    pub key: Option<String>,
    #[command(flatten)]
    pub page: HealthPageArgs,
}

#[derive(Debug, Args)]
pub struct HealthIdentityReadArgs {
    pub id: String,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct HealthIdentityArgs {
    pub id: String,
    #[arg(long, value_name = "RFC3339")]
    pub expected_updated_at: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum CurrencyCommand {
    Create(CurrencyCreateArgs),
    Update(CurrencyUpdateArgs),
    List(MasterListArgs),
}

#[derive(Debug, Subcommand)]
pub enum AccountCategoryCommand {
    Create(AccountCategoryCreateArgs),
    Update(AccountCategoryUpdateArgs),
    List(MasterListArgs),
    Purge(PurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum AccountCommand {
    Create(AccountCreateArgs),
    Update(AccountUpdateArgs),
    List(MasterListArgs),
}

#[derive(Debug, Subcommand)]
pub enum CategoryCommand {
    Create(CategoryCreateArgs),
    Update(CategoryUpdateArgs),
    List(MasterListArgs),
}

#[derive(Debug, Clone, Copy, Default, ValueEnum)]
pub enum OutputFormat {
    #[default]
    Table,
    Json,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum EntryTypeArg {
    Expense,
    Income,
    TransferOut,
    TransferIn,
    AdjustmentOut,
    AdjustmentIn,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum CategoryKindArg {
    Expense,
    Income,
}

#[derive(Debug, Clone, Copy, Default, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum ReportBy {
    #[default]
    Summary,
    Category,
}

#[derive(Debug, Args)]
#[command(
    long_about = "Create one Ledger entry from either a strict JSON object or mutation flags.",
    after_help = "Input modes:\n  --json <OBJECT>\n  or the complete flag set: --date, --type, --amount, --currency, --account, --content.\n  Expense and income entries require --category.\n\nFormats:\n  --date YYYY-MM-DD\n\nExamples:\n  raven ledger entry add --date 2024-02-29 --type expense --amount 12.34 --currency USD --account cash --category food --content Lunch\n  raven ledger entry add --json '{\"date\":\"2024-02-29\",\"entry_type\":\"expense\",\"amount\":\"12.34\",\"currency\":\"USD\",\"account\":\"cash\",\"category\":\"food\",\"content\":\"Lunch\"}'"
)]
pub struct EntryAddArgs {
    #[arg(long)]
    /// Strict object: date (YYYY-MM-DD), entry_type (expense|income), amount (decimal string), currency, account, content; category required for expense/income; optional notes. Names or IDs resolve through the service. See examples below. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub date: Option<String>,
    #[arg(long = "type")]
    pub entry_type: Option<EntryMutationTypeArg>,
    #[arg(long)]
    pub amount: Option<String>,
    #[arg(long)]
    pub currency: Option<String>,
    #[arg(long)]
    pub account: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long)]
    pub content: Option<String>,
    #[arg(long)]
    pub notes: Option<String>,
}

#[derive(Debug, Args)]
pub struct EntryUpdateArgs {
    pub id: String,
    #[arg(long)]
    /// Strict partial object: date, entry_type (expense|income), amount (decimal string), currency, account, category, clear_category, content, notes, clear_notes. Omitted fields are preserved. Historical records can be edited without changing entry_type. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub date: Option<String>,
    #[arg(long = "type")]
    pub entry_type: Option<EntryMutationTypeArg>,
    #[arg(long)]
    pub amount: Option<String>,
    #[arg(long)]
    pub currency: Option<String>,
    #[arg(long)]
    pub account: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long, conflicts_with = "category")]
    pub clear_category: bool,
    #[arg(long)]
    pub content: Option<String>,
    #[arg(long)]
    pub notes: Option<String>,
    #[arg(long, conflicts_with = "notes")]
    pub clear_notes: bool,
}

#[derive(Debug, Args)]
pub struct EntryListArgs {
    #[arg(long)]
    pub from: Option<String>,
    #[arg(long)]
    pub to: Option<String>,
    #[arg(long = "type")]
    pub entry_type: Option<EntryTypeArg>,
    #[arg(long)]
    pub account: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long)]
    pub currency: Option<String>,
    #[arg(long)]
    pub content: Option<String>,
    #[arg(long)]
    pub include_archived: bool,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long, default_value_t = 100)]
    pub limit: u16,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct EntryShowArgs {
    pub id: String,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct EntryIdentityArgs {
    pub id: String,
}

#[derive(Debug, Args)]
pub struct PurgeArgs {
    pub id: String,
    #[arg(long)]
    pub confirm: Option<String>,
}

#[derive(Debug, Args)]
#[command(
    long_about = "Create an atomic transfer from either a strict JSON object or mutation flags. Retries with the same canonical UUID v4 operation key are idempotent.",
    after_help = "Input modes:\n  --json <OBJECT>\n  or the complete flag set: --operation-key, --date, --amount, --currency, --from-account, --to-account, --content.\n\nFormats:\n  --operation-key UUID v4 (canonical lowercase hyphenated form)\n  --date YYYY-MM-DD\n\nExample:\n  raven ledger transfer --operation-key 018f31c0-5c2a-4e75-9c18-a14d7bddb2a1 --date 2024-02-29 --amount 10.00 --currency USD --from-account checking --to-account savings --content Move"
)]
pub struct TransferArgs {
    #[arg(long)]
    /// Strict object: operation_key (canonical UUID v4), date, amount (decimal string), currency, from_account, to_account, content; optional notes. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long, visible_alias = "idempotency-key")]
    pub operation_key: Option<String>,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub date: Option<String>,
    #[arg(long)]
    pub amount: Option<String>,
    #[arg(long)]
    pub currency: Option<String>,
    #[arg(long)]
    pub from_account: Option<String>,
    #[arg(long)]
    pub to_account: Option<String>,
    #[arg(long)]
    pub content: Option<String>,
    #[arg(long)]
    pub notes: Option<String>,
}

#[derive(Debug, Args)]
pub struct TransferShowArgs {
    pub id: String,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct CurrencyCreateArgs {
    #[arg(long)]
    /// Strict object: code, name, symbol, decimal_places (0..18). Example: {"code":"KRW","name":"Korean Won","symbol":"won","decimal_places":0}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub code: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub symbol: Option<String>,
    #[arg(long)]
    pub decimal_places: Option<u8>,
}

#[derive(Debug, Args)]
pub struct CurrencyUpdateArgs {
    pub id: String,
    #[arg(long)]
    /// Strict partial object: code, name, symbol, decimal_places, active (boolean). Omitted fields are preserved. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub code: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub symbol: Option<String>,
    #[arg(long)]
    pub decimal_places: Option<u8>,
    #[arg(long)]
    pub active: Option<bool>,
}

#[derive(Debug, Args)]
pub struct AccountCategoryCreateArgs {
    #[arg(long)]
    /// Strict object: name; optional parent (name or ID), liability (default false). Example: {"name":"Cash"}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub parent: Option<String>,
    #[arg(long)]
    pub liability: bool,
}

#[derive(Debug, Args)]
pub struct AccountCategoryUpdateArgs {
    pub id: String,
    #[arg(long)]
    /// Strict partial object: name, parent, clear_parent, liability, active. Omitted fields are preserved. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub parent: Option<String>,
    #[arg(long, conflicts_with = "parent")]
    pub clear_parent: bool,
    #[arg(long)]
    pub liability: Option<bool>,
    #[arg(long)]
    pub active: Option<bool>,
}

#[derive(Debug, Args)]
pub struct AccountCreateArgs {
    #[arg(long)]
    /// Strict object: name, category, currency, opening_balance (decimal string). Example: {"name":"Wallet","category":"Cash","currency":"KRW","opening_balance":"0"}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long)]
    pub currency: Option<String>,
    #[arg(long)]
    pub opening_balance: Option<String>,
}

#[derive(Debug, Args)]
pub struct AccountUpdateArgs {
    pub id: String,
    #[arg(long)]
    /// Strict partial object: name, category, currency, opening_balance (decimal string), active. Omitted fields are preserved. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub category: Option<String>,
    #[arg(long)]
    pub currency: Option<String>,
    #[arg(long)]
    pub opening_balance: Option<String>,
    #[arg(long)]
    pub active: Option<bool>,
}

#[derive(Debug, Args)]
pub struct CategoryCreateArgs {
    #[arg(long)]
    /// Strict object: name, kind (expense|income); optional parent (name or ID). Example: {"name":"Food","kind":"expense"}. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub parent: Option<String>,
    #[arg(long)]
    pub kind: Option<CategoryKindArg>,
}

#[derive(Debug, Args)]
pub struct CategoryUpdateArgs {
    pub id: String,
    #[arg(long)]
    /// Strict partial object: name, kind, parent, clear_parent, active. Omitted fields are preserved. JSON and field flags cannot be mixed.
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub parent: Option<String>,
    #[arg(long, conflicts_with = "parent")]
    pub clear_parent: bool,
    #[arg(long)]
    pub kind: Option<CategoryKindArg>,
    #[arg(long)]
    pub active: Option<bool>,
}

#[derive(Debug, Args)]
pub struct MasterListArgs {
    /// Include inactive master data for inspection and reactivation.
    #[arg(long)]
    pub include_inactive: bool,
    /// Case-insensitive substring search of names and currency codes before pagination.
    #[arg(long)]
    pub query: Option<String>,
    #[command(flatten)]
    pub page: PageReadArgs,
}

#[derive(Debug, Args)]
pub struct PageReadArgs {
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long, default_value_t = 100)]
    pub limit: u16,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct ReportArgs {
    #[command(flatten)]
    pub range: ReportRangeArgs,
    #[arg(long, value_enum, default_value_t)]
    pub by: ReportBy,
}

#[derive(Debug, Args)]
pub struct ReportRangeArgs {
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub from: String,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub to: String,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct CompareArgs {
    #[command(flatten)]
    pub range: ReportRangeArgs,
}

#[derive(Debug, Args)]
pub struct AuditArgs {
    #[arg(long)]
    pub record_type: String,
    #[arg(long)]
    pub record_id: String,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long, default_value_t = 100)]
    pub limit: u16,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct DoctorArgs {
    #[arg(long)]
    pub max_records: Option<usize>,
    #[arg(long)]
    pub max_bytes: Option<usize>,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Args)]
pub struct ExportArgs {
    #[arg(long)]
    pub include_archived: bool,
    #[arg(long)]
    pub max_records: Option<usize>,
    #[arg(
        long,
        help = "Maximum bytes in the serialized JSON document (and JSON stdout)"
    )]
    pub max_bytes: Option<usize>,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

impl Command {
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Init => "init",
            Self::HealthCheck => "health-check",
            Self::Import { .. } => "import",
            Self::Todo { .. } => "todo",
            Self::Ledger { .. } => "ledger",
            Self::Health { .. } => "health",
            Self::Api => "api",
            Self::Ui(_) => "ui",
        }
    }

    pub(crate) fn engine(&self) -> &'static str {
        match self {
            Self::Import {
                command: ImportCommand::Todo { .. },
            }
            | Self::Todo { .. } => "todo",
            Self::Ledger { .. } => "ledger",
            Self::Health { .. } => "health",
            Self::Init | Self::HealthCheck | Self::Api | Self::Ui(_) => "raven",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, ValueEnum)]
pub enum ErrorFormat {
    #[default]
    Text,
    Json,
}

#[derive(Debug, Args)]
pub struct TransferUpdateArgs {
    pub id: String,
    #[arg(long)]
    pub json: String,
}

#[derive(Debug, Args)]
pub struct HealthAuditArgs {
    pub record_type: String,
    pub record_id: String,
    #[arg(long, default_value_t = 0)]
    pub offset: u32,
    #[arg(long, default_value_t = 100)]
    pub limit: u16,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

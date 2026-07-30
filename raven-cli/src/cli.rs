use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "raven",
    about = "Raven unified personal engine",
    arg_required_else_help = true
)]
pub struct Cli {
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
    /// Create, read, update, archive, restore, or purge entries.
    Entry {
        #[command(subcommand)]
        command: LedgerEntryCommand,
    },
    /// Create an atomic, idempotent account transfer.
    Transfer(TransferArgs),
    /// Show a transfer pair by its group identifier.
    TransferShow(TransferShowArgs),
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
    /// Produce a concise date-range briefing.
    Briefing(ReportRangeArgs),
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
    Purge(PurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum HealthCommand {
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
    /// Show the combined Health Journal timeline.
    Timeline(HealthTimelineArgs),
    /// Show bounded Health Journal trends.
    Trends(HealthTrendsArgs),
}

#[derive(Debug, Subcommand)]
pub enum DietCommand {
    Add(DietAddArgs),
    Update(DietUpdateArgs),
    List(HealthPageArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
    Purge(HealthPurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum BowelCommand {
    Add(BowelAddArgs),
    Update(BowelUpdateArgs),
    List(HealthPageArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
    Purge(HealthPurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum MedicationCommand {
    Add(MedicationAddArgs),
    Update(MedicationUpdateArgs),
    List(HealthPageArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
    Purge(HealthPurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum MetricCommand {
    Add(MetricAddArgs),
    DailyUpsert(MetricDailyUpsertArgs),
    Update(MetricUpdateArgs),
    List(MetricListArgs),
    Show(HealthIdentityReadArgs),
    Archive(HealthIdentityArgs),
    Restore(HealthIdentityArgs),
    Purge(HealthPurgeArgs),
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum HealthMetricCategoryArg {
    Weight,
    Sleep,
    Lab,
    Symptom,
    OverallCondition,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum HealthEventCategoryArg {
    Weight,
    Bowel,
    Sleep,
    Lab,
    Symptom,
    Medication,
}

#[derive(Debug, Args)]
pub struct DietAddArgs {
    #[arg(long, conflicts_with_all = ["at", "meal", "food", "note", "tags", "image", "content_type"])]
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub meal: Option<String>,
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
    #[arg(long, conflicts_with_all = ["at", "meal", "food", "note", "clear_note", "tags", "image", "remove_image", "content_type", "expected_updated_at", "reason"])]
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub meal: Option<String>,
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
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Args)]
pub struct BowelAddArgs {
    #[arg(long, conflicts_with_all = ["at", "bristol", "blood_visible", "note"])]
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
    #[arg(long, conflicts_with_all = ["at", "bristol", "blood_visible", "note", "clear_note", "expected_updated_at", "reason"])]
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
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Args)]
pub struct MedicationAddArgs {
    #[arg(long, conflicts_with_all = ["at", "name", "dose", "unit", "note"])]
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub dose: Option<f64>,
    #[arg(long)]
    pub unit: Option<String>,
    #[arg(long)]
    pub note: Option<String>,
}

#[derive(Debug, Args)]
pub struct MedicationUpdateArgs {
    pub id: String,
    #[arg(long, conflicts_with_all = ["at", "name", "dose", "unit", "note", "clear_note", "expected_updated_at", "reason"])]
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub dose: Option<f64>,
    #[arg(long)]
    pub unit: Option<String>,
    #[arg(long, conflicts_with = "clear_note")]
    pub note: Option<String>,
    #[arg(long)]
    pub clear_note: bool,
    #[arg(long, value_name = "RFC3339")]
    pub expected_updated_at: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Args)]
pub struct MetricAddArgs {
    #[arg(long, conflicts_with_all = ["at", "category", "key", "name", "value", "unit", "condition_note", "note"])]
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long, value_enum)]
    pub category: Option<HealthMetricCategoryArg>,
    #[arg(long)]
    pub key: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub value: Option<f64>,
    #[arg(long)]
    pub unit: Option<String>,
    #[arg(long)]
    pub condition_note: Option<String>,
    #[arg(long)]
    pub note: Option<String>,
}

#[derive(Debug, Args)]
pub struct MetricDailyUpsertArgs {
    #[arg(long, help = "Strict JSON array of metric objects")]
    pub json: String,
}

#[derive(Debug, Args)]
pub struct MetricUpdateArgs {
    pub id: String,
    #[arg(long, conflicts_with_all = ["at", "name", "value", "unit", "clear_unit", "condition_note", "clear_condition_note", "note", "clear_note", "expected_updated_at", "reason"])]
    pub json: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub at: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub value: Option<f64>,
    #[arg(long, conflicts_with = "clear_unit")]
    pub unit: Option<String>,
    #[arg(long)]
    pub clear_unit: bool,
    #[arg(long, conflicts_with = "clear_condition_note")]
    pub condition_note: Option<String>,
    #[arg(long)]
    pub clear_condition_note: bool,
    #[arg(long, conflicts_with = "clear_note")]
    pub note: Option<String>,
    #[arg(long)]
    pub clear_note: bool,
    #[arg(long, value_name = "RFC3339")]
    pub expected_updated_at: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
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

#[derive(Debug, Args)]
pub struct HealthPurgeArgs {
    pub id: String,
    #[arg(long)]
    pub confirm: Option<String>,
}

#[derive(Debug, Args)]
pub struct HealthTimelineArgs {
    #[arg(long, value_name = "RFC3339")]
    pub from: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub to: Option<String>,
    #[arg(long, value_enum)]
    pub category: Option<HealthEventCategoryArg>,
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
pub struct HealthTrendsArgs {
    #[arg(long, default_value_t = 30)]
    pub days: u16,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
}

#[derive(Debug, Subcommand)]
pub enum CurrencyCommand {
    Create(CurrencyCreateArgs),
    Update(CurrencyUpdateArgs),
    List(PageReadArgs),
    Purge(PurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum AccountCategoryCommand {
    Create(AccountCategoryCreateArgs),
    Update(AccountCategoryUpdateArgs),
    List(PageReadArgs),
    Purge(PurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum AccountCommand {
    Create(AccountCreateArgs),
    Update(AccountUpdateArgs),
    List(PageReadArgs),
    Purge(PurgeArgs),
}

#[derive(Debug, Subcommand)]
pub enum CategoryCommand {
    Create(CategoryCreateArgs),
    Update(CategoryUpdateArgs),
    List(PageReadArgs),
    Purge(PurgeArgs),
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
    Account,
    Category,
}

#[derive(Debug, Args)]
#[command(
    long_about = "Create one Ledger entry from either a strict JSON object or mutation flags.",
    after_help = "Input modes:\n  --json <OBJECT>\n  or the complete flag set: --date, --type, --amount, --currency, --account, --content.\n  Expense and income entries also require --category; adjustment entries may omit it.\n\nFormats:\n  --date YYYY-MM-DD\n  --written-at RFC3339\n\nExamples:\n  raven ledger entry add --date 2024-02-29 --type expense --amount 12.34 --currency USD --account cash --category food --content Lunch\n  raven ledger entry add --json '{\"date\":\"2024-02-29\",\"entry_type\":\"expense\",\"amount\":\"12.34\",\"currency\":\"USD\",\"account\":\"cash\",\"category\":\"food\",\"content\":\"Lunch\"}'"
)]
pub struct EntryAddArgs {
    #[arg(long)]
    pub json: Option<String>,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub date: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub written_at: Option<String>,
    #[arg(long = "type")]
    pub entry_type: Option<EntryTypeArg>,
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
    pub source: Option<String>,
    #[arg(long)]
    pub notes: Option<String>,
    #[arg(long)]
    pub actor: Option<String>,
}

#[derive(Debug, Args)]
pub struct EntryUpdateArgs {
    pub id: String,
    #[arg(long)]
    pub json: Option<String>,
    #[arg(long)]
    pub date: Option<String>,
    #[arg(long)]
    pub written_at: Option<String>,
    #[arg(long = "type")]
    pub entry_type: Option<EntryTypeArg>,
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
    pub source: Option<String>,
    #[arg(long)]
    pub notes: Option<String>,
    #[arg(long, conflicts_with = "notes")]
    pub clear_notes: bool,
    #[arg(long)]
    pub actor: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
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
    after_help = "Input modes:\n  --json <OBJECT>\n  or the complete flag set: --operation-key, --date, --amount, --currency, --from-account, --to-account, --content.\n\nFormats:\n  --operation-key UUID v4 (canonical lowercase hyphenated form)\n  --date YYYY-MM-DD\n  --written-at RFC3339\n\nExample:\n  raven ledger transfer --operation-key 018f31c0-5c2a-4e75-9c18-a14d7bddb2a1 --date 2024-02-29 --amount 10.00 --currency USD --from-account checking --to-account savings --content Move"
)]
pub struct TransferArgs {
    #[arg(long)]
    pub json: Option<String>,
    #[arg(long, visible_alias = "idempotency-key")]
    pub operation_key: Option<String>,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub date: Option<String>,
    #[arg(long, value_name = "RFC3339")]
    pub written_at: Option<String>,
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
    pub source: Option<String>,
    #[arg(long)]
    pub notes: Option<String>,
    #[arg(long)]
    pub actor: Option<String>,
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
    pub actor: Option<String>,
}

#[derive(Debug, Args)]
pub struct CurrencyUpdateArgs {
    pub id: String,
    #[arg(long)]
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
    #[arg(long)]
    pub actor: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Args)]
pub struct AccountCategoryCreateArgs {
    #[arg(long)]
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub parent: Option<String>,
    #[arg(long)]
    pub liability: bool,
    #[arg(long)]
    pub actor: Option<String>,
}

#[derive(Debug, Args)]
pub struct AccountCategoryUpdateArgs {
    pub id: String,
    #[arg(long)]
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
    #[arg(long)]
    pub actor: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Args)]
pub struct AccountCreateArgs {
    #[arg(long)]
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
    pub actor: Option<String>,
}

#[derive(Debug, Args)]
pub struct AccountUpdateArgs {
    pub id: String,
    #[arg(long)]
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
    #[arg(long)]
    pub actor: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Args)]
pub struct CategoryCreateArgs {
    #[arg(long)]
    pub json: Option<String>,
    #[arg(long)]
    pub name: Option<String>,
    #[arg(long)]
    pub parent: Option<String>,
    #[arg(long)]
    pub kind: Option<CategoryKindArg>,
    #[arg(long)]
    pub actor: Option<String>,
}

#[derive(Debug, Args)]
pub struct CategoryUpdateArgs {
    pub id: String,
    #[arg(long)]
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
    #[arg(long)]
    pub actor: Option<String>,
    #[arg(long)]
    pub reason: Option<String>,
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
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub current_from: String,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub current_to: String,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub previous_from: String,
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub previous_to: String,
    #[arg(long, value_enum, default_value_t)]
    pub format: OutputFormat,
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
            Self::Init | Self::HealthCheck => "raven",
        }
    }
}

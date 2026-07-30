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
pub struct EntryAddArgs {
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
pub struct TransferArgs {
    #[arg(long)]
    pub json: Option<String>,
    #[arg(long, visible_alias = "idempotency-key")]
    pub operation_key: Option<String>,
    #[arg(long)]
    pub date: Option<String>,
    #[arg(long)]
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
    #[arg(long)]
    pub from: String,
    #[arg(long)]
    pub to: String,
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
    #[arg(long)]
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
        }
    }

    pub(crate) fn engine(&self) -> &'static str {
        match self {
            Self::Import {
                command: ImportCommand::Todo { .. },
            }
            | Self::Todo { .. } => "todo",
            Self::Ledger { .. } => "ledger",
            Self::Init | Self::HealthCheck => "raven",
        }
    }
}

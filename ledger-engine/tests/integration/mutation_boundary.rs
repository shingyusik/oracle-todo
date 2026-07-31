use std::fs;
use std::process::Command;

#[test]
fn downstream_crates_cannot_obtain_or_commit_raw_mutation_transactions() {
    let directory = tempfile::tempdir().unwrap();
    let crate_dir = directory.path().join("raw-mutation-client");
    fs::create_dir_all(crate_dir.join("src")).unwrap();
    let ledger_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .canonicalize()
        .unwrap();
    fs::write(
        crate_dir.join("Cargo.toml"),
        format!(
            "[package]\nname = \"raw-mutation-client\"\nversion = \"0.0.0\"\nedition = \"2024\"\n\n[dependencies]\nledger-engine = {{ path = {:?} }}\n",
            ledger_path
        ),
    )
    .unwrap();
    fs::write(
        crate_dir.join("src/main.rs"),
        r#"
use ledger_engine::application::ports::{
    LedgerRepository,
    LedgerTransaction,
};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;

fn main() {
    let mut repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let transaction: Box<dyn LedgerTransaction + '_> =
        repository.begin_transaction().unwrap();
    transaction.commit().unwrap();
}
"#,
    )
    .unwrap();

    let output = Command::new(env!("CARGO"))
        .args(["check", "--offline", "--quiet"])
        .env("CARGO_TARGET_DIR", directory.path().join("target"))
        .current_dir(&crate_dir)
        .output()
        .unwrap();

    assert!(
        !output.status.success(),
        "external raw mutation client unexpectedly compiled"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("private") || stderr.contains("no method named `begin_transaction`"),
        "unexpected compiler diagnostic: {stderr}"
    );
}

#[test]
fn downstream_crates_cannot_bypass_service_with_raw_repository_reads() {
    let directory = tempfile::tempdir().unwrap();
    let crate_dir = directory.path().join("raw-read-client");
    fs::create_dir_all(crate_dir.join("src")).unwrap();
    let ledger_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .canonicalize()
        .unwrap();
    fs::write(
        crate_dir.join("Cargo.toml"),
        format!(
            "[package]\nname = \"raw-read-client\"\nversion = \"0.0.0\"\nedition = \"2024\"\n\n[dependencies]\nledger-engine = {{ path = {:?} }}\n",
            ledger_path
        ),
    )
    .unwrap();
    fs::write(
        crate_dir.join("src/main.rs"),
        r#"
use ledger_engine::application::ports::{EntryQuery, LedgerRepository};
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;

fn main() {
    let repository = SqliteLedgerRepository::open_in_memory().unwrap();
    let _ = repository.list_entries(&EntryQuery::default()).unwrap();
}
"#,
    )
    .unwrap();

    let output = Command::new(env!("CARGO"))
        .args(["check", "--offline", "--quiet"])
        .env("CARGO_TARGET_DIR", directory.path().join("target"))
        .current_dir(&crate_dir)
        .output()
        .unwrap();

    assert!(
        !output.status.success(),
        "external raw read client unexpectedly compiled"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("no method named `list_entries`") || stderr.contains("private"),
        "unexpected compiler diagnostic: {stderr}"
    );
}

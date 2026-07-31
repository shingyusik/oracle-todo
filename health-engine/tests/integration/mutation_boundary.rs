use std::fs;
use std::process::Command;

#[test]
fn downstream_crates_cannot_obtain_raw_health_mutation_transactions() {
    let directory = tempfile::tempdir().unwrap();
    let crate_dir = directory.path().join("raw-health-mutation-client");
    fs::create_dir_all(crate_dir.join("src")).unwrap();
    let health_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .canonicalize()
        .unwrap();
    fs::write(
        crate_dir.join("Cargo.toml"),
        format!(
            "[package]\nname = \"raw-health-mutation-client\"\nversion = \"0.0.0\"\nedition = \"2024\"\n\n[dependencies]\nhealth-engine = {{ path = {:?} }}\n",
            health_path
        ),
    )
    .unwrap();
    fs::write(
        crate_dir.join("src/main.rs"),
        r#"
use health_engine::application::ports::{
    HealthRepository,
    HealthTransaction,
};
use health_engine::infrastructure::sqlite::SqliteHealthRepository;

fn main() {
    let mut repository = SqliteHealthRepository::open_in_memory().unwrap();
    let transaction: Box<dyn HealthTransaction + '_> =
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
        "external raw Health mutation client unexpectedly compiled"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("private") || stderr.contains("no method named `begin_transaction`"),
        "unexpected compiler diagnostic: {stderr}"
    );
}

use std::path::{Path, PathBuf};

use raven_cli::config::RavenPaths;

#[test]
fn explicit_home_builds_all_raven_paths() {
    let paths =
        RavenPaths::resolve_with_default(Some(PathBuf::from("/tmp/raven-test")), None).unwrap();

    assert_eq!(
        paths.todo_db(),
        PathBuf::from("/tmp/raven-test/todo.sqlite")
    );
    assert_eq!(
        paths.ledger_db(),
        PathBuf::from("/tmp/raven-test/ledger.sqlite")
    );
    assert_eq!(
        paths.health_db(),
        PathBuf::from("/tmp/raven-test/health.sqlite")
    );
    assert_eq!(
        paths.health_media_dir(),
        PathBuf::from("/tmp/raven-test/media/health")
    );
    assert_eq!(
        paths.log_file(),
        PathBuf::from("/tmp/raven-test/logs/raven.log.jsonl")
    );
}

#[test]
fn raven_home_env_precedes_default_home() {
    let paths =
        RavenPaths::resolve_with_default(None, Some(PathBuf::from("/tmp/from-env"))).unwrap();

    assert_eq!(paths.home(), Path::new("/tmp/from-env"));
}

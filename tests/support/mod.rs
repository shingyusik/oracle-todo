use std::path::{Path, PathBuf};

pub struct TestHome {
    dir: tempfile::TempDir,
}

impl TestHome {
    pub fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("create test home"),
        }
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn db_path(&self) -> PathBuf {
        self.path().join("todo.sqlite")
    }
}

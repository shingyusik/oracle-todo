use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::State;
use axum::http::header;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use rusqlite::{Connection, OpenFlags};
use tokio::sync::watch;

use crate::{ApiError, RavenApiState};

const DOMAINS: [&str; 3] = ["todo", "ledger", "health"];
const POLL_INTERVAL: Duration = Duration::from_secs(1);
type Epochs = [u64; 3];

pub(crate) struct ChangeFeed {
    paths: [PathBuf; 3],
    sender: Mutex<Option<watch::Sender<Epochs>>>,
}

impl ChangeFeed {
    pub(crate) fn new(paths: [PathBuf; 3]) -> Self {
        Self {
            paths,
            sender: Mutex::new(None),
        }
    }

    fn subscribe(&self) -> anyhow::Result<watch::Receiver<Epochs>> {
        let mut shared = self
            .sender
            .lock()
            .map_err(|_| anyhow::anyhow!("change feed unavailable"))?;
        if let Some(sender) = shared.as_ref().filter(|sender| !sender.is_closed()) {
            return Ok(sender.subscribe());
        }
        let (sender, receiver) = watch::channel([0; 3]);
        let worker = sender.clone();
        let paths = self.paths.clone();
        std::thread::Builder::new()
            .name("raven-changes".into())
            .spawn(move || {
                let mut stores = paths.map(StoreWatch::new);
                for store in &mut stores {
                    store.changed();
                }
                // Establish every baseline before letting clients resync their data.
                let mut epochs = [1; 3];
                worker.send_replace(epochs);
                while !worker.is_closed() {
                    std::thread::sleep(POLL_INTERVAL);
                    if worker.is_closed() {
                        break;
                    }
                    let mut changed = false;
                    for (index, store) in stores.iter_mut().enumerate() {
                        if store.changed() {
                            epochs[index] += 1;
                            changed = true;
                        }
                    }
                    if changed {
                        worker.send_replace(epochs);
                    }
                }
            })?;
        *shared = Some(sender);
        Ok(receiver)
    }
}

struct StoreWatch {
    path: PathBuf,
    connection: Option<Connection>,
    version: Option<i64>,
}

impl StoreWatch {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            connection: None,
            version: None,
        }
    }

    fn changed(&mut self) -> bool {
        let previous = self.version;
        if !self.path.is_file() {
            self.connection = None;
            self.version = None;
        } else {
            if self.connection.is_none() {
                self.connection =
                    Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok();
            }
            self.version = self.connection.as_ref().and_then(|connection| {
                connection
                    .query_row("PRAGMA data_version", [], |row| row.get(0))
                    .ok()
            });
            if self.version.is_none() {
                self.connection = None;
            }
        }
        previous != self.version
    }
}

pub(crate) async fn events(
    State(state): State<RavenApiState>,
) -> Result<impl IntoResponse, ApiError> {
    let receiver = state.changes.subscribe().map_err(ApiError::internal)?;
    let events = stream::unfold(
        (receiver, [0; 3]),
        |(mut receiver, mut previous)| async move {
            loop {
                let current = *receiver.borrow_and_update();
                let domains: Vec<_> = DOMAINS
                    .iter()
                    .enumerate()
                    .filter_map(|(index, domain)| {
                        (current[index] != previous[index]).then_some(*domain)
                    })
                    .collect();
                if !domains.is_empty() {
                    previous = current;
                    let event = Event::default()
                        .event("changes")
                        .json_data(serde_json::json!({ "domains": domains }))
                        .expect("static domain names serialize");
                    return Some((Ok::<_, Infallible>(event), (receiver, previous)));
                }
                if receiver.changed().await.is_err() {
                    return None;
                }
            }
        },
    );
    Ok((
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))),
    ))
}

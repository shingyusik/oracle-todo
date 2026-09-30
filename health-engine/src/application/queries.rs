use serde::Serialize;

use crate::application::error::HealthResult;
use crate::application::media::MediaStore;
use crate::application::ports::{HealthReadRepository, Page};
use crate::application::service::HealthService;
use crate::domain::{DietEntry, HealthEvent};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HealthRecord {
    Diet { record: DietEntry },
    HealthEvent { record: HealthEvent },
}

impl HealthRecord {
    pub fn id(&self) -> &str {
        match self {
            Self::Diet { record } => record.id().as_str(),
            Self::HealthEvent { record } => record.id().as_str(),
        }
    }
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    /// Includes historical, noncanonical, and archived records for inspection and recovery.
    pub fn inspect_records(&self, page: Page) -> HealthResult<Vec<HealthRecord>> {
        self.repository.records(page)
    }
}

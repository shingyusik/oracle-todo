use serde::Serialize;
use time::OffsetDateTime;

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::MediaStore;
use crate::application::ports::{HealthReadRepository, Page};
use crate::application::service::HealthService;
use crate::domain::{DietEntry, HealthCategory, HealthEvent};

#[derive(Debug, Clone)]
pub struct HealthQuery {
    page: Page,
    from: Option<OffsetDateTime>,
    to: Option<OffsetDateTime>,
    category: Option<HealthCategory>,
    include_archived: bool,
}

impl HealthQuery {
    pub const fn new(page: Page) -> Self {
        Self {
            page,
            from: None,
            to: None,
            category: None,
            include_archived: false,
        }
    }

    pub fn with_range(
        mut self,
        from: Option<OffsetDateTime>,
        to: Option<OffsetDateTime>,
    ) -> HealthResult<Self> {
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err(HealthError::Validation {
                field: "timeline.range",
                message: "from must not be after to".to_string(),
            });
        }
        self.from = from;
        self.to = to;
        Ok(self)
    }

    pub const fn with_category(mut self, category: HealthCategory) -> Self {
        self.category = Some(category);
        self
    }

    pub const fn include_archived(mut self, include: bool) -> Self {
        self.include_archived = include;
        self
    }

    pub const fn page(&self) -> Page {
        self.page
    }

    pub const fn from(&self) -> Option<OffsetDateTime> {
        self.from
    }

    pub const fn to(&self) -> Option<OffsetDateTime> {
        self.to
    }

    pub const fn category(&self) -> Option<HealthCategory> {
        self.category
    }

    pub const fn includes_archived(&self) -> bool {
        self.include_archived
    }
}

impl Default for HealthQuery {
    fn default() -> Self {
        Self::new(Page::default())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimelineItem {
    Diet { record: DietEntry },
    HealthEvent { record: HealthEvent },
}

impl TimelineItem {
    pub const fn occurred_at(&self) -> OffsetDateTime {
        match self {
            Self::Diet { record } => record.occurred_at(),
            Self::HealthEvent { record } => record.occurred_at(),
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Self::Diet { record } => record.id().as_str(),
            Self::HealthEvent { record } => record.id().as_str(),
        }
    }
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn timeline(&self, query: HealthQuery) -> HealthResult<Vec<TimelineItem>> {
        self.repository.timeline(&query)
    }
}

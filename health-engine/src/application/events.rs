use std::collections::BTreeSet;

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::application::commands::{CreateHealthEvent, DailyMetricInput, UpdateHealthEvent};
use crate::application::error::{HealthError, HealthResult};
use crate::application::media::MediaStore;
use crate::application::ports::{
    EventQuery, HealthMutationRepository, HealthReadRepository, HealthTransaction,
};
use crate::application::service::{
    AuditMutation, HealthService, audit_event, checked_local_date, next_update_time,
    rollback_with_primary, validate_actor, validate_reason, validation,
};
use crate::domain::{
    HealthEvent, HealthEventDetails, HealthEventRehydration, HealthRecordId, NewHealthEvent,
};

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn get_event(&self, id: &str) -> HealthResult<HealthEvent> {
        HealthRecordId::parse(id)?;
        self.repository
            .get_event(id, false)?
            .ok_or_else(|| HealthError::NotFound(format!("health event {id}")))
    }

    pub fn list_events(&self, query: EventQuery) -> HealthResult<Vec<HealthEvent>> {
        self.repository.list_events(&query, false)
    }
}

#[allow(private_bounds)]
impl<R: HealthMutationRepository, M: MediaStore> HealthService<R, M> {
    pub fn create_event(&mut self, command: CreateHealthEvent) -> HealthResult<HealthEvent> {
        validate_actor(&command.actor)?;
        let input = NewHealthEvent::new(
            command.occurred_at,
            command.details,
            command.note.as_deref(),
        )?;
        let local_date = checked_local_date(input.occurred_at(), self.local_offset)?;
        let now = OffsetDateTime::now_utc();
        let event = new_event(&input, now)?;
        let request_id = Uuid::new_v4().to_string();
        let mut transaction = self.repository.begin_transaction()?;
        let result = (|| {
            transaction.insert_event(&event, local_date, false)?;
            transaction.insert_audit_event(&event_audit(
                &request_id,
                now,
                &command.actor,
                "create",
                None,
                Some(&event),
                None,
            )?)?;
            Ok(())
        })();
        finish(transaction, result)?;
        Ok(event)
    }

    pub fn update_event(
        &mut self,
        id: &str,
        command: UpdateHealthEvent,
    ) -> HealthResult<HealthEvent> {
        HealthRecordId::parse(id)?;
        validate_actor(&command.actor)?;
        validate_reason(command.reason.as_deref())?;
        let observed = self
            .repository
            .get_event(id, false)?
            .ok_or_else(|| HealthError::NotFound(format!("health event {id}")))?;
        ensure_expected_version(&observed, command.expected_updated_at)?;
        let input = NewHealthEvent::new(
            command
                .occurred_at
                .unwrap_or_else(|| observed.occurred_at()),
            command.details.unwrap_or(observed.details()?),
            command
                .note
                .unwrap_or_else(|| observed.note().map(str::to_string))
                .as_deref(),
        )?;
        if input.category() != observed.category() || input.metric_key() != observed.metric_key() {
            return Err(validation(
                "event.identity",
                "category and metric_key cannot change",
            ));
        }
        let local_date = checked_local_date(input.occurred_at(), self.local_offset)?;
        let now = next_update_time(observed.updated_at(), "health event")?;
        let after = updated_event(&observed, &input, now)?;
        let request_id = Uuid::new_v4().to_string();
        let mut transaction = self.repository.begin_transaction()?;
        let current = match transaction.get_event(id, false)? {
            Some(current) => current,
            None => {
                return Err(rollback_with_primary(
                    transaction,
                    HealthError::NotFound(format!("health event {id}")),
                ));
            }
        };
        if current.updated_at() != observed.updated_at() {
            return Err(rollback_with_primary(
                transaction,
                HealthError::Conflict(format!("health event {id} changed since it was read")),
            ));
        }
        if same_event_content(&current, &after) {
            transaction.commit()?;
            return Ok(current);
        }
        let result = (|| {
            transaction.update_event(&after, local_date)?;
            transaction.insert_audit_event(&event_audit(
                &request_id,
                now,
                &command.actor,
                "update",
                Some(&current),
                Some(&after),
                command.reason.as_deref(),
            )?)?;
            Ok(())
        })();
        finish(transaction, result)?;
        Ok(after)
    }

    pub fn upsert_daily_metrics(
        &mut self,
        inputs: Vec<DailyMetricInput>,
    ) -> HealthResult<Vec<HealthEvent>> {
        let validated = inputs
            .into_iter()
            .map(|input| ValidatedDailyMetric::new(input, self.local_offset))
            .collect::<HealthResult<Vec<_>>>()?;
        reject_duplicate_daily_identities(&validated)?;

        let request_id = Uuid::new_v4().to_string();
        let mut transaction = self.repository.begin_transaction()?;
        let result = upsert_daily_batch(&mut *transaction, validated, &request_id);
        match result {
            Ok(events) => {
                transaction.commit()?;
                Ok(events)
            }
            Err(error) => Err(rollback_with_primary(transaction, error)),
        }
    }
}

struct ValidatedDailyMetric {
    input: NewHealthEvent,
    local_date: Date,
    actor: String,
}

impl ValidatedDailyMetric {
    fn new(input: DailyMetricInput, local_offset: time::UtcOffset) -> HealthResult<Self> {
        validate_actor(&input.actor)?;
        if !is_daily_metric(&input.details) {
            return Err(validation(
                "daily_metrics",
                "supports only weight, sleep, lab, and overall_condition",
            ));
        }
        let event = NewHealthEvent::new(input.occurred_at, input.details, input.note.as_deref())?;
        let local_date = checked_local_date(event.occurred_at(), local_offset)?;
        Ok(Self {
            input: event,
            local_date,
            actor: input.actor,
        })
    }
}

fn is_daily_metric(details: &HealthEventDetails) -> bool {
    match details {
        HealthEventDetails::Weight(_)
        | HealthEventDetails::Sleep(_)
        | HealthEventDetails::Lab(_) => true,
        HealthEventDetails::Symptom(attributes) => {
            attributes.metric_key().as_str() == "overall_condition"
        }
        HealthEventDetails::Bowel(_) | HealthEventDetails::Medication(_) => false,
    }
}

fn reject_duplicate_daily_identities(inputs: &[ValidatedDailyMetric]) -> HealthResult<()> {
    let mut identities = BTreeSet::new();
    for input in inputs {
        let identity = (
            input.local_date,
            input.input.category(),
            input.input.metric_key().as_str(),
        );
        if !identities.insert(identity) {
            return Err(validation(
                "daily_metrics",
                "contains duplicate local_date/category/metric_key identities",
            ));
        }
    }
    Ok(())
}

fn upsert_daily_batch(
    transaction: &mut dyn HealthTransaction,
    inputs: Vec<ValidatedDailyMetric>,
    request_id: &str,
) -> HealthResult<Vec<HealthEvent>> {
    let mut events = Vec::with_capacity(inputs.len());
    for input in inputs {
        let before = transaction.get_daily_event(
            input.local_date,
            input.input.category(),
            input.input.metric_key(),
        )?;
        let now = match &before {
            Some(before) => next_update_time(before.updated_at(), "health event")?,
            None => OffsetDateTime::now_utc(),
        };
        let after = match &before {
            Some(before) => updated_event(before, &input.input, now)?,
            None => new_event(&input.input, now)?,
        };
        if let Some(before) = before
            .as_ref()
            .filter(|before| same_event_content(before, &after))
        {
            events.push(before.clone());
            continue;
        }
        let action = if before.is_some() { "update" } else { "create" };
        match &before {
            Some(_) => transaction.update_event(&after, input.local_date)?,
            None => transaction.insert_event(&after, input.local_date, true)?,
        }
        transaction.insert_audit_event(&event_audit(
            request_id,
            now,
            &input.actor,
            action,
            before.as_ref(),
            Some(&after),
            None,
        )?)?;
        events.push(after);
    }
    Ok(events)
}

fn new_event(input: &NewHealthEvent, now: OffsetDateTime) -> HealthResult<HealthEvent> {
    HealthEvent::rehydrate(event_record(Uuid::new_v4().to_string(), input, now, now))
        .map_err(Into::into)
}

fn updated_event(
    before: &HealthEvent,
    input: &NewHealthEvent,
    updated_at: OffsetDateTime,
) -> HealthResult<HealthEvent> {
    HealthEvent::rehydrate(event_record(
        before.id().as_str().to_string(),
        input,
        before.created_at(),
        updated_at,
    ))
    .map_err(Into::into)
}

fn event_record(
    id: String,
    input: &NewHealthEvent,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
) -> HealthEventRehydration {
    HealthEventRehydration {
        id,
        occurred_at: input.occurred_at(),
        category: input.category(),
        metric_key: input.metric_key().as_str().to_string(),
        name: input.name().to_string(),
        value_num: input.value_num(),
        unit: input.unit().map(str::to_string),
        note: input.note().map(str::to_string),
        attributes: input.attributes().clone(),
        created_at,
        updated_at,
        deleted_at: None,
    }
}

fn same_event_content(left: &HealthEvent, right: &HealthEvent) -> bool {
    left.occurred_at() == right.occurred_at()
        && left.category() == right.category()
        && left.metric_key() == right.metric_key()
        && left.name() == right.name()
        && left.value_num().map(f64::to_bits) == right.value_num().map(f64::to_bits)
        && left.unit() == right.unit()
        && left.note() == right.note()
        && left.attributes() == right.attributes()
}

fn ensure_expected_version(
    before: &HealthEvent,
    expected_updated_at: Option<OffsetDateTime>,
) -> HealthResult<()> {
    if expected_updated_at.is_some_and(|expected| expected != before.updated_at()) {
        return Err(HealthError::Conflict(format!(
            "health event {} changed since it was read",
            before.id().as_str()
        )));
    }
    Ok(())
}

fn event_audit(
    request_id: &str,
    occurred_at: OffsetDateTime,
    actor: &str,
    action: &'static str,
    before: Option<&HealthEvent>,
    after: Option<&HealthEvent>,
    reason: Option<&str>,
) -> HealthResult<crate::application::ports::AuditEvent> {
    let record_id = after
        .or(before)
        .ok_or_else(|| HealthError::Storage("audit record snapshot is missing".to_string()))?
        .id()
        .as_str();
    audit_event(AuditMutation {
        request_id,
        occurred_at,
        actor,
        action,
        record_type: "health_event",
        record_id,
        before,
        after,
        reason,
    })
}

fn finish(
    transaction: Box<dyn HealthTransaction + '_>,
    result: HealthResult<()>,
) -> HealthResult<()> {
    match result {
        Ok(()) => transaction.commit(),
        Err(error) => Err(rollback_with_primary(transaction, error)),
    }
}

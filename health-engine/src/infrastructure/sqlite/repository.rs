use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use time::Date;
use uuid::Uuid;

use super::SqliteHealthRepository;
use super::audit_json;
use super::mapping::{
    AUDIT_COLUMNS, DIET_COLUMNS, EVENT_COLUMNS, MEDIA_COLUMNS, encode_event_json, format_date,
    format_time, row_to_audit_event, row_to_diet, row_to_event, row_to_media,
};
use super::storage_error;
use crate::application::error::{HealthError, HealthResult};
use crate::application::ports::{
    AuditActivity, AuditEvent, EventClass, EventQuery, HealthMutationRepository,
    HealthReadRepository, HealthRepository, HealthTransaction, MediaFileRecord, Page,
};
use crate::application::queries::{HealthQuery, TimelineItem};
use crate::application::trends::TrendRecords;
use crate::domain::{DietEntry, HealthCategory, HealthEvent, MetricKey};

impl HealthRepository for SqliteHealthRepository {}

impl HealthReadRepository for SqliteHealthRepository {
    fn get_diet(&self, id: &str, include_archived: bool) -> HealthResult<Option<DietEntry>> {
        get_diet_on(&self.connection, id, include_archived)
    }

    fn list_diet(&self, page: Page, include_archived: bool) -> HealthResult<Vec<DietEntry>> {
        list_diet_on(&self.connection, page, include_archived)
    }

    fn get_event(&self, id: &str, include_archived: bool) -> HealthResult<Option<HealthEvent>> {
        get_event_on(&self.connection, id, include_archived)
    }

    fn list_events(
        &self,
        query: &EventQuery,
        include_archived: bool,
    ) -> HealthResult<Vec<HealthEvent>> {
        list_events_on(&self.connection, query, include_archived)
    }

    fn get_media(&self, id: &str, include_archived: bool) -> HealthResult<Option<MediaFileRecord>> {
        get_media_on(&self.connection, id, include_archived)
    }

    fn list_audit_events(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> HealthResult<Vec<AuditEvent>> {
        let sql = format!(
            "SELECT {AUDIT_COLUMNS}
             FROM audit_events
             WHERE record_type = ?1 AND record_id = ?2
             ORDER BY occurred_at, rowid
             LIMIT ?3 OFFSET ?4"
        );
        collect_rows(
            &self.connection,
            &sql,
            params![
                record_type,
                record_id,
                i64::from(page.limit()),
                i64::from(page.offset())
            ],
            row_to_audit_event,
        )
    }

    fn list_recent_audit_activity(&self, limit: u16) -> HealthResult<Vec<AuditActivity>> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT occurred_at, action, record_id
                 FROM audit_events
                 ORDER BY occurred_at DESC, record_id, action, rowid
                 LIMIT ?1",
            )
            .map_err(storage_error)?;
        let mut rows = statement.query([i64::from(limit)]).map_err(storage_error)?;
        let mut activity = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            let timestamp: String = row.get(0).map_err(storage_error)?;
            activity.push(AuditActivity {
                occurred_at: super::schema::parse_utc_time(&timestamp)?,
                action: row.get(1).map_err(storage_error)?,
                record_id: row.get(2).map_err(storage_error)?,
            });
        }
        Ok(activity)
    }

    fn list_pending_media(&self, page: Page) -> HealthResult<Vec<MediaFileRecord>> {
        let sql = format!(
            "SELECT {MEDIA_COLUMNS}
             FROM media_files
             WHERE cleanup_pending = 1
             ORDER BY id
             LIMIT ?1 OFFSET ?2"
        );
        collect_rows(
            &self.connection,
            &sql,
            params![i64::from(page.limit()), i64::from(page.offset())],
            row_to_media,
        )
    }

    fn timeline(&self, query: &HealthQuery) -> HealthResult<Vec<TimelineItem>> {
        timeline_on(&self.connection, query)
    }

    fn trend_records(
        &self,
        start_exclusive: time::OffsetDateTime,
        end_inclusive: time::OffsetDateTime,
        limit: u32,
    ) -> HealthResult<TrendRecords> {
        trend_records_on(&self.connection, start_exclusive, end_inclusive, limit)
    }
}

impl HealthMutationRepository for SqliteHealthRepository {
    fn begin_transaction(&mut self) -> HealthResult<Box<dyn HealthTransaction + '_>> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        Ok(Box::new(SqliteHealthTransaction { transaction }))
    }
}

struct SqliteHealthTransaction<'connection> {
    transaction: Transaction<'connection>,
}

impl HealthTransaction for SqliteHealthTransaction<'_> {
    fn get_diet(&self, id: &str, include_archived: bool) -> HealthResult<Option<DietEntry>> {
        get_diet_on(&self.transaction, id, include_archived)
    }

    fn get_event(&self, id: &str, include_archived: bool) -> HealthResult<Option<HealthEvent>> {
        get_event_on(&self.transaction, id, include_archived)
    }

    fn get_daily_event(
        &self,
        local_date: Date,
        category: HealthCategory,
        metric_key: &MetricKey,
    ) -> HealthResult<Option<HealthEvent>> {
        let sql = format!(
            "SELECT {EVENT_COLUMNS}
             FROM health_events
             WHERE local_date = ?1 AND category = ?2 AND metric_key = ?3
               AND deleted_at IS NULL AND daily_upsert = 1"
        );
        let mut events = collect_rows(
            &self.transaction,
            &sql,
            params![
                format_date(local_date),
                category_value(category),
                metric_key.as_str()
            ],
            row_to_event,
        )?;
        Ok(events.pop())
    }

    fn get_media(&self, id: &str, include_archived: bool) -> HealthResult<Option<MediaFileRecord>> {
        get_media_on(&self.transaction, id, include_archived)
    }

    fn insert_media(&mut self, media: &MediaFileRecord) -> HealthResult<()> {
        media.validate()?;
        let byte_size = i64::try_from(media.byte_size).map_err(|_| HealthError::Validation {
            field: "media.byte_size",
            message: "does not fit SQLite INTEGER".to_string(),
        })?;
        self.transaction
            .execute(
                "INSERT INTO media_files (
                    id, relative_path, mime_type, byte_size, checksum_sha256,
                    cleanup_pending, created_at, updated_at, deleted_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    media.id,
                    media.relative_path,
                    media.mime_type,
                    byte_size,
                    media.checksum_sha256,
                    media.cleanup_pending,
                    format_time(media.created_at)?,
                    format_time(media.updated_at)?,
                    media.deleted_at.map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn update_media(&mut self, media: &MediaFileRecord) -> HealthResult<()> {
        media.validate()?;
        let byte_size = i64::try_from(media.byte_size).map_err(|_| HealthError::Validation {
            field: "media.byte_size",
            message: "does not fit SQLite INTEGER".to_string(),
        })?;
        let changed = self
            .transaction
            .execute(
                "UPDATE media_files SET
                    relative_path = ?2,
                    mime_type = ?3,
                    byte_size = ?4,
                    checksum_sha256 = ?5,
                    cleanup_pending = ?6,
                    updated_at = ?7,
                    deleted_at = ?8
                 WHERE id = ?1",
                params![
                    media.id,
                    media.relative_path,
                    media.mime_type,
                    byte_size,
                    media.checksum_sha256,
                    media.cleanup_pending,
                    format_time(media.updated_at)?,
                    media.deleted_at.map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        ensure_changed(changed, "media file", &media.id)
    }

    fn delete_media(&mut self, id: &str) -> HealthResult<()> {
        let changed = self
            .transaction
            .execute("DELETE FROM media_files WHERE id = ?1", [id])
            .map_err(storage_error)?;
        ensure_changed(changed, "media file", id)
    }

    fn insert_diet(&mut self, entry: &DietEntry, local_date: Date) -> HealthResult<()> {
        self.transaction
            .execute(
                "INSERT INTO diet_entries (
                    id, occurred_at, local_date, meal_type, food_name, note, media_id,
                    created_at, updated_at, deleted_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    entry.id().as_str(),
                    format_time(entry.occurred_at())?,
                    format_date(local_date),
                    entry.meal_type().to_string(),
                    entry.food_name(),
                    entry.note(),
                    entry.media_id().map(|media| media.id().as_str()),
                    format_time(entry.created_at())?,
                    format_time(entry.updated_at())?,
                    entry.deleted_at().map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn update_diet(&mut self, entry: &DietEntry, local_date: Date) -> HealthResult<()> {
        let changed = self
            .transaction
            .execute(
                "UPDATE diet_entries SET
                    occurred_at = ?2,
                    local_date = ?3,
                    meal_type = ?4,
                    food_name = ?5,
                    note = ?6,
                    media_id = ?7,
                    updated_at = ?8,
                    deleted_at = ?9
                 WHERE id = ?1",
                params![
                    entry.id().as_str(),
                    format_time(entry.occurred_at())?,
                    format_date(local_date),
                    entry.meal_type().to_string(),
                    entry.food_name(),
                    entry.note(),
                    entry.media_id().map(|media| media.id().as_str()),
                    format_time(entry.updated_at())?,
                    entry.deleted_at().map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        ensure_changed(changed, "diet entry", entry.id().as_str())
    }

    fn replace_diet_tags(&mut self, entry: &DietEntry) -> HealthResult<()> {
        self.transaction
            .execute(
                "DELETE FROM diet_entry_tags WHERE diet_entry_id = ?1",
                [entry.id().as_str()],
            )
            .map_err(storage_error)?;
        for tag in entry.tags() {
            let generated_id = Uuid::new_v4().to_string();
            self.transaction
                .execute(
                    "INSERT INTO diet_tags (id, name) VALUES (?1, ?2)
                     ON CONFLICT(name) DO NOTHING",
                    params![generated_id, tag],
                )
                .map_err(storage_error)?;
            let tag_id = self
                .transaction
                .query_row("SELECT id FROM diet_tags WHERE name = ?1", [tag], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(storage_error)?;
            self.transaction
                .execute(
                    "INSERT INTO diet_entry_tags (diet_entry_id, tag_id)
                     VALUES (?1, ?2)",
                    params![entry.id().as_str(), tag_id],
                )
                .map_err(storage_error)?;
        }
        Ok(())
    }

    fn delete_diet(&mut self, id: &str) -> HealthResult<()> {
        let changed = self
            .transaction
            .execute("DELETE FROM diet_entries WHERE id = ?1", [id])
            .map_err(storage_error)?;
        ensure_changed(changed, "diet entry", id)
    }

    fn insert_event(
        &mut self,
        event: &HealthEvent,
        local_date: Date,
        daily_upsert: bool,
    ) -> HealthResult<()> {
        self.transaction
            .execute(
                "INSERT INTO health_events (
                    id, occurred_at, local_date, category, metric_key, name,
                    value_num, unit, note, attributes_json, daily_upsert,
                    created_at, updated_at, deleted_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
                 )",
                params![
                    event.id().as_str(),
                    format_time(event.occurred_at())?,
                    format_date(local_date),
                    category_value(event.category()),
                    event.metric_key().as_str(),
                    event.name(),
                    event.value_num(),
                    event.unit(),
                    event.note(),
                    encode_event_json(event.attributes())?,
                    daily_upsert,
                    format_time(event.created_at())?,
                    format_time(event.updated_at())?,
                    event.deleted_at().map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn update_event(&mut self, event: &HealthEvent, local_date: Date) -> HealthResult<()> {
        let changed = self
            .transaction
            .execute(
                "UPDATE health_events SET
                    occurred_at = ?2,
                    local_date = ?3,
                    category = ?4,
                    metric_key = ?5,
                    name = ?6,
                    value_num = ?7,
                    unit = ?8,
                    note = ?9,
                    attributes_json = ?10,
                    updated_at = ?11,
                    deleted_at = ?12
                 WHERE id = ?1",
                params![
                    event.id().as_str(),
                    format_time(event.occurred_at())?,
                    format_date(local_date),
                    category_value(event.category()),
                    event.metric_key().as_str(),
                    event.name(),
                    event.value_num(),
                    event.unit(),
                    event.note(),
                    encode_event_json(event.attributes())?,
                    format_time(event.updated_at())?,
                    event.deleted_at().map(format_time).transpose()?,
                ],
            )
            .map_err(storage_error)?;
        ensure_changed(changed, "health event", event.id().as_str())
    }

    fn delete_event(&mut self, id: &str) -> HealthResult<()> {
        let changed = self
            .transaction
            .execute("DELETE FROM health_events WHERE id = ?1", [id])
            .map_err(storage_error)?;
        ensure_changed(changed, "health event", id)
    }

    fn insert_audit_event(&mut self, event: &AuditEvent) -> HealthResult<()> {
        event.validate()?;
        let before =
            audit_json::encode_optional(event.before.as_ref()).map_err(HealthError::Storage)?;
        let after =
            audit_json::encode_optional(event.after.as_ref()).map_err(HealthError::Storage)?;
        self.transaction
            .execute(
                "INSERT INTO audit_events (
                    id, request_id, occurred_at, actor, action, record_type,
                    record_id, before_json, after_json, reason
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    event.id,
                    event.request_id,
                    format_time(event.occurred_at)?,
                    event.actor,
                    event.action,
                    event.record_type,
                    event.record_id,
                    before,
                    after,
                    event.reason,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    fn commit(self: Box<Self>) -> HealthResult<()> {
        let Self { transaction } = *self;
        transaction.commit().map_err(storage_error)
    }

    fn rollback(self: Box<Self>) -> HealthResult<()> {
        let Self { transaction } = *self;
        transaction.rollback().map_err(storage_error)
    }
}

fn get_diet_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> HealthResult<Option<DietEntry>> {
    let visibility = if include_archived {
        ""
    } else {
        "AND deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {DIET_COLUMNS}
         FROM diet_entries
         WHERE id = ?1 {visibility}"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = statement.query([id]).map_err(storage_error)?;
    let Some(row) = rows.next().map_err(storage_error)? else {
        return Ok(None);
    };
    let tags = diet_tags_on(connection, id)?;
    row_to_diet(row, tags).map(Some)
}

fn list_diet_on(
    connection: &Connection,
    page: Page,
    include_archived: bool,
) -> HealthResult<Vec<DietEntry>> {
    let visibility = if include_archived {
        ""
    } else {
        "WHERE deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {DIET_COLUMNS}
         FROM diet_entries
         {visibility}
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?1 OFFSET ?2"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = statement
        .query(params![i64::from(page.limit()), i64::from(page.offset())])
        .map_err(storage_error)?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let id = row.get::<_, String>(0).map_err(storage_error)?;
        entries.push(row_to_diet(row, diet_tags_on(connection, &id)?)?);
    }
    Ok(entries)
}

fn get_media_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> HealthResult<Option<MediaFileRecord>> {
    let visibility = if include_archived {
        ""
    } else {
        "AND deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {MEDIA_COLUMNS}
         FROM media_files
         WHERE id = ?1 {visibility}"
    );
    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let mut rows = statement.query([id]).map_err(storage_error)?;
    let Some(row) = rows.next().map_err(storage_error)? else {
        return Ok(None);
    };
    row_to_media(row).map(Some)
}

fn diet_tags_on(connection: &Connection, id: &str) -> HealthResult<Vec<String>> {
    let mut statement = connection
        .prepare(
            "SELECT tags.name
             FROM diet_tags AS tags
             JOIN diet_entry_tags AS links ON links.tag_id = tags.id
             WHERE links.diet_entry_id = ?1
             ORDER BY tags.name",
        )
        .map_err(storage_error)?;
    statement
        .query_map([id], |row| row.get(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)
}

fn get_event_on(
    connection: &Connection,
    id: &str,
    include_archived: bool,
) -> HealthResult<Option<HealthEvent>> {
    let visibility = if include_archived {
        ""
    } else {
        "AND deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {EVENT_COLUMNS}
         FROM health_events
         WHERE id = ?1 {visibility}"
    );
    let mut events = collect_rows(connection, &sql, [id], row_to_event)?;
    Ok(events.pop())
}

fn list_events_on(
    connection: &Connection,
    query: &EventQuery,
    include_archived: bool,
) -> HealthResult<Vec<HealthEvent>> {
    let page = query.page();
    let visibility = if include_archived {
        "1 = 1"
    } else {
        "deleted_at IS NULL"
    };
    let sql = format!(
        "SELECT {EVENT_COLUMNS}
         FROM health_events
         WHERE {visibility}
           AND (?1 IS NULL OR category = ?1)
           AND (?2 IS NULL OR metric_key = ?2)
           AND (?3 = 0 OR category NOT IN ('bowel', 'medication'))
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?4 OFFSET ?5"
    );
    collect_rows(
        connection,
        &sql,
        params![
            query.category().map(category_value),
            query.metric_key().map(MetricKey::as_str),
            i64::from(matches!(query.class(), Some(EventClass::Metric))),
            i64::from(page.limit()),
            i64::from(page.offset())
        ],
        row_to_event,
    )
}

fn timeline_on(connection: &Connection, query: &HealthQuery) -> HealthResult<Vec<TimelineItem>> {
    let from = query.from().map(format_time).transpose()?;
    let to = query.to().map(format_time).transpose()?;
    let category = query.category().map(category_value);
    let sql = "
        SELECT kind, id
        FROM (
            SELECT 'diet' AS kind, id, occurred_at
            FROM diet_entries
            WHERE (?1 = 1 OR deleted_at IS NULL)
              AND ?4 IS NULL
              AND (?2 IS NULL OR occurred_at >= ?2)
              AND (?3 IS NULL OR occurred_at <= ?3)
            UNION ALL
            SELECT 'health_event' AS kind, id, occurred_at
            FROM health_events
            WHERE (?1 = 1 OR deleted_at IS NULL)
              AND (?4 IS NULL OR category = ?4)
              AND (?2 IS NULL OR occurred_at >= ?2)
              AND (?3 IS NULL OR occurred_at <= ?3)
        )
        ORDER BY occurred_at DESC, kind ASC, id ASC
        LIMIT ?5 OFFSET ?6";
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let mut rows = statement
        .query(params![
            query.includes_archived(),
            from,
            to,
            category,
            i64::from(query.page().limit()),
            i64::from(query.page().offset()),
        ])
        .map_err(storage_error)?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let kind = row.get::<_, String>(0).map_err(storage_error)?;
        let id = row.get::<_, String>(1).map_err(storage_error)?;
        items.push(match kind.as_str() {
            "diet" => TimelineItem::Diet {
                record: get_diet_on(connection, &id, true)?.ok_or_else(|| {
                    HealthError::Storage(format!("timeline diet {id} disappeared"))
                })?,
            },
            "health_event" => TimelineItem::HealthEvent {
                record: get_event_on(connection, &id, true)?.ok_or_else(|| {
                    HealthError::Storage(format!("timeline event {id} disappeared"))
                })?,
            },
            _ => {
                return Err(HealthError::Storage(
                    "timeline returned an unknown record kind".to_string(),
                ));
            }
        });
    }
    Ok(items)
}

fn trend_records_on(
    connection: &Connection,
    start_exclusive: time::OffsetDateTime,
    end_inclusive: time::OffsetDateTime,
    limit: u32,
) -> HealthResult<TrendRecords> {
    let start = format_time(start_exclusive)?;
    let end = format_time(end_inclusive)?;
    let requested = i64::from(limit) + 1;
    let diet_sql = format!(
        "SELECT {DIET_COLUMNS}
         FROM diet_entries
         WHERE deleted_at IS NULL AND occurred_at > ?1 AND occurred_at <= ?2
         ORDER BY occurred_at, id
         LIMIT ?3"
    );
    let mut statement = connection.prepare(&diet_sql).map_err(storage_error)?;
    let mut rows = statement
        .query(params![start, end, requested])
        .map_err(storage_error)?;
    let mut diets = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        let id = row.get::<_, String>(0).map_err(storage_error)?;
        diets.push(row_to_diet(row, diet_tags_on(connection, &id)?)?);
    }
    if diets.len() > limit as usize {
        return Err(HealthError::Validation {
            field: "trends.records",
            message: format!("result exceeds the {limit} record limit"),
        });
    }
    let remaining = limit - diets.len() as u32;
    let event_sql = format!(
        "SELECT {EVENT_COLUMNS}
         FROM health_events
         WHERE deleted_at IS NULL AND occurred_at > ?1 AND occurred_at <= ?2
         ORDER BY occurred_at, id
         LIMIT ?3"
    );
    let events = collect_rows(
        connection,
        &event_sql,
        params![start, end, i64::from(remaining) + 1],
        row_to_event,
    )?;
    if events.len() > remaining as usize {
        return Err(HealthError::Validation {
            field: "trends.records",
            message: format!("result exceeds the {limit} record limit"),
        });
    }
    Ok(TrendRecords { diets, events })
}

fn collect_rows<T, P>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    map: fn(&rusqlite::Row<'_>) -> HealthResult<T>,
) -> HealthResult<Vec<T>>
where
    P: rusqlite::Params,
{
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    let mut rows = statement.query(parameters).map_err(storage_error)?;
    let mut values = Vec::new();
    while let Some(row) = rows.next().map_err(storage_error)? {
        values.push(map(row)?);
    }
    Ok(values)
}

fn category_value(category: HealthCategory) -> &'static str {
    match category {
        HealthCategory::Weight => "weight",
        HealthCategory::Bowel => "bowel",
        HealthCategory::Sleep => "sleep",
        HealthCategory::Lab => "lab",
        HealthCategory::Symptom => "symptom",
        HealthCategory::Medication => "medication",
    }
}

fn ensure_changed(changed: usize, record_type: &str, id: &str) -> HealthResult<()> {
    if changed == 0 {
        return Err(HealthError::NotFound(format!("{record_type} {id}")));
    }
    Ok(())
}

import type { PlannerFilterField, PlannerTableId, PlannerTableSettings } from "@/features/workbench/model/planner-model";
import {
  effectivePlannerFilterRules,
  localCalendarDate,
  plannerFilterFieldTypes,
} from "@/features/workbench/model/planner-model";
import { tableFilterValue } from "@/features/workbench/model/table-query";
import type {
  TodoTableLookup,
  TodoTableLookups,
  TodoTableOccurrence,
  TodoTableContext,
  TodoTableScope,
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";
import type { WorkspaceTableScopeId } from "@/features/workbench/model/workspace-table-views";
import {
  apiPath, array, jsonRequest, nonEmptyString, nullableString, nullableTimestamp, type JsonObject,
  record, requestJson, safeInteger, string, timestamp,
} from "@/lib/raven-api";

export type TodoTablePage = { items: TodoTableOccurrence[]; nextOffset: number | null };

export async function queryTodoTable(
  query: { scope: TodoTableScope; context: TodoTableContext; settings: PlannerTableSettings; offset?: number },
  referenceDate: string | Pick<Date, "getFullYear" | "getMonth" | "getDate"> = new Date(),
): Promise<TodoTablePage> {
  const value = await requestJson("/api/v1/todo/table/query", jsonRequest("POST", {
    scope: query.scope,
    offset: query.offset ?? 0,
    limit: 50,
    filter_mode: query.settings.filterMode,
    filters: effectivePlannerFilterRules(
      query.settings.filterRules,
      Object.keys(plannerFilterFieldTypes) as PlannerFilterField[],
    ).map((rule) => ({
      field: rule.field, operator: rule.operator, value: tableFilterValue(rule.value, rule.operator),
    })),
    sorts: query.settings.sortRules.map((rule) => ({ field: rule.field, direction: rule.direction })),
    group_by: query.settings.groupSettings.groupBy,
    group_settings: {
      sort: query.settings.groupSettings.sort,
      hide_empty: query.settings.groupSettings.hideEmpty,
      manual_order: query.settings.groupSettings.manualOrder,
      hidden_group_keys: query.settings.groupSettings.hiddenGroupKeys,
    },
    context: contextBody(
      query.context,
      typeof referenceDate === "string" ? referenceDate : localCalendarDate(referenceDate),
    ),
  }));
  const page = record(value, "todo table page");
  const nextOffset = page.next_offset === null ? null : safeInteger(page.next_offset, "todo table page.next_offset");
  return { items: array(page.items, "todo table page.items").map(mapOccurrence), nextOffset };
}

export async function loadTodoTableLookups(scope: TodoTableScope): Promise<TodoTableLookups> {
  const value = record(await requestJson(apiPath("/api/v1/todo/table/lookups", { scope })), "todo table lookups");
  const items = array(value.items, "todo table lookups.items").map(mapLookup);
  return { items, tags: [...new Set(items.flatMap((item) => item.tags))], relatedItems: buildRelatedItems(items) };
}

export function plannerTodoTableScope(tableId: PlannerTableId): Extract<TodoTableScope, `planner.${string}`> {
  return `planner.${tableId.replace(".", "-")}` as Extract<TodoTableScope, `planner.${string}`>;
}

function contextBody(context: TodoTableContext, referenceDate: string): JsonObject {
  if (context.kind === "planner") return { from: context.from, to: context.to, reference_date: referenceDate };
  if (context.kind === "linked") return { parent_type: context.parentType, parent_id: context.parentId, reference_date: referenceDate };
  return { reference_date: referenceDate };
}

function mapOccurrence(value: unknown): TodoTableOccurrence {
  const wire = record(value, "todo table occurrence");
  return {
    key: nonEmptyString(wire.key, "todo table occurrence.key"),
    groupKey: nullableString(wire.group_key, "todo table occurrence.group_key"),
    groupLabel: nullableString(wire.group_label, "todo table occurrence.group_label"),
    record: mapWorkspaceItem(wire.record),
  };
}

function mapLookup(value: unknown): TodoTableLookup {
  const wire = record(value, "todo table lookup");
  return { id: nonEmptyString(wire.id, "todo table lookup.id"), type: itemType(wire.type), title: nonEmptyString(wire.title, "todo table lookup.title"), tags: strings(wire.tags, "todo table lookup.tags") };
}

function mapWorkspaceItem(value: unknown): WorkspaceItemModel {
  const wire = record(value, "todo table record");
  const metadata = record(wire.metadata_, "todo table record.metadata_");
  return {
    id: nonEmptyString(wire.id, "todo table record.id"), title: nonEmptyString(wire.title, "todo table record.title"),
    type: itemType(wire.type), status: nonEmptyString(wire.status, "todo table record.status"), tags: strings(wire.tags, "todo table record.tags"),
    area_id: nullableString(wire.area_id, "todo table record.area_id"), project_id: nullableString(wire.project_id, "todo table record.project_id"),
    routine_id: nullableString(wire.routine_id, "todo table record.routine_id"), parent_id: nullableString(wire.parent_id, "todo table record.parent_id"),
    description: nullableString(wire.description, "todo table record.description"), note: nullableString(wire.note, "todo table record.note"),
    outcome: nullableString(wire.outcome, "todo table record.outcome"), definition_of_done: nullableString(wire.definition_of_done, "todo table record.definition_of_done"),
    standard: nullableString(wire.standard, "todo table record.standard"), review_cycle: nullableString(wire.review_cycle, "todo table record.review_cycle"),
    recurrence_rule: nullableString(wire.recurrence_rule, "todo table record.recurrence_rule"), materialization_policy: string(wire.materialization_policy, "todo table record.materialization_policy"),
    future_occurrences: safeInteger(wire.future_occurrences, "todo table record.future_occurrences"), priority: wire.priority === null ? null : safeInteger(wire.priority, "todo table record.priority"),
    due: nullableString(wire.due, "todo table record.due"), scheduled: nullableString(wire.scheduled, "todo table record.scheduled"), horizon: nullableString(wire.horizon, "todo table record.horizon"),
    completed_at: nullableTimestamp(wire.completed_at, "todo table record.completed_at"), last_materialized_at: nullableTimestamp(wire.last_materialized_at, "todo table record.last_materialized_at"),
    created_at: timestamp(wire.created_at, "todo table record.created_at"), updated_at: timestamp(wire.updated_at, "todo table record.updated_at"),
    metadata_: {
      ...(nullableString(metadata.location, "todo table record.metadata_.location") === null ? {} : { location: string(metadata.location, "todo table record.metadata_.location") }),
      participants: strings(metadata.participants, "todo table record.metadata_.participants"),
      ...(nullableString(metadata.commitment_type, "todo table record.metadata_.commitment_type") === null ? {} : { commitment_type: string(metadata.commitment_type, "todo table record.metadata_.commitment_type") }),
    },
  };
}

function itemType(value: unknown): string {
  const decoded = string(value, "todo item type");
  if (!["area", "project", "goal", "routine", "task", "event"].includes(decoded)) throw new TypeError("invalid todo item type");
  return decoded;
}
function strings(value: unknown, field: string): string[] { return array(value, field).map((item) => string(item, field)); }
function buildRelatedItems(items: TodoTableLookup[]): WorkspaceItemsModel["relatedItems"] {
  const maps: WorkspaceItemsModel["relatedItems"] = { areas: {}, goals: {}, projects: {}, routines: {} };
  for (const item of items) {
    const target = item.type === "area" ? maps.areas : item.type === "goal" ? maps.goals : item.type === "project" ? maps.projects : item.type === "routine" ? maps.routines : null;
    if (target) target[item.id] = item.title;
  }
  return maps;
}

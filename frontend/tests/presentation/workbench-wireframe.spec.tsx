import "@testing-library/jest-dom/vitest";

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import * as healthControllerHooks from "@/features/health/hooks/useHealthController";
import type { HealthReport } from "@/features/health/model/health-reports";
import { defaultHealthTableSettings, healthDietFilterSelectOptions } from "@/features/health/model/health-table-views";
import { HealthTableViewHeader } from "@/features/health/ui/HealthTableViewHeader";

import type {
  LedgerController,
  LedgerState,
} from "@/features/ledger/hooks/useLedgerController";
import * as ledgerControllerHooks from "@/features/ledger/hooks/useLedgerController";
import {
  loadLedgerReport,
  type LedgerReportData,
} from "@/features/ledger/api/ledger-report-loader";
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";
import {
  createLedgerTableViews,
  defaultLedgerTableSettings,
} from "@/features/ledger/model/ledger-table-views";
import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";
import { buildPlannerGroupCandidates, defaultPlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import {
  buildDailyPlannerSections,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  effectivePlannerFilterRules,
  filterPlannerItemsByRules,
  groupPlannerItems,
  plannerFilterFieldTypes,
  sortPlannerItems,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";
import type {
  WorkbenchController,
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";
import { MainPanel } from "@/features/workbench/ui/MainPanel";
import { TableViewControls } from "@/features/workbench/ui/TableViewControls";
import { TableViewTabConfirmationDialog } from "@/features/workbench/ui/TableViewTabConfirmationDialog";
import { WorkbenchPageClient } from "@/features/workbench/ui/WorkbenchPageClient";
import { WorkspaceGroupedRows } from "@/features/workbench/ui/WorkspaceGroupedRows";
import { deriveWorkspaceOccurrenceGroups, deriveWorkspaceViewGroups, type WorkspaceTableScopeId } from "@/features/workbench/model/workspace-table-views";

vi.mock("@/features/ledger/api/ledger-report-loader", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/ledger/api/ledger-report-loader")>(),
  loadLedgerReport: vi.fn(),
}));

type FixtureFetch = (url: string, init?: RequestInit) => Promise<{ json(): Promise<unknown> }>;
const originalStubGlobal = vi.stubGlobal.bind(vi);

function installFixtureGlobal(name: string, value: unknown): void {
  if (name !== "fetch" || typeof value !== "function") {
    originalStubGlobal(name, value);
    return;
  }
  const fixtureFetch = value as FixtureFetch & { getMockImplementation?: () => ((...args: unknown[]) => unknown) | undefined };
  if (fixtureFetch.getMockImplementation?.()?.toString().includes("/api/v1/todo/table/query")) {
    originalStubGlobal(name, value);
    return;
  }
  const canonicalItems = new Map<string, WorkspaceItemModel>();
  originalStubGlobal(name, vi.fn((url: string, init?: RequestInit) =>
    legacyTodoTableResponse(fixtureFetch, canonicalItems, url, init)));
}

async function legacyTodoTableResponse(
  fixtureFetch: FixtureFetch,
  canonicalItems: Map<string, WorkspaceItemModel>,
  url: string,
  init?: RequestInit,
) {
  if (url.startsWith("/api/v1/todo/table/lookups")) {
    const itemTypes = ["area", "project", "goal", "routine", "task", "event"];
    const typedItems = await legacyTodoItems(fixtureFetch, canonicalItems, itemTypes);
    const allValue = await fixtureFetch("/api/v1/todo/items").then((response) => response.json());
    const items = mergeFixtureCanonicalItems(
      [...typedItems, ...(Array.isArray(allValue) ? allValue as WorkspaceItemModel[] : [])],
      canonicalItems,
      itemTypes,
    )
      .filter((item) => !["completed", "missed", "archived", "dropped", "cancelled"].includes(item.status));
    const scope = new URL(url, "http://fixture.local").searchParams.get("scope") ?? "";
    const scopedIds = scope.startsWith("planner.")
      ? new Set(fixtureScopeItems(scope, { reference_date: testToday() }, items).map((item) => item.id))
      : null;
    return fixtureJson({ items: items.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      tags: !scopedIds || scopedIds.has(item.id) ? item.tags ?? [] : [],
    })) });
  }
  if (url !== "/api/v1/todo/table/query") {
    const response = await fixtureFetch(url, init);
    if (!url.startsWith("/api/v1/todo/") || !init?.method || init.method === "GET") return response;
    let result: Promise<unknown> | null = null;
    return {
      ...response,
      json: async () => {
        result ??= response.json();
        const value = await result;
        const item = fixtureCanonicalItem(value);
        if (item) canonicalItems.set(item.id, item);
        return value;
      },
    };
  }
  const body = JSON.parse(String(init?.body)) as {
    scope: string; offset: number; filter_mode: PlannerTableSettings["filterMode"];
    filters: Array<{ field: string; operator: string; value: unknown }>;
    sorts: Array<{ field: string; direction: "asc" | "desc" }>;
    group_by: string;
    group_settings: { sort: "asc" | "desc" | "manual"; hide_empty: boolean; manual_order: string[]; hidden_group_keys: string[] };
    context: { parent_type?: string; parent_id?: string; from?: string; to?: string; reference_date: string };
  };
  const allItems = body.scope.startsWith("linked.")
    ? await legacyTodoItems(fixtureFetch, canonicalItems, [], true)
    : await legacyTodoItems(fixtureFetch, canonicalItems, fixtureTypes(body.scope));
  const relatedItems = fixtureRelatedItems(allItems);
  const settings = {
    filterMode: body.filter_mode,
    filterRules: body.filters.map((rule, index) => ({
      id: `fixture-filter-${index}`,
      ...rule,
      type: plannerFilterFieldTypes[rule.field as keyof typeof plannerFilterFieldTypes],
      value: fixtureFilterValue(rule.value),
    })),
    sortRules: body.sorts.map((rule, index) => ({ id: `fixture-sort-${index}`, ...rule })),
    groupSettings: {
      groupBy: body.group_by, sort: body.group_settings.sort,
      hideEmpty: body.group_settings.hide_empty, manualOrder: body.group_settings.manual_order,
      hiddenGroupKeys: body.group_settings.hidden_group_keys,
    },
  } as PlannerTableSettings;
  let items = fixtureScopeItems(body.scope, body.context, allItems);
  items = filterPlannerItemsByRules(
    items,
    relatedItems,
    effectivePlannerFilterRules(settings.filterRules, Object.keys(plannerFilterFieldTypes) as Array<keyof typeof plannerFilterFieldTypes>),
    settings.filterMode,
    body.context.reference_date,
  );
  items = sortPlannerItems(items, settings.sortRules);
  const groups = body.scope.startsWith("planner.")
    ? groupPlannerItems(items, relatedItems, settings.groupSettings, buildPlannerGroupCandidates({
        view: body.scope.split(".")[1] as "yearly" | "monthly" | "weekly" | "daily",
        groupBy: settings.groupSettings.groupBy, items, relatedItems,
      }))
    : deriveWorkspaceViewGroups(
        (body.scope.startsWith("workspace.") ? body.scope
          : `detail.${body.context.parent_type}.${body.scope.split(".").at(-1)}`) as WorkspaceTableScopeId,
        items, settings, relatedItems,
      );
  const occurrences = groups.flatMap((group) => group.items.map((item, index) => ({
      key: `${body.offset + index}:${group.key}:${item.id}`,
      group_key: group.key === "all" ? null : group.key,
      group_label: group.key === "all" ? null : group.label,
      record: fixtureWireRecord(item),
    }))).slice(body.offset, body.offset + 50);
  return fixtureJson({
    items: occurrences,
    next_offset: null,
  });
}

function fixtureFilterValue(value: unknown) {
  if (!value || typeof value !== "object") return value;
  if ("list" in value) return (value as { list: unknown }).list;
  if ("range" in value) return (value as { range: unknown }).range;
  if ("relative" in value) return (value as { relative: unknown }).relative;
  if ("text" in value) return (value as { text: unknown }).text;
  return null;
}

async function legacyTodoItems(
  fixtureFetch: FixtureFetch,
  canonicalItems: Map<string, WorkspaceItemModel>,
  types: string[],
  preferAll = false,
): Promise<WorkspaceItemModel[]> {
  if (preferAll) {
    const value = await fixtureFetch("/api/v1/todo/items").then((response) => response.json());
    if (Array.isArray(value) && value.length > 0) {
      return mergeFixtureCanonicalItems(value as WorkspaceItemModel[], canonicalItems, types);
    }
  }
  const values = await Promise.all(types.map(async (type) =>
    fixtureFetch(`/api/v1/todo/items?type=${type}`).then((response) => response.json())));
  const items = values.flatMap((value) => Array.isArray(value) ? value : []) as WorkspaceItemModel[];
  if (items.length === 0) {
    const value = await fixtureFetch("/api/v1/todo/items").then((response) => response.json());
    if (Array.isArray(value)) items.push(...value as WorkspaceItemModel[]);
  }
  return mergeFixtureCanonicalItems(items, canonicalItems, types);
}

function mergeFixtureCanonicalItems(
  items: WorkspaceItemModel[],
  canonicalItems: Map<string, WorkspaceItemModel>,
  types: string[],
): WorkspaceItemModel[] {
  const latest = [...canonicalItems.values()].filter((item) => types.length === 0 || types.includes(item.type));
  const archivedIds = new Set(latest.filter((item) => item.status === "archived").map((item) => item.id));
  return [...new Map(
    [...items.filter((item) => !archivedIds.has(item.id)), ...latest.filter((item) => item.status !== "archived")]
      .map((item) => [item.id, item]),
  ).values()];
}

function fixtureCanonicalItem(value: unknown): WorkspaceItemModel | null {
  if (!value || typeof value !== "object") return null;
  const candidate = "item" in value ? (value as { item: unknown }).item : value;
  if (!candidate || typeof candidate !== "object") return null;
  const item = candidate as Partial<WorkspaceItemModel>;
  return typeof item.id === "string" && typeof item.type === "string" && typeof item.title === "string"
    ? item as WorkspaceItemModel
    : null;
}

function fixtureTypes(scope: string): string[] {
  void scope;
  return ["area", "project", "goal", "routine", "task", "event"];
}

function fixtureScopeItems(scope: string, context: { parent_type?: string; parent_id?: string; from?: string; to?: string; reference_date: string }, all: WorkspaceItemModel[]) {
  if (scope.startsWith("workspace.")) return all.filter((item) => item.type === scope.split(".")[1]);
  if (scope.startsWith("linked.")) {
    const field: "area_id" | "project_id" | "routine_id" | "parent_id" = context.parent_type === "area" ? "area_id"
      : context.parent_type === "project" ? "project_id" : context.parent_type === "routine" ? "routine_id" : "parent_id";
    return all.filter((item) => item.type === scope.split(".")[2] && item[field] === context.parent_id);
  }
  const selected = scope === "planner.yearly-period-goals" && context.from
    ? `${Number(context.from.slice(0, 4)) + 1}-01-01`
    : scope === "planner.monthly-period-goals" && context.from
      ? testNextMonthStart(context.from)
      : scope.startsWith("planner.monthly-") && context.from
        ? testMonthStart(testAddDays(context.from, 7))
        : scope === "planner.weekly-month-goals" && context.from
          ? testAddDays(context.from, 7)
          : context.from ?? context.reference_date;
  if (scope.startsWith("planner.daily-")) return buildDailyPlannerSections(all, selected)[scope.split("-").at(-1) as "today" | "overdue" | "unscheduled"];
  const ranged = all.filter((item) => {
    const scheduled = item.scheduled?.slice(0, 10);
    return scheduled && (!context.from || scheduled >= context.from) && (!context.to || scheduled <= context.to);
  });
  const weekly = buildWeeklyPlannerModel(ranged, selected);
  if (scope === "planner.weekly-month-goals") return weekly.monthGoals;
  if (scope === "planner.weekly-week-goals") return weekly.weekGoals;
  if (scope === "planner.weekly-day-grid") return weekly.days.flatMap((day) => day.items);
  const monthly = buildMonthlyPeriodGoalCardsModel(ranged, selected);
  if (scope === "planner.monthly-period-goals") return monthly.carousel.flatMap((card) => card.goals);
  if (scope === "planner.monthly-week-goals") return monthly.weeks.flatMap((week) => week.goals);
  if (scope === "planner.monthly-calendar") return monthly.weeks.flatMap((week) => week.days.flatMap((day) => day.items));
  const yearly = buildYearlyPeriodGoalCardsModel(ranged, selected);
  if (scope === "planner.yearly-period-goals") return yearly.carousel.flatMap((card) => card.goals);
  if (scope === "planner.yearly-month-goals") return yearly.months.flatMap((month) => month.goals);
  return [];
}

function fixtureRelatedItems(items: WorkspaceItemModel[]): WorkspaceItemsModel["relatedItems"] {
  const related: WorkspaceItemsModel["relatedItems"] = { areas: {}, goals: {}, projects: {}, routines: {} };
  for (const item of items) {
    const target = item.type === "area" ? related.areas : item.type === "goal" ? related.goals
      : item.type === "project" ? related.projects : item.type === "routine" ? related.routines : null;
    if (target) target[item.id] = item.title;
  }
  return related;
}

function fixtureWireRecord(item: WorkspaceItemModel) {
  return {
    area_id: null, project_id: null, routine_id: null, parent_id: null,
    description: null, note: null, outcome: null, definition_of_done: null,
    standard: null, review_cycle: null, recurrence_rule: null,
    materialization_policy: "sliding", future_occurrences: 7, priority: null,
    due: null, scheduled: null, horizon: null, completed_at: null,
    last_materialized_at: null, created_at: "2026-08-22T01:00:00Z",
    updated_at: "2026-08-22T01:00:00Z",
    ...item,
    tags: item.tags ?? [],
    metadata_: {
      location: null,
      participants: [],
      commitment_type: null,
      ...item.metadata_,
    },
  };
}

function fixtureJson(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 15, 12));
  vi.spyOn(vi, "stubGlobal").mockImplementation(((name: string, value: unknown) => {
    installFixtureGlobal(name, value);
    return vi;
  }) as typeof vi.stubGlobal);
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  vi.mocked(loadLedgerReport).mockReset().mockReturnValue(new Promise(() => undefined));
});

function reportTransaction(
  id: string,
  content: string,
  overrides: Partial<LedgerEntryView["entry"]> = {},
  names: Partial<Pick<LedgerEntryView, "accountName" | "categoryName" | "currencyCode">> = {},
): LedgerEntryView {
  return {
    accountName: "Cash",
    categoryName: "Food",
    currencyCode: "KRW",
    ...names,
    entry: {
      id,
      date: "2026-08-05",
      writtenAt: "2026-08-05T00:00:00Z",
      content,
      transactionCategoryId: "category-food",
      accountId: "account-cash",
      entryType: "expense",
      amountMinor: 700,
      currencyId: "currency-krw",
      transferGroupId: null,
      source: "ui",
      notes: null,
      createdAt: "2026-08-05T00:00:00Z",
      updatedAt: "2026-08-05T00:00:00Z",
      deletedAt: null,
      ...overrides,
    },
  };
}

function reportLedgerController() {
  const current = {
    range: { start: "2026-08-01", end: "2026-08-31" },
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      incomeMinor: 3000,
      expenseMinor: 800,
      netChangeMinor: 2200,
      entryCount: 2,
    }, {
      currencyId: "currency-usd",
      currencyCode: "USD",
      decimalPlaces: 2,
      incomeMinor: 1234,
      expenseMinor: 200,
      netChangeMinor: 1034,
      entryCount: 2,
    }],
  };
  const previous = {
    range: { start: "2026-07-01", end: "2026-07-31" },
    currencies: [{
      currencyId: "currency-krw",
      currencyCode: "KRW",
      decimalPlaces: 0,
      incomeMinor: 2000,
      expenseMinor: 500,
      netChangeMinor: 1500,
      entryCount: 1,
    }, {
      currencyId: "currency-usd",
      currencyCode: "USD",
      decimalPlaces: 2,
      incomeMinor: 1000,
      expenseMinor: 350,
      netChangeMinor: 650,
      entryCount: 3,
    }],
  };
  const state: LedgerState = {
    status: "loaded",
    error: null,
    entries: [
      reportTransaction("matching", "Matching lunch"),
      reportTransaction("other-category", "Bus fare", {
        transactionCategoryId: "category-transit",
      }, { categoryName: "Transit" }),
      reportTransaction("other-account", "Card lunch", {
        accountId: "account-card",
      }, { accountName: "Card" }),
      reportTransaction("outside-range", "July lunch", { date: "2026-07-31" }),
      reportTransaction("other-currency", "Dollar lunch", {
        currencyId: "currency-usd",
      }, { currencyCode: "USD" }),
    ],
    currencies: [{
      id: "currency-krw",
      code: "KRW",
      name: "Korean won",
      symbol: "₩",
      decimalPlaces: 0,
      active: true,
    }, {
      id: "currency-usd",
      code: "USD",
      name: "US dollar",
      symbol: "$",
      decimalPlaces: 2,
      active: true,
    }],
    accountCategories: [],
    accounts: [],
    categories: [],
    balances: [{
      account: {
        id: "account-cash",
        name: "Cash",
        categoryId: "account-category-cash",
        currencyId: "currency-krw",
        openingBalanceMinor: 0,
        active: true,
      },
      currencyCode: "KRW",
      decimalPlaces: 0,
      currentBalanceMinor: 1_500,
    }],
    reportStatus: "loaded",
    reportError: null,
    reportSelection: { period: "current_month" },
    comparison: {
      current,
      previous,
      currencies: current.currencies.map((currency, index) => ({
        currencyId: currency.currencyId,
        currencyCode: currency.currencyCode,
        current: currency,
        previous: previous.currencies[index]!,
      })),
    },
    trend: {
      range: current.range,
      granularity: "daily",
      currencies: [{
        currencyId: "currency-krw",
        currencyCode: "KRW",
        points: [{
          start: "2026-08-05",
          end: "2026-08-05",
          incomeMinor: 3000,
          expenseMinor: 800,
        }],
      }, {
        currencyId: "currency-usd",
        currencyCode: "USD",
        points: [{
          start: "2026-08-05",
          end: "2026-08-05",
          incomeMinor: 1234,
          expenseMinor: 200,
        }],
      }],
    },
    summary: current,
    categoryBreakdown: [{
      ...current.currencies[0]!,
      incomeMinor: 0,
      expenseMinor: 700,
      netChangeMinor: -700,
      referenceId: "category-food",
      name: "Food",
    }, {
      ...current.currencies[0]!,
      incomeMinor: 0,
      expenseMinor: 100,
      netChangeMinor: -100,
      referenceId: null,
      name: "No reference",
    }],
  };
  let views = createLedgerTableViews({
    "ledger.transactions": {
      tabs: [{
        id: "active",
        name: "Table",
        settings: defaultLedgerTableSettings("ledger.transactions"),
      }, {
        id: "saved",
        name: "Saved",
        settings: {
          ...defaultLedgerTableSettings("ledger.transactions"),
          filterRules: [{
            id: "saved-content",
            field: "content",
            type: "text",
            operator: "contains",
            value: "saved",
          }],
        },
      }],
    },
  });
  const savedSettings = structuredClone(views["ledger.transactions"].tabs[1]!.settings);
  const ledger = {
    state,
    tableViewSaveError: null,
    retryTableViewSave: vi.fn(),
    tableViewConfirmation: null,
    tableTabs: (scope) => views[scope],
    tableSettings: (scope) => views[scope].draftSettings,
    tableIsDirty: vi.fn(() => false),
    updateTableSettings: vi.fn<LedgerController["updateTableSettings"]>((scope, updater) => {
      views = {
        ...views,
        [scope]: {
          ...views[scope],
          draftSettings: updater(views[scope].draftSettings),
        },
      };
    }),
    selectTableTab: vi.fn(),
    saveTableTab: vi.fn(),
    createTableTab: vi.fn(() => true),
    renameTableTab: vi.fn(() => true),
    requestDeleteTableTab: vi.fn(),
    confirmTableViewAction: vi.fn(),
    cancelTableViewAction: vi.fn(),
    refresh: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    transfer: vi.fn(),
    updateTransfer: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    previewPurge: vi.fn(),
    purge: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn(),
    previewAccountPurge: vi.fn(),
    purgeAccount: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    archiveCategory: vi.fn(),
    restoreCategory: vi.fn(),
    previewCategoryPurge: vi.fn(),
    purgeCategory: vi.fn(),
    createCurrency: vi.fn(),
    updateCurrency: vi.fn(),
    deactivateCurrency: vi.fn(),
    createAccountCategory: vi.fn(),
    updateAccountCategory: vi.fn(),
    deactivateAccountCategory: vi.fn(),
    previewAccountCategoryPurge: vi.fn(),
    purgeAccountCategory: vi.fn(),
    runReports: vi.fn().mockResolvedValue(undefined),
    retryReports: vi.fn().mockResolvedValue(undefined),
  } satisfies LedgerController;

  return { ledger, savedSettings };
}

function DashboardHarness({ navigationControls = false }: { navigationControls?: boolean }) {
  const controller = useWorkbenchController();
  return (
    <>
      {navigationControls ? (
        <>
          <button type="button" onClick={() => controller.selectTab("dashboard")}>
            Return to Dashboard
          </button>
          <button type="button" onClick={() => {
            controller.selectTab("ledger");
            controller.selectTab("reports");
          }}>
            Open Ledger Reports manually
          </button>
        </>
      ) : null}
      <MainPanel
        controller={{
          ...controller,
          workspaceItems: {
            status: "loaded",
            items: [],
            allItems: [],
            tagOptions: [],
            relatedItems: { areas: {}, goals: {}, projects: {}, routines: {} },
          },
        }}
      />
    </>
  );
}

function reportHealthController() {
  const range = { from: "2026-07-22", to: "2026-08-20" };
  const metricDefinitions = [
    ["body_weight", "Weight", "kg"],
    ["sleep_duration", "Sleep", "hours"],
    ["crp", "CRP", "mg/L"],
    ["fecal_calprotectin", "Calprotectin", "µg/g"],
    ["overall_condition", "Condition", null],
  ] as const;
  const report: HealthReport = {
    range,
    previousRange: range,
    metrics: metricDefinitions.map(([metric, name, unit]) => ({
      metric, name, unit,
      current: { localDate: range.to, occurredAt: `${range.to}T12:00:00Z`, value: 1 },
      previous: null,
    })),
    dietCount: { current: 1, previous: null },
    bowel: { currentCount: 1, previousCount: null, currentAverage: 6, previousAverage: null },
    medicationCount: { current: 1, previous: null },
    bowelPoints: [{ localDate: range.to, occurredAt: `${range.to}T12:00:00Z`, bristolScale: 6 }],
    metricSeries: metricDefinitions.map(([metric]) => ({ metric, points: [] })),
    medicationFrequencies: [{ name: "Mesalamine", count: 1 }],
    dietTagFrequencies: [{ name: "spicy", count: 1 }],
    dietTagBowelResponses: [],
    reactionDisclaimer: "Observed associations only; they do not establish causation.",
  };
  const scopes = ["health.diet", "health.bowel", "health.medication", "health.metrics"] as const;
  const drafts = Object.fromEntries(scopes.map((scope) => {
    const settings = {
      ...defaultHealthTableSettings(scope),
      sortRules: [{ id: `${scope}-sort`, field: "date" as const, direction: "asc" as const }],
      groupSettings: { ...defaultHealthTableSettings(scope).groupSettings, groupBy: "month" as const },
    };
    return [scope, settings];
  })) as Record<(typeof scopes)[number], ReturnType<typeof defaultHealthTableSettings>>;
  const saved = structuredClone(drafts);
  const controller = {
    state: {
      metricsStatus: "loaded", metricsError: null, metricsEntries: [],
      medicationStatus: "loaded", medicationError: null, medicationEntries: [],
      bowelStatus: "loaded", bowelError: null, bowelEntries: [],
      dietStatus: "loaded", dietError: null, dietEntries: [],
      reportStatus: "loaded", reportError: null, report, reportSelection: { preset: 30 },
      tableLookups: Object.fromEntries(scopes.map((scope) => [scope, {}])),
    },
    tableViewSaveError: null,
    tableViewConfirmation: null,
    tableTabs: (scope: (typeof scopes)[number]) => ({
      tabs: [{ id: `${scope}-saved`, name: "Saved", settings: saved[scope] }],
      activeTabId: `${scope}-saved`, draftSettings: drafts[scope],
    }),
    tableSettings: (scope: (typeof scopes)[number]) => drafts[scope],
    updateTableSettings: (scope: (typeof scopes)[number], updater: (settings: typeof drafts[typeof scope]) => typeof drafts[typeof scope]) => {
      drafts[scope] = updater(drafts[scope]);
    },
    selectTableTab: vi.fn(),
    saveTableTab: vi.fn(),
    createTableTab: vi.fn(),
    tablePage: vi.fn(() => ({
      items: [], nextOffset: null, moreStatus: "idle", moreError: null, generation: 1,
    })),
    ensureTable: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    ensureReferenceData: vi.fn(async () => true),
    hasReferenceData: vi.fn(() => true),
    runReports: vi.fn(),
    retryReports: vi.fn(),
  } as unknown as HealthController;
  return { controller, drafts, saved };
}

async function statusOptions(title: string): Promise<string[]> {
  const select = await screen.findByLabelText(`Status for ${title}`);

  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

function expectFieldBefore(firstLabel: string, secondLabel: string) {
  const first = screen.getByLabelText(firstLabel).closest(".field-label");
  const second = screen.getByLabelText(secondLabel).closest(".field-label");

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (!first || !second) {
    throw new Error(`Missing fields for order assertion: ${firstLabel}, ${secondLabel}`);
  }
  expect(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function propertyRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".property-row");
  expect(row).not.toBeNull();
  if (!row) {
    throw new Error(`Missing property row: ${label}`);
  }
  return row as HTMLElement;
}

function fieldRow(label: string): HTMLElement {
  const row = screen.getByLabelText(label).closest(".field-label");
  expect(row).not.toBeNull();
  if (!row) {
    throw new Error(`Missing field row: ${label}`);
  }
  return row as HTMLElement;
}

function expectFieldBeforeProperty(fieldLabel: string, propertyLabel: string) {
  expect(
    fieldRow(fieldLabel).compareDocumentPosition(propertyRow(propertyLabel)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

function expectPropertyImmediatelyBeforeProperty(firstLabel: string, secondLabel: string) {
  expect(propertyRow(firstLabel).nextElementSibling).toBe(propertyRow(secondLabel));
}

function expectPropertyImmediatelyBeforeField(propertyLabel: string, fieldLabel: string) {
  expect(propertyRow(propertyLabel).nextElementSibling).toBe(fieldRow(fieldLabel));
}

function plannerViewActions(name: string): HTMLElement {
  return screen.getByRole("group", { name: `${name} view actions` });
}

async function openWorkspaceTasks(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));
  await screen.findByRole("table", { name: "Tasks items" });
}

function patchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
  );
}

async function addWorkspaceStatusFilter(
  user: ReturnType<typeof userEvent.setup>,
  status: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Filter Tasks" }));
  const dialog = screen.getByRole("dialog", { name: "Filter Tasks" });
  await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
  await user.click(within(dialog).getByRole("option", { name: "Status" }));
  await user.click(
    within(dialog).getByRole("button", { name: "Select Status filter values" }),
  );
  await user.click(within(dialog).getByRole("checkbox", { name: status }));
}

function workspaceTaskRows(): HTMLElement[] {
  return screen.getAllByRole("button", { name: /^Open details for / });
}

function workspacePanelController(
  controller: WorkbenchController,
  panelId: "tasks" | "events",
  title: "Tasks" | "Events",
  workspaceItems: WorkspaceItemsModel,
): WorkbenchController {
  return {
    ...controller,
    selection: {
      ...controller.selection,
      mainTabId: "todo",
      leafTabId: panelId,
      workspaceExpanded: true,
    },
    panel: { id: panelId, title },
    workspaceItems,
  };
}

async function renderWorkspacePanelHarness() {
  const hook = renderHook(() => useWorkbenchController());
  await waitFor(() => expect(hook.result.current.workspaceItems.status).toBe("loaded"));
  const loadedItems: WorkspaceItemsModel = {
    ...hook.result.current.workspaceItems,
    status: "loaded",
    items: [],
    allItems: [],
  };
  const view = render(
    <MainPanel
      controller={workspacePanelController(
        hook.result.current,
        "tasks",
        "Tasks",
        loadedItems,
      )}
    />,
  );

  return {
    result: hook.result,
    switchPanel(panelId: "tasks" | "events", title: "Tasks" | "Events") {
      view.rerender(
        <MainPanel
          controller={workspacePanelController(
            hook.result.current,
            panelId,
            title,
            loadedItems,
          )}
        />,
      );
    },
  };
}

async function savePlannerView(
  user: ReturnType<typeof userEvent.setup>,
  tablistName: string,
  viewName = "Table",
): Promise<void> {
  const tablist = screen.getByRole("tablist", { name: tablistName });
  await user.click(within(tablist).getByRole("button", {
    name: `Open ${viewName} view menu`,
  }));
  await user.click(within(plannerViewActions(viewName)).getByRole("button", {
    name: "Save current settings",
  }));
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function testToday(): string {
  return formatDate(new Date());
}

function testWeekStart(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatDate(value);
}

function testAddDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatDate(value);
}

function testMonthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthLabelForDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function testMonthLabel(date: string): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(date.slice(5, 7)) - 1
  ] ?? date.slice(5, 7);
}

function testLongDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function controlHistoryForward() {
  const forward = window.history.forward.bind(window.history);
  const pending: Array<() => void> = [];
  const spy = vi.spyOn(window.history, "forward").mockImplementation(() => {
    pending.push(forward);
  });

  return {
    spy,
    async releaseNext() {
      const next = pending.shift();
      if (!next) {
        throw new Error("No pending history.forward() call");
      }
      const popped = new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
      });
      await act(async () => {
        next();
        await popped;
      });
    },
  };
}

function linkedAreaItemsResponse(url: string) {
  const area = { id: "area-1", type: "area", title: "Health", status: "active" };

  if (url === "/api/v1/todo/items?type=area") {
    return [area];
  }

  if (url === "/api/v1/todo/items") {
    return [
      area,
      {
        id: "project-1",
        type: "project",
        title: "Checkup",
        status: "active",
        area_id: "area-1",
      },
      {
        id: "task-1",
        type: "task",
        title: "Book appointment",
        status: "active",
        area_id: "area-1",
      },
    ];
  }

  return [];
}

async function openLinkedHealthDetail(user: ReturnType<typeof userEvent.setup>) {
  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Areas" }));
  await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
}

function linkedAreaWithOverflowResponse(url: string) {
  const area = { id: "area-1", type: "area", title: "Health", status: "active" };

  if (url === "/api/v1/todo/items?type=area") {
    return [area];
  }

  if (url === "/api/v1/todo/items") {
    return [
      area,
      {
        id: "project-1",
        type: "project",
        title: "Checkup",
        status: "active",
        area_id: "area-1",
        updated_at: "2026-07-29T07:00:00Z",
      },
      {
        id: "task-alpha",
        type: "task",
        title: "Task Alpha",
        status: "active",
        area_id: "area-1",
        project_id: "project-1",
        updated_at: "2026-07-29T08:00:00Z",
      },
      {
        id: "task-bravo",
        type: "task",
        title: "Task Bravo",
        status: "completed",
        area_id: "area-1",
        project_id: "project-1",
        updated_at: "2026-07-29T09:00:00Z",
      },
      {
        id: "task-charlie",
        type: "task",
        title: "Task Charlie",
        status: "active",
        area_id: "area-1",
        project_id: "project-1",
        updated_at: "2026-07-29T10:00:00Z",
      },
      {
        id: "task-delta",
        type: "task",
        title: "Task Delta",
        status: "completed",
        area_id: "area-1",
        project_id: "project-1",
        updated_at: "2026-07-29T11:00:00Z",
      },
      {
        id: "task-echo",
        type: "task",
        title: "Task Echo",
        status: "active",
        area_id: "area-1",
        project_id: "project-1",
        updated_at: "2026-07-29T12:00:00Z",
      },
      {
        id: "task-foxtrot",
        type: "task",
        title: "Task Foxtrot",
        status: "active",
        area_id: "area-1",
        project_id: "project-1",
        updated_at: "2026-07-29T13:00:00Z",
      },
      {
        id: "task-indirect",
        type: "task",
        title: "Indirect project task",
        status: "active",
        project_id: "project-1",
        updated_at: "2026-07-29T14:00:00Z",
      },
    ];
  }

  return [];
}

function linkedItemTypeGroup(name: string): HTMLElement {
  const group = screen.getByRole("heading", { name }).closest(".linked-items-group");
  expect(group).not.toBeNull();
  if (!group) {
    throw new Error(`Missing linked item group: ${name}`);
  }
  return group as HTMLElement;
}

async function openOverflowAreaDetail(user: ReturnType<typeof userEvent.setup>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => linkedAreaWithOverflowResponse(url),
      }),
    ),
  );

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Areas" }));
  await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
}

function nestedGoalOverflowResponse(url: string) {
  const parent = {
    id: "goal-parent",
    type: "goal",
    title: "Parent goal",
    status: "active",
    horizon: "year",
  };
  const child = {
    id: "goal-child",
    type: "goal",
    title: "Child goal",
    status: "active",
    horizon: "month",
    parent_id: "goal-parent",
  };
  const parentTasks = Array.from({ length: 6 }, (_, index) => ({
    id: `parent-task-${index + 1}`,
    type: "task",
    title: `Parent Task ${index + 1}`,
    status: "active",
    parent_id: "goal-parent",
    updated_at: `2026-07-29T${String(index + 8).padStart(2, "0")}:00:00Z`,
  }));
  const childTasks = Array.from({ length: 6 }, (_, index) => ({
    id: `child-task-${index + 1}`,
    type: "task",
    title: `Child Task ${index + 1}`,
    status: "active",
    parent_id: "goal-child",
    updated_at: `2026-07-30T${String(index + 8).padStart(2, "0")}:00:00Z`,
  }));

  if (url === "/api/v1/todo/items?type=goal") {
    return [parent, child];
  }
  if (url === "/api/v1/todo/items") {
    return [parent, child, ...parentTasks, ...childTasks];
  }
  return [];
}

function taskWithoutLinkedItemsResponse(url: string) {
  const task = { id: "task-1", type: "task", title: "Book appointment", status: "active" };

  return url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items" ? [task] : [];
}

function calendarSelectionRange(button: HTMLElement): { start: string; end: string } {
  const label = button.getAttribute("aria-label") ?? "";
  const match = label.match(/(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
  expect(match).not.toBeNull();
  if (!match) {
    throw new Error(`Calendar button is missing a selectable range: ${label}`);
  }

  return { start: match[1] ?? "", end: match[2] ?? "" };
}

function calendarSelectionDayLabel(button: HTMLElement): string {
  const label = button.getAttribute("aria-label") ?? "";
  const [dayLabel = ""] = label.split(".");
  expect(dayLabel).not.toBe("");
  return dayLabel;
}

function calendarPreviewButtons(picker: HTMLElement): HTMLElement[] {
  return within(picker)
    .getAllByRole("button")
    .filter((button) => button.classList.contains("goal-period-calendar-day-preview"));
}

function testMonthEnd(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() + 1);
  value.setDate(0);
  return formatDate(value);
}

function testNextMonthStart(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() + 1);
  return formatDate(value);
}

function testPreviousMonthStart(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  value.setMonth(value.getMonth() - 1);
  return formatDate(value);
}

async function renderMonthlyDayOverflow() {
  const user = userEvent.setup();
  const firstWeekStart = testWeekStart(testMonthStart(testToday()));
  const secondDate = testAddDays(firstWeekStart, 1);
  const responses: Record<string, unknown[]> = {
    "/api/v1/todo/items?type=goal": [],
    "/api/v1/todo/items?type=task": [
      { id: "task-earliest", type: "task", title: "Earliest task", status: "active", scheduled: firstWeekStart, updated_at: "2026-07-01T07:00:00Z" },
      { id: "task-latest", type: "task", title: "Latest task", status: "active", scheduled: firstWeekStart, updated_at: "2026-07-01T10:00:00Z" },
      { id: "task-overflow", type: "task", title: "Overflow task", status: "active", scheduled: firstWeekStart, updated_at: "2026-07-01T09:00:00Z" },
      { id: "task-second-latest", type: "task", title: "Second day latest", status: "active", scheduled: secondDate, updated_at: "2026-07-01T10:00:00Z" },
      { id: "task-second-middle", type: "task", title: "Second day middle", status: "active", scheduled: secondDate, updated_at: "2026-07-01T09:00:00Z" },
      { id: "task-second-earliest", type: "task", title: "Second day earliest", status: "active", scheduled: secondDate, updated_at: "2026-07-01T08:00:00Z" },
    ],
    "/api/v1/todo/items?type=event": [
      { id: "event-middle", type: "event", title: "Middle event", status: "active", scheduled: firstWeekStart, updated_at: "2026-07-01T08:00:00Z" },
    ],
    "/api/v1/todo/items?type=routine": [
      { id: "routine-monthly", type: "routine", title: "Monthly routine", status: "active", scheduled: firstWeekStart, updated_at: "2026-07-01T11:00:00Z" },
    ],
    "/api/v1/todo/items?type=area": [],
    "/api/v1/todo/items?type=project": [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      }),
    ),
  );

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Monthly" }));
  await screen.findByRole("region", { name: "Month goal carousel" });

  const dayCell = screen.getByRole("gridcell", { name: `${firstWeekStart} todo` });
  const moreButton = within(dayCell).getByRole("button", { name: "Show 2 more items" });
  const secondDayCell = screen.getByRole("gridcell", { name: `${secondDate} todo` });
  const secondMoreButton = within(secondDayCell).getByRole("button", { name: "Show 1 more items" });
  return { dayCell, firstWeekStart, moreButton, secondDate, secondMoreButton, user };
}

function testYearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

function testNextYearStart(date: string): string {
  const value = new Date(`${date.slice(0, 4)}-01-01T00:00:00`);
  value.setFullYear(value.getFullYear() + 1);
  return formatDate(value);
}

function useMobileViewport() {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: true,
    media: "(max-width: 760px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("WorkbenchPageClient", () => {
  it("spans shared empty rows and group headings across the declared columns", () => {
    const row = { id: "item-1" } as WorkspaceItemModel;
    const { rerender } = render(
      <table>
        <WorkspaceGroupedRows
          columnCount={4}
          emptyMessage="Nothing here."
          groups={[]}
          renderRow={() => null}
        />
      </table>,
    );

    expect(screen.getByRole("cell", { name: "Nothing here." })).toHaveAttribute(
      "colspan",
      "4",
    );

    rerender(
      <table>
        <WorkspaceGroupedRows
          columnCount={4}
          emptyMessage="Nothing here."
          groups={[{ key: "active", label: "Active", items: [row] }]}
          renderRow={(item) => (
            <tr key={item.id}>
              <td>One</td>
              <td>Two</td>
              <td>Three</td>
              <td>Four</td>
            </tr>
          )}
        />
      </table>,
    );

    expect(screen.getByRole("rowgroup", { name: "Active group" }))
      .toContainElement(screen.getByRole("rowheader", { name: "Active" }));
    expect(screen.getByRole("rowheader", { name: "Active" })).toHaveAttribute(
      "colspan",
      "4",
    );
  });

  it("renders null server groups as one unlabelled row group", () => {
    const row = { id: "item-1", title: "Ungrouped" } as WorkspaceItemModel;
    const groups = deriveWorkspaceOccurrenceGroups([{
      key: "opaque-1",
      groupKey: null,
      groupLabel: null,
      record: row,
    }]);

    render(
      <table>
        <WorkspaceGroupedRows
          columnCount={1}
          emptyMessage="Nothing here."
          groups={groups}
          renderRow={(item) => <tr key={item.id}><td>{item.title}</td></tr>}
        />
      </table>,
    );

    expect(groups[0]?.key).toBe("all");
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
    expect(screen.queryByRole("rowheader")).toBeNull();
    expect(screen.queryByRole("rowgroup", { name: /group/i })).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the Merovingian logo image", () => {
    render(<WorkbenchPageClient />);

    expect(
      screen.getByRole("img", { name: "Merovingian" }),
    ).toHaveAttribute("src", "/merovingian-mark.png");
    expect(screen.getByText("MEROVINGIAN")).toBeInTheDocument();
    expect(
      screen.getByText("CONTROL. ANALYZE. OPTIMIZE."),
    ).toBeInTheDocument();
  });

  it("uses supplied table-control policy without interpreting the scope name", async () => {
    const user = userEvent.setup();
    const adapter = {
      scopeId: "unconventional.scope",
      title: "Unconventional",
      settings: {
        filterMode: "and" as const,
        filterRules: [],
        sortRules: [{ id: "custom-sort", field: "updated" as const, direction: "desc" as const }],
        groupSettings: defaultPlannerGroupSettings(),
      },
      filterFields: ["title"] as const,
      sortFields: ["updated"] as const,
      groupOptions: [{ value: "none" as const, label: "None" }],
      candidates: [],
      filterOptions: {
        tags: [],
        daily: {
          tags: [],
          areas: [],
          projects: [],
          currencies: [],
          routines: [],
          statuses: [],
          priorities: [],
          horizons: [],
          parents: [],
          materializationPolicies: [],
          participants: [],
        },
      },
      dropdownIdPrefix: "supplied-policy",
      isDefaultSort: () => true,
      update: () => undefined,
      add: () => undefined,
    };
    const { rerender } = render(<TableViewControls adapter={adapter} />);

    const sortTrigger = screen.getByRole("button", { name: "Sort Unconventional" });
    const filterTrigger = screen.getByRole("button", { name: "Filter Unconventional" });
    expect(sortTrigger).toHaveAttribute("data-active", "false");
    expect(filterTrigger).not.toHaveAttribute("data-planner-miss-success-focus");

    rerender(
      <TableViewControls
        adapter={{ ...adapter, missSuccessFocusTarget: "supplied-focus-target" }}
      />,
    );
    expect(filterTrigger).toHaveAttribute(
      "data-planner-miss-success-focus",
      "supplied-focus-target",
    );

    await user.click(filterTrigger);
    expect(screen.getByRole("dialog", { name: "Filter Unconventional" })).toHaveAttribute(
      "id",
      "supplied-policy-filter-dropdown-unconventional-scope",
    );
  });

  it("positions filter option lists against the viewport instead of the filter panel", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 1024);
    let smallViewport = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement): DOMRect {
        const isValueTrigger = this.getAttribute("aria-label") === "Select Status filter values";
        const isOptionList = this.classList.contains("planner-filter-option-list");
        const top = isValueTrigger
          ? smallViewport ? 260 : this.querySelector(".planner-filter-chip") ? 620 : 700
          : 0;
        const left = isValueTrigger ? 120 : 0;
        const width = isOptionList ? 240 : isValueTrigger ? 180 : 0;
        const height = isOptionList ? smallViewport ? 120 : 220 : isValueTrigger ? 30 : 0;
        return {
          x: left,
          y: top,
          top,
          right: left + width,
          bottom: top + height,
          left,
          width,
          height,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    let settings: PlannerTableSettings = {
      filterMode: "and",
      filterRules: [{
        id: "status-rule",
        field: "status",
        type: "select",
        operator: "is",
        value: [],
      }],
      sortRules: [],
      groupSettings: defaultPlannerGroupSettings(),
    };
    let applyUpdate:
      ((current: PlannerTableSettings) => PlannerTableSettings) | undefined;
    const adapter = {
      scopeId: "filter-position.scope",
      title: "Filter position",
      settings,
      filterFields: ["status"] as const,
      sortFields: ["updated"] as const,
      groupOptions: [{ value: "none" as const, label: "None" }],
      candidates: [],
      filterOptions: {
        tags: [],
        daily: {
          tags: [], areas: [], projects: [], currencies: [], routines: [],
          statuses: [
            { value: "active", label: "active" },
            ...Array.from({ length: 11 }, (_, index) => ({
              value: `status-${index}`,
              label: `status ${index}`,
            })),
          ], priorities: [],
          horizons: [], parents: [], materializationPolicies: [], participants: [],
        },
      },
      dropdownIdPrefix: "filter-position",
      isDefaultSort: () => true,
      update: (updater: (current: PlannerTableSettings) => PlannerTableSettings) => {
        applyUpdate = updater;
      },
    };
    const { rerender } = render(<TableViewControls adapter={adapter} />);

    await user.click(screen.getByRole("button", { name: "Filter Filter position" }));
    const trigger = screen.getByRole("button", { name: "Select Status filter values" });
    await user.click(trigger);

    const optionList = document.querySelector<HTMLElement>(".planner-filter-option-list");
    expect(optionList).not.toBeNull();
    expect(within(optionList!).getAllByRole("checkbox")).toHaveLength(12);
    expect(optionList).toHaveStyle({ position: "fixed" });
    expect(Number.parseFloat(optionList!.style.top)).toBeLessThan(
      trigger.getBoundingClientRect().top,
    );
    expect(optionList).toHaveStyle({ top: "476px", maxHeight: "220px" });

    await user.click(within(optionList!).getByRole("checkbox", { name: "active" }));
    settings = applyUpdate!(settings);
    rerender(<TableViewControls adapter={{ ...adapter, settings }} />);

    expect(trigger).toHaveTextContent("active");
    expect(optionList).toHaveStyle({ top: "396px", maxHeight: "220px" });

    smallViewport = true;
    vi.stubGlobal("innerHeight", 300);
    fireEvent(window, new Event("resize"));

    expect(optionList).toHaveStyle({ top: "136px", maxHeight: "120px" });
  });

  it("waits for deferred filter updates before restoring removal focus", async () => {
    const user = userEvent.setup();
    let settings = {
      filterMode: "and" as const,
      filterRules: [
        { id: "title-rule", field: "title" as const, type: "text" as const, operator: "contains" as const, value: "" },
        { id: "status-rule", field: "status" as const, type: "select" as const, operator: "is" as const, value: [] as string[] },
      ],
      sortRules: [],
      groupSettings: defaultPlannerGroupSettings(),
    };
    let deferredUpdater: ((value: typeof settings) => typeof settings) | undefined;
    const adapter = {
      scopeId: "deferred.scope",
      title: "Deferred",
      settings,
      filterFields: ["title", "status"] as const,
      sortFields: ["updated"] as const,
      groupOptions: [{ value: "none" as const, label: "None" }],
      candidates: [],
      filterOptions: {
        tags: [],
        daily: {
          tags: [], areas: [], projects: [], currencies: [], routines: [], statuses: [{ value: "active", label: "active" }],
          priorities: [], horizons: [], parents: [], materializationPolicies: [], participants: [],
        },
      },
      dropdownIdPrefix: "deferred",
      isDefaultSort: () => true,
      update: (updater: typeof deferredUpdater extends ((value: infer T) => infer R) ? (value: T) => R : never) => {
        deferredUpdater = updater;
      },
    };
    const { rerender } = render(<TableViewControls adapter={adapter} />);
    await user.click(screen.getByRole("button", { name: "Filter Deferred" }));
    const filter = screen.getByRole("dialog", { name: "Filter Deferred" });
    await user.click(within(filter).getByRole("button", { name: "Remove Title filter rule" }));
    expect(within(filter).getByRole("button", { name: "Remove Title filter rule" })).toHaveFocus();

    settings = deferredUpdater!(settings);
    rerender(<TableViewControls adapter={{ ...adapter, settings }} />);
    expect(screen.getByRole("button", { name: "Remove Status filter rule" })).toHaveFocus();
  });

  it("isolates the page while using supplied confirmation lookups", () => {
    const target = { surface: "unconventional", scope: "unconventional.scope" };
    const confirmation = {
      kind: "delete" as const,
      target,
      targetTabId: "active-view",
    };
    const adapter = {
      confirmation,
      cancel: () => undefined,
      confirm: () => undefined,
      isDirty: () => true,
      activeTabId: () => "active-view",
    };

    const { container, rerender } = render(
      <TableViewTabConfirmationDialog adapter={adapter} />,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete this view?" });
    expect(dialog).toHaveTextContent(
      "Its unsaved filter, sort, and group changes will also be discarded.",
    );
    const host = dialog.closest<HTMLElement>("[data-raven-modal-host]");
    expect(host?.parentElement).toBe(document.body);
    const background = Array.from(document.body.children).filter(
      (element) => element !== host,
    );
    expect(background).not.toHaveLength(0);
    for (const element of background) {
      expect(element).toHaveAttribute("aria-hidden", "true");
      expect(element).toHaveAttribute("inert", "");
    }
    expect(document.body).toHaveStyle({ overflow: "hidden" });

    rerender(
      <TableViewTabConfirmationDialog
        adapter={{ ...adapter, confirmation: null }}
      />,
    );

    expect(container).not.toHaveAttribute("aria-hidden");
    expect(container).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });

  it("does not render static overview cards", () => {
    render(<WorkbenchPageClient />);

    expect(screen.queryByLabelText("Dashboard overview")).toBeNull();
    expect(screen.queryByText("Focus")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("does not render static panel intro copy", () => {
    render(<WorkbenchPageClient />);

    expect(screen.queryByText("Local command center")).toBeNull();
  });

  it("renders workspace and planner as todo sub navigation items", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    expect(
      screen.getByRole("button", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ToDo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Workspace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Workspace" }));

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Planner" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();
  });

  it("renders dashboard and todo in one labeled Raven navigation tree", () => {
    render(<WorkbenchPageClient />);

    const navigation = screen.getByRole("navigation", { name: "Raven navigation" });
    const dashboard = within(navigation).getByRole("button", { name: "Dashboard" });
    const todo = within(navigation).getByRole("button", { name: "ToDo" });
    const ledger = within(navigation).getByRole("button", { name: "Ledger" });
    const health = within(navigation).getByRole("button", {
      name: "Health Journal",
    });

    expect(dashboard).toHaveTextContent("Dashboard");
    expect(todo).toHaveTextContent("ToDo");
    expect(ledger).toHaveTextContent("Ledger");
    expect(health).toHaveTextContent("Health Journal");
    expect(dashboard.compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(todo.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(ledger.compareDocumentPosition(health) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(navigation.querySelector(".tree-sidebar-divider")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Quick Add" })).toBeNull();
  });

  it("opens the mobile navigation as a modal drawer and restores focus on Escape", async () => {
    useMobileViewport();
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    const trigger = screen.getByRole("button", { name: "Open Raven navigation" });
    const main = screen.getByRole("main");
    main.tabIndex = -1;
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "raven-navigation-drawer");
    expect(screen.queryByRole("dialog", { name: "Raven navigation drawer" }))
      .toBeNull();

    await user.click(trigger);

    const drawer = screen.getByRole("dialog", { name: "Raven navigation drawer" });
    const close = within(drawer).getByRole("button", {
      name: "Close Raven navigation",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("navigation", { name: "Raven navigation" }))
      .toBeInTheDocument();
    expect(close).toHaveFocus();
    expect(trigger).toHaveAttribute("inert");
    expect(trigger).toHaveAttribute("aria-hidden", "true");
    expect(main).toHaveAttribute("inert");
    expect(main).toHaveAttribute("aria-hidden", "true");
    const overlay = document.querySelector(".workbench-nav-overlay");
    expect(overlay).toHaveAttribute("role", "presentation");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay?.tagName).toBe("DIV");

    main.focus();
    expect(close).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(within(drawer).getByRole("button", { name: "Health Journal" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Raven navigation drawer" }))
      .toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("inert");
    expect(trigger).not.toHaveAttribute("aria-hidden");
    expect(main).not.toHaveAttribute("inert");
    expect(main).not.toHaveAttribute("aria-hidden");
  });

  it("opens Ledger and Health Journal at their default leaves one at a time", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    const ledger = screen.getByRole("button", { name: "Ledger" });
    const health = screen.getByRole("button", { name: "Health Journal" });

    expect(ledger).toHaveAttribute("aria-expanded", "false");
    expect(health).toHaveAttribute("aria-expanded", "false");

    await user.click(ledger);

    expect(ledger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Transactions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: "Timeline" })).toBeNull();

    await user.click(health);

    expect(ledger).toHaveAttribute("aria-expanded", "false");
    expect(health).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Transactions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Diet" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(screen.getByRole("navigation", { name: "Raven navigation" }))
      .getAllByRole("button")
      .filter((button) => ["Diet", "Bowel", "Medication", "Health Metrics", "Reports"]
        .includes(button.textContent ?? ""))
      .map((button) => button.textContent)).toEqual([
        "Diet",
        "Bowel",
        "Medication",
        "Health Metrics",
        "Reports",
      ]);
    expect(screen.queryByRole("button", { name: "Timeline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();

  });

  it("keeps the exact Diet table header after sharing it with Bowel", () => {
    const settings = defaultHealthTableSettings("health.diet");
    const health = {
      state: { tableLookups: { "health.diet": {} } },
      tableSettings: vi.fn(() => settings),
      tableTabs: vi.fn(() => ({ tabs: [{ id: "table", name: "Table", settings }],
        activeTabId: "table", draftSettings: settings })),
      tableIsDirty: vi.fn(() => false), updateTableSettings: vi.fn(), selectTableTab: vi.fn(),
      saveTableTab: vi.fn(), createTableTab: vi.fn(), renameTableTab: vi.fn(),
      requestDeleteTableTab: vi.fn(),
    } as unknown as HealthController;
    render(<HealthTableViewHeader controller={health} scope="health.diet" title="Diet"
      headingId="health-diet-heading" fieldLabels={{ meal_type: "Meal", has_photo: "Photo" }}
      fieldOptions={healthDietFilterSelectOptions} candidates={[]}
      onAdd={vi.fn()} addButtonRef={React.createRef<HTMLButtonElement>()}
      onArchiveSelected={vi.fn()} archiveButtonRef={React.createRef<HTMLButtonElement>()}
      archiveDisabled />);
    const dietActions = screen.getByRole("button", { name: "Add diet entry" }).parentElement!;
    expect([...dietActions.children]).toEqual([
      screen.getByRole("group", { name: "Diet controls" }),
      screen.getByRole("button", { name: "Add diet entry" }),
      screen.getByRole("button", { name: "Archive selected diet entries" }),
    ]);
    expect(screen.getByRole("tablist", { name: "Diet views" })).toBeInTheDocument();
    expect(health.tableSettings).toHaveBeenCalledWith("health.diet");
    expect(health.tableTabs).toHaveBeenCalledWith("health.diet");
  });

  it("drills a category report into the active Transactions draft and matching rows", async () => {
    const user = userEvent.setup();
    const workbench = renderHook(() => useWorkbenchController());
    const { ledger, savedSettings } = reportLedgerController();
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockReturnValue(ledger);
    const reportsController = {
      ...workbench.result.current,
      selection: {
        ...workbench.result.current.selection,
        mainTabId: "ledger" as const,
        leafTabId: "reports" as const,
        ledgerExpanded: true,
      },
    };
    const view = render(<MainPanel controller={reportsController} />);

    expect(screen.getByRole("button", { name: /No reference/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", {
      name: "Food, 88%, 700 KRW, expense category composition",
    }));

    expect(workbench.result.current.selection.leafTabId).toBe("transactions");
    expect(ledger.tableSettings("ledger.transactions").filterRules).toEqual([
      expect.objectContaining({ field: "date", operator: "is_between" }),
      expect.objectContaining({ field: "currency", operator: "is" }),
      expect.objectContaining({ field: "category", operator: "is" }),
    ]);
    expect(ledger.tableTabs("ledger.transactions").tabs[1]!.settings)
      .toEqual(savedSettings);

    view.rerender(<MainPanel controller={workbench.result.current} />);
    const transactions = screen.getByRole("table", { name: "Transactions" });
    expect(within(transactions).getByText("Matching lunch")).toBeInTheDocument();
    expect(within(transactions).queryByText("Bus fare")).toBeNull();
    expect(within(transactions).getByText("Card lunch")).toBeInTheDocument();
    expect(within(transactions).queryByText("July lunch")).toBeNull();
    expect(within(transactions).queryByText("Dollar lunch")).toBeNull();
  });

  it("preserves the Dashboard Ledger period and currency when opening Reports", async () => {
    const user = userEvent.setup();
    const { ledger } = reportLedgerController();
    const idleLedger = {
      ...ledger,
      state: { ...ledger.state, reportStatus: "idle" as const },
    };
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockReturnValue(idleLedger);
    vi.mocked(loadLedgerReport).mockResolvedValue({
      comparison: ledger.state.comparison!,
      categoryBreakdown: ledger.state.categoryBreakdown,
      trend: ledger.state.trend!,
      balances: ledger.state.balances,
    } satisfies LedgerReportData);
    render(<DashboardHarness />);

    const highlights = await screen.findByRole("region", { name: "Ledger highlights" });
    await user.click(within(highlights).getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(loadLedgerReport)
      .toHaveBeenLastCalledWith({ period: "previous_month" }));
    await user.click(within(highlights).getByRole("button", { name: "USD" }));
    await user.click(within(highlights).getByRole("button", { name: "Ledger highlights" }));

    expect(await screen.findByRole("region", { name: "Report analysis" }))
      .toBeVisible();
    expect(idleLedger.runReports).toHaveBeenCalledTimes(1);
    expect(idleLedger.runReports).toHaveBeenCalledWith({ period: "previous_month" });
    expect(idleLedger.runReports).not.toHaveBeenCalledWith({ period: "current_month" });
    expect(screen.getByRole("button", { name: "USD" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("retains the Dashboard report intent while Ledger initially loads", async () => {
    const user = userEvent.setup();
    const { ledger } = reportLedgerController();
    const idleLedger = {
      ...ledger,
      state: { ...ledger.state, reportStatus: "idle" as const },
    };
    const loadingLedger = {
      ...idleLedger,
      state: { ...idleLedger.state, status: "loading" as const },
    };
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockImplementation(
      function useControlledLedgerController() {
        const [loaded, setLoaded] = React.useState(false);
        React.useEffect(() => {
          let active = true;
          void loading.then(() => {
            if (active) setLoaded(true);
          });
          return () => {
            active = false;
          };
        }, []);
        return loaded ? idleLedger : loadingLedger;
      },
    );
    vi.mocked(loadLedgerReport).mockResolvedValue({
      comparison: ledger.state.comparison!,
      categoryBreakdown: ledger.state.categoryBreakdown,
      trend: ledger.state.trend!,
      balances: ledger.state.balances,
    } satisfies LedgerReportData);
    render(<DashboardHarness />);

    const highlights = await screen.findByRole("region", { name: "Ledger highlights" });
    await user.click(within(highlights).getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(loadLedgerReport)
      .toHaveBeenLastCalledWith({ period: "previous_month" }));
    await user.click(within(highlights).getByRole("button", { name: "USD" }));
    await user.click(within(highlights).getByRole("button", { name: "Ledger highlights" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Loading Ledger");
    expect(idleLedger.runReports).not.toHaveBeenCalled();

    await act(async () => {
      finishLoading();
      await loading;
    });

    expect(await screen.findByRole("region", { name: "Report analysis" })).toBeVisible();
    expect(idleLedger.runReports).toHaveBeenCalledTimes(1);
    expect(idleLedger.runReports).toHaveBeenCalledWith({ period: "previous_month" });
    expect(idleLedger.runReports).not.toHaveBeenCalledWith({ period: "current_month" });
    expect(screen.getByRole("button", { name: "USD" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("clears a Dashboard report intent abandoned during Ledger loading", async () => {
    const user = userEvent.setup();
    const { ledger } = reportLedgerController();
    const idleLedger = {
      ...ledger,
      state: { ...ledger.state, reportStatus: "idle" as const },
    };
    const loadingLedger = {
      ...idleLedger,
      state: { ...idleLedger.state, status: "loading" as const },
    };
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockImplementation(
      function useControlledLedgerController() {
        const [loaded, setLoaded] = React.useState(false);
        React.useEffect(() => {
          let active = true;
          void loading.then(() => {
            if (active) setLoaded(true);
          });
          return () => {
            active = false;
          };
        }, []);
        return loaded ? idleLedger : loadingLedger;
      },
    );
    vi.mocked(loadLedgerReport).mockResolvedValue({
      comparison: ledger.state.comparison!,
      categoryBreakdown: ledger.state.categoryBreakdown,
      trend: ledger.state.trend!,
      balances: ledger.state.balances,
    } satisfies LedgerReportData);
    render(<DashboardHarness navigationControls />);

    const highlights = await screen.findByRole("region", { name: "Ledger highlights" });
    await user.click(within(highlights).getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(loadLedgerReport)
      .toHaveBeenLastCalledWith({ period: "previous_month" }));
    await user.click(within(highlights).getByRole("button", { name: "USD" }));
    await user.click(within(highlights).getByRole("button", { name: "Ledger highlights" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading Ledger");

    await user.click(screen.getByRole("button", { name: "Return to Dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeVisible();
    await act(async () => {
      finishLoading();
      await loading;
    });
    await user.click(screen.getByRole("button", { name: "Open Ledger Reports manually" }));

    expect(await screen.findByRole("region", { name: "Report analysis" })).toBeVisible();
    expect(idleLedger.runReports).toHaveBeenCalledTimes(1);
    expect(idleLedger.runReports).toHaveBeenCalledWith({ period: "current_month" });
    expect(idleLedger.runReports).not.toHaveBeenCalledWith({ period: "previous_month" });
    expect(screen.getByRole("button", { name: "KRW" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "USD" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("applies a Dashboard Ledger category drilldown to Transactions once", async () => {
    const user = userEvent.setup();
    const { ledger } = reportLedgerController();
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockReturnValue(ledger);
    vi.mocked(loadLedgerReport).mockResolvedValue({
      comparison: ledger.state.comparison!,
      categoryBreakdown: ledger.state.categoryBreakdown,
      trend: ledger.state.trend!,
      balances: ledger.state.balances,
    } satisfies LedgerReportData);
    render(
      <React.StrictMode>
        <DashboardHarness />
      </React.StrictMode>,
    );

    await user.click(await screen.findByRole("button", {
      name: "Food, 88%, 700 KRW, expense category composition",
    }));

    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeVisible();
    expect(ledger.updateTableSettings).toHaveBeenCalledTimes(1);
    expect(ledger.tableSettings("ledger.transactions").filterRules).toEqual([
      expect.objectContaining({
        field: "date",
        operator: "is_between",
        value: { start: "2026-08-01", end: "2026-08-31" },
      }),
      expect.objectContaining({ field: "currency", operator: "is", value: ["currency-krw"] }),
      expect.objectContaining({ field: "category", operator: "is", value: ["category-food"] }),
    ]);
    const transactions = screen.getByRole("table", { name: "Transactions" });
    expect(within(transactions).getByText("Matching lunch")).toBeInTheDocument();
    expect(within(transactions).getByText("Card lunch")).toBeInTheDocument();
    expect(within(transactions).queryByText("Bus fare")).toBeNull();
    expect(within(transactions).queryByText("July lunch")).toBeNull();
    expect(within(transactions).queryByText("Dollar lunch")).toBeNull();
  });

  it("applies a Dashboard Ledger trend drilldown to Transactions once", async () => {
    const user = userEvent.setup();
    const { ledger } = reportLedgerController();
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockReturnValue(ledger);
    vi.mocked(loadLedgerReport).mockResolvedValue({
      comparison: ledger.state.comparison!,
      categoryBreakdown: ledger.state.categoryBreakdown,
      trend: ledger.state.trend!,
      balances: ledger.state.balances,
    } satisfies LedgerReportData);
    render(<DashboardHarness />);

    await user.click(await screen.findByRole("button", {
      name: "2026-08-05 Expense 800 KRW",
    }));

    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeVisible();
    expect(ledger.updateTableSettings).toHaveBeenCalledTimes(1);
    expect(ledger.tableSettings("ledger.transactions").filterRules).toEqual([
      expect.objectContaining({
        field: "date",
        operator: "is_between",
        value: { start: "2026-08-05", end: "2026-08-05" },
      }),
      expect.objectContaining({ field: "currency", operator: "is", value: ["currency-krw"] }),
      expect.objectContaining({ field: "entry_type", operator: "is", value: ["expense"] }),
    ]);
    const transactions = screen.getByRole("table", { name: "Transactions" });
    expect(within(transactions).getByText("Matching lunch")).toBeInTheDocument();
    expect(within(transactions).getByText("Bus fare")).toBeInTheDocument();
    expect(within(transactions).getByText("Card lunch")).toBeInTheDocument();
    expect(within(transactions).queryByText("July lunch")).toBeNull();
    expect(within(transactions).queryByText("Dollar lunch")).toBeNull();
  });

  it("drills an account report into Transactions without changing saved views", async () => {
    const user = userEvent.setup();
    const workbench = renderHook(() => useWorkbenchController());
    const { ledger, savedSettings } = reportLedgerController();
    vi.spyOn(ledgerControllerHooks, "useLedgerController").mockReturnValue(ledger);
    const view = render(
      <MainPanel controller={{
        ...workbench.result.current,
        selection: {
          ...workbench.result.current.selection,
          mainTabId: "ledger",
          leafTabId: "reports",
          ledgerExpanded: true,
        },
      }} />,
    );

    await user.click(screen.getByRole("button", {
      name: "Cash, 100%, 1,500 KRW, asset composition",
    }));

    expect(workbench.result.current.selection.leafTabId).toBe("transactions");
    expect(ledger.tableSettings("ledger.transactions").filterRules).toEqual([
      expect.objectContaining({ field: "currency", operator: "is" }),
      expect.objectContaining({ field: "account", operator: "is" }),
    ]);
    expect(ledger.tableTabs("ledger.transactions").tabs[1]!.settings)
      .toEqual(savedSettings);

    view.rerender(<MainPanel controller={workbench.result.current} />);
    const transactions = screen.getByRole("table", { name: "Transactions" });
    expect(within(transactions).getByText("Matching lunch")).toBeInTheDocument();
    expect(within(transactions).getByText("Bus fare")).toBeInTheDocument();
    expect(within(transactions).queryByText("Card lunch")).toBeNull();
    expect(within(transactions).getByText("July lunch")).toBeInTheDocument();
    expect(within(transactions).queryByText("Dollar lunch")).toBeNull();
  });

  it("drills every Health report target into the active saved-view draft", async () => {
    const user = userEvent.setup();
    const workbench = renderHook(() => useWorkbenchController());
    const { controller: health, drafts, saved } = reportHealthController();
    vi.spyOn(healthControllerHooks, "useHealthController").mockReturnValue(health);
    render(<MainPanel controller={{
      ...workbench.result.current,
      selection: {
        ...workbench.result.current.selection,
        mainTabId: "health",
        leafTabId: "reports",
        healthExpanded: true,
      },
    }} />);

    const rangeRule = {
      id: "health-report-date", field: "date", type: "date", operator: "is_between",
      value: { start: "2026-07-22", end: "2026-08-20" },
    };
    const cases = [
      ["spicy, 1 records", "health.diet", "diet",
        { id: "health-report-tags", field: "tags", type: "multiSelect", operator: "contains", value: ["spicy"] }],
      ["Mesalamine, 1 records", "health.medication", "medication",
        { id: "health-report-medication_name", field: "medication_name", type: "text", operator: "is", value: "Mesalamine" }],
      ["View abnormal bowel records", "health.bowel", "bowel",
        { id: "health-report-bristol_scale", field: "bristol_scale", type: "select", operator: "is", value: ["1", "2", "6", "7"] }],
      ["View Weight records for selected period", "health.metrics", "health-metrics",
        { id: "health-report-weight", field: "weight", type: "number", operator: "is_not_empty", value: null }],
      ["View Sleep records for selected period", "health.metrics", "health-metrics",
        { id: "health-report-sleep", field: "sleep", type: "number", operator: "is_not_empty", value: null }],
      ["View CRP records for selected period", "health.metrics", "health-metrics",
        { id: "health-report-crp", field: "crp", type: "number", operator: "is_not_empty", value: null }],
      ["View Calprotectin records for selected period", "health.metrics", "health-metrics",
        { id: "health-report-calprotectin", field: "calprotectin", type: "number", operator: "is_not_empty", value: null }],
      ["View Condition records for selected period", "health.metrics", "health-metrics",
        { id: "health-report-condition", field: "condition", type: "number", operator: "is_not_empty", value: null }],
      ["View Diet count records for selected period", "health.diet", "diet", null],
      ["View Bowel count records for selected period", "health.bowel", "bowel", null],
      ["View Medication count records for selected period", "health.medication", "medication", null],
    ] as const;

    for (const [button, scope, tab, targetRule] of cases) {
      await user.click(screen.getByRole("button", { name: button }));
      expect(workbench.result.current.selection.leafTabId).toBe(tab);
      expect(drafts[scope]).toMatchObject({
        filterMode: "and",
        filterRules: targetRule ? [rangeRule, targetRule] : [rangeRule],
        sortRules: [{ id: `${scope}-sort`, field: "date", direction: "asc" }],
        groupSettings: { groupBy: "month" },
      });
      expect(health.selectTableTab).toHaveBeenLastCalledWith(scope, `${scope}-saved`);
    }
    for (const scope of Object.keys(saved) as Array<keyof typeof saved>) {
      expect(health.tableTabs(scope).tabs[0]!.settings).toEqual(saved[scope]);
    }
    expect(health.saveTableTab).not.toHaveBeenCalled();
    expect(health.createTableTab).not.toHaveBeenCalled();
  });

  it("keeps top-level navigation in keyboard focus order", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "ToDo" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Ledger" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Health Journal" })).toHaveFocus();
  });

  it("shows only workspace and planner children when todo is selected", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    expect(screen.getByRole("button", { name: "ToDo" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();
  });

  it("marks todo group tabs as parent navigation", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    const workspaceTab = screen.getByRole("button", { name: "Workspace" });
    expect(workspaceTab).toContainElement(
      workspaceTab.querySelector("svg"),
    );
    expect(workspaceTab).toHaveClass("tree-sidebar-parent");
  });

  it("opens planner children from the planner sibling tab", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));

    expect(screen.getByRole("button", { name: "Planner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
  });

  it("keeps period navigation global and renders controls inside Daily and Weekly tables", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(screen.queryByRole("button", { name: "Filter planner view" })).toBeNull();
    expect(screen.getByRole("tablist", { name: "Year Goals views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Month Goals views" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    expect(screen.getByRole("group", { name: "Month Goals controls" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Week Goals controls" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Weekday grid controls" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Month Goals views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Week Goals views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Weekday grid views" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("tablist", { name: "Month Goals views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Calendar views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Week Goals views" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByRole("group", { name: "Today controls" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Before controls" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Unscheduled controls" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Today views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Before views" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Unscheduled views" })).toBeInTheDocument();
  });

  it("preserves the Daily Today table view controls and tab interactions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayControls = screen.getByRole("group", { name: "Today controls" });
    expect(within(todayControls).getByRole("button", { name: "Filter Today" })).toBeInTheDocument();
    expect(within(todayControls).getByRole("button", { name: "Sort Today" })).toBeInTheDocument();
    expect(within(todayControls).getByRole("button", { name: "Group Today" })).toBeInTheDocument();
    expect(within(todayControls).getByRole("button", { name: "Add to Today" })).toBeInTheDocument();

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    const tableTab = within(todayTabs).getByRole("tab", { name: "Table" });
    expect(tableTab).toHaveAttribute("aria-selected", "true");
    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    await user.keyboard("{Enter}");

    const savedTab = within(todayTabs).getByRole("tab", { name: "새 보기" });
    expect(savedTab).toHaveAttribute("aria-selected", "true");
    savedTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(tableTab).toHaveFocus();
    expect(savedTab).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(tableTab).toHaveAttribute("aria-selected", "true");

    const filterTrigger = within(todayControls).getByRole("button", { name: "Filter Today" });
    await user.click(filterTrigger);
    const filterDialog = screen.getByRole("dialog", { name: "Filter Today" });
    expect(document.body).toContainElement(filterDialog);
    expect(todayControls).not.toContainElement(filterDialog);
    await user.click(within(filterDialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filterDialog).getByRole("option", { name: "Title" }));
    await user.type(within(filterDialog).getByLabelText("Filter value"), "keep");
    expect(screen.getByLabelText("Active planner controls")).toHaveTextContent("1 rules");

    fireEvent.mouseDown(todayTabs);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filter Today" })).toBeNull());
    await waitFor(() => expect(filterTrigger).toHaveFocus());

    await user.click(within(todayTabs).getByRole("button", {
      name: "Open Table view menu",
    }));
    await user.click(within(plannerViewActions("Table")).getByRole("button", {
      name: "Save current settings",
    }));
    expect(within(todayTabs).getByRole("tab", { name: "Table" })).not.toHaveTextContent("•");
  });

  it("manages named tabs below each Planner table title", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    expect(within(todayTabs).getByRole("tab", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    const nameInput = screen.getByRole("textbox", { name: "View name" });
    expect(nameInput).toHaveValue("새 보기");
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveProperty("selectionStart", 0);
    expect(nameInput).toHaveProperty("selectionEnd", "새 보기".length);
    await user.keyboard("{Enter}");

    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Title" }));
    expect(within(todayTabs).getByRole("tab", {
      name: "새 보기, 저장되지 않은 변경사항",
    })).toHaveTextContent("•");

    await user.click(within(todayTabs).getByRole("button", {
      name: "Open 새 보기 view menu",
    }));
    const actionsOverlay =
      document.querySelector(".planner-table-tab-menu")?.parentElement ?? null;
    expect(actionsOverlay).toHaveClass("planner-table-tab-overlay");
    expect(todayTabs).not.toContainElement(actionsOverlay);
    expect(todayTabs).not.toHaveAttribute("data-overlay-open");
    expect(actionsOverlay).toHaveStyle({ position: "fixed" });
    await user.click(within(plannerViewActions("새 보기")).getByRole("button", {
      name: "Save current settings",
    }));
    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).not.toHaveTextContent("•");
  });

  it("remeasures the tab editor overlay when validation changes its height", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement): DOMRect {
        const isAddTrigger = this.getAttribute("aria-label") === "Add Today view";
        const isOverlay = this.classList.contains("planner-table-tab-overlay");
        const height = isOverlay
          ? this.querySelector(".planner-table-tab-name-error") ? 160 : 80
          : 20;
        const top = isAddTrigger ? 700 : 0;
        const left = isAddTrigger ? 100 : 0;
        const width = isOverlay ? 220 : 20;
        return {
          x: left,
          y: top,
          top,
          right: left + width,
          bottom: top + height,
          left,
          width,
          height,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(within(
      screen.getByRole("tablist", { name: "Today views" }),
    ).getByRole("button", { name: "Add Today view" }));

    const overlay = document.querySelector<HTMLElement>(".planner-table-tab-overlay");
    expect(overlay).not.toBeNull();
    await waitFor(() => expect(overlay).toHaveStyle({ top: "616px" }));

    await user.clear(screen.getByRole("textbox", { name: "View name" }));
    await user.keyboard("{Enter}");

    expect(screen.getByText("View name is required.")).toBeInTheDocument();
    await waitFor(() => expect(overlay).toHaveStyle({ top: "536px" }));
  });

  it("cancels add and rename popovers with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    const addTrigger = within(todayTabs).getByRole("button", { name: "Add Today view" });
    await user.click(addTrigger);
    await user.clear(screen.getByRole("textbox", { name: "View name" }));
    await user.keyboard("{Enter}");
    expect(screen.getByText("View name is required.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "View name" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull();
    expect(addTrigger).toHaveFocus();

    await user.click(addTrigger);
    await user.keyboard("{Enter}");
    await user.click(within(todayTabs).getByRole("button", {
      name: "Open 새 보기 view menu",
    }));
    const renameTrigger = within(plannerViewActions("새 보기")).getByRole("button", {
      name: "Rename",
    });
    await user.click(renameTrigger);
    expect(screen.getByRole("textbox", { name: "View name" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull();
    expect(renameTrigger).toHaveFocus();
  });

  it("moves tab focus with arrows without selecting until Enter", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    await user.keyboard("{Enter}");

    const tableTab = within(todayTabs).getByRole("tab", { name: "Table" });
    const newTab = within(todayTabs).getByRole("tab", { name: "새 보기" });
    newTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(tableTab).toHaveFocus();
    expect(tableTab).toHaveAttribute("aria-selected", "false");
    expect(newTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(tableTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(newTab).toHaveFocus();
    expect(tableTab).toHaveAttribute("aria-selected", "true");
    await user.keyboard(" ");
    expect(newTab).toHaveAttribute("aria-selected", "true");
  });

  it("suffixes rename collisions and scopes save and delete menu actions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    const tableMenu = within(todayTabs).getByRole("button", {
      name: "Open Table view menu",
    });
    await user.click(tableMenu);
    const tableActions = screen.getByRole("group", { name: "Table view actions" });
    expect(tableMenu).toHaveAttribute("aria-controls", tableActions.id);
    expect(tableMenu).not.toHaveAttribute("aria-haspopup");
    expect(within(tableActions).getByRole("button", {
      name: "Save current settings",
    })).toBeDisabled();
    const renameAction = within(tableActions).getByRole("button", { name: "Rename" });
    expect(within(tableActions).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(renameAction).toHaveFocus();
    await user.keyboard("{Escape}");

    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    await user.keyboard("{Enter}");
    await user.click(tableMenu);
    const reopenedTableActions = plannerViewActions("Table");
    expect(within(reopenedTableActions).queryByRole("button", {
      name: "Save current settings",
    })).toBeNull();
    expect(within(reopenedTableActions).getByRole("button", { name: "Delete" })).toBeEnabled();
    await user.click(within(reopenedTableActions).getByRole("button", { name: "Rename" }));
    const renameInput = screen.getByRole("textbox", { name: "View name" });
    await user.clear(renameInput);
    await user.type(renameInput, "새 보기{Enter}");

    const renamedTab = within(todayTabs).getByRole("tab", { name: "새 보기 2" });
    expect(renamedTab).toBeInTheDocument();
  });

  it("focuses the renamed tab after a successful rename", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    await user.click(within(todayTabs).getByRole("button", {
      name: "Open Table view menu",
    }));
    await user.click(within(plannerViewActions("Table")).getByRole("button", {
      name: "Rename",
    }));
    const renameInput = screen.getByRole("textbox", { name: "View name" });
    await user.clear(renameInput);
    await user.type(renameInput, "Renamed{Enter}");

    expect(within(todayTabs).getByRole("tab", { name: "Renamed" })).toHaveFocus();
  });

  it("deletes tabs through confirmation and activates the right neighbor then the left", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    const addTrigger = within(todayTabs).getByRole("button", { name: "Add Today view" });
    await user.click(addTrigger);
    await user.keyboard("{Enter}");

    await user.click(within(todayTabs).getByRole("tab", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Title" }));
    await user.click(within(todayTabs).getByRole("button", {
      name: "Open Table view menu",
    }));
    const deleteMenuItem = within(plannerViewActions("Table")).getByRole("button", {
      name: "Delete",
    });
    await user.click(deleteMenuItem);
    const firstDialog = screen.getByRole("dialog", { name: "Delete this view?" });
    const cancelButton = within(firstDialog).getByRole("button", { name: "Cancel" });
    const confirmDeleteButton = within(firstDialog).getByRole("button", { name: "Delete" });
    expect(cancelButton).toHaveFocus();
    expect(firstDialog).toHaveTextContent(
      "Its unsaved filter, sort, and group changes will also be discarded.",
    );
    await user.tab({ shift: true });
    expect(confirmDeleteButton).toHaveFocus();
    await user.tab();
    expect(cancelButton).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Delete this view?" })).toBeNull();
    await waitFor(() => expect(deleteMenuItem).toHaveFocus());
    await user.click(deleteMenuItem);
    await user.click(within(
      screen.getByRole("dialog", { name: "Delete this view?" }),
    ).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(deleteMenuItem).toHaveFocus());
    await user.click(deleteMenuItem);
    await user.click(within(
      screen.getByRole("dialog", { name: "Delete this view?" }),
    ).getByRole("button", { name: "Delete" }));
    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(
      within(todayTabs).getByRole("tab", { name: "새 보기" }),
    ).toHaveFocus());

    await user.click(addTrigger);
    await user.clear(screen.getByRole("textbox", { name: "View name" }));
    await user.type(screen.getByRole("textbox", { name: "View name" }), "끝{Enter}");
    await user.click(within(todayTabs).getByRole("button", {
      name: "Open 끝 view menu",
    }));
    await user.click(within(plannerViewActions("끝")).getByRole("button", {
      name: "Delete",
    }));
    await user.click(within(
      screen.getByRole("dialog", { name: "Delete this view?" }),
    ).getByRole("button", { name: "Delete" }));
    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(
      within(todayTabs).getByRole("tab", { name: "새 보기" }),
    ).toHaveFocus());
  });

  it("keeps the dirty delete warning and target after delayed stored tabs load", async () => {
    const user = userEvent.setup();
    let resolveSettings:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/v1/preferences/planner.v1") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return new Promise((resolve) => {
          resolveSettings = resolve;
        });
      }
      writes.push(JSON.parse(String(init.body)).value);
      return Promise.resolve({ ok: true, json: async () => null });
    }));
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    await user.click(within(todayTabs).getByRole("button", {
      name: "Add Today view",
    }));
    await user.keyboard("{Enter}");
    await user.click(within(todayTabs).getByRole("tab", { name: "Table" }));
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Title" }));
    await user.click(within(todayTabs).getByRole("button", {
      name: "Open Table view menu",
    }));
    await user.click(within(plannerViewActions("Table")).getByRole("button", {
      name: "Delete",
    }));

    const dialog = screen.getByRole("dialog", { name: "Delete this view?" });
    expect(dialog).toHaveTextContent(
      "Its unsaved filter, sort, and group changes will also be discarded.",
    );
    expect(writes).toHaveLength(0);

    await waitFor(() => expect(resolveSettings).toBeDefined());
    await act(async () => resolveSettings?.({
      ok: true,
      json: async () => ({
        tableTabs: {
          "daily.today": {
            tabs: [
              { id: "stored-one", name: "Stored one", settings: {} },
              { id: "stored-two", name: "Stored two", settings: {} },
            ],
          },
        },
      }),
    }));

    await waitFor(() =>
      expect(within(todayTabs).getByRole("tab", {
        name: "Stored one, 저장되지 않은 변경사항",
        hidden: true,
      })).toBeInTheDocument(),
    );
    expect(dialog).toHaveTextContent(
      "Its unsaved filter, sort, and group changes will also be discarded.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(within(todayTabs).queryByRole("tab", { name: /^Stored one/ })).toBeNull();
    expect(within(todayTabs).getByRole("tab", { name: "Stored two" })).toBeInTheDocument();
    expect(within(todayTabs).getByRole("tab", { name: "새 보기" })).toBeInTheDocument();
  });

  it("cancels and confirms dirty Planner navigation through the discard dialog", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Title" }));

    const activeDirtyTab = within(todayTabs).getByRole("tab", {
      name: "새 보기, 저장되지 않은 변경사항",
    });
    const dailyButton = screen.getByRole("button", { name: "Daily" });
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });
    await user.click(weeklyButton);

    const firstDialog = screen.getByRole("dialog", {
      name: "Discard unsaved view changes?",
    });
    expect(firstDialog).toHaveTextContent(
      "Your unsaved filter, sort, and group changes will be lost.",
    );
    expect(within(firstDialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(activeDirtyTab).toHaveAttribute("aria-selected", "true");
    expect(dailyButton).toHaveAttribute("data-active", "true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", {
      name: "Discard unsaved view changes?",
    })).toBeNull();
    expect(activeDirtyTab).toHaveAttribute("aria-selected", "true");
    expect(dailyButton).toHaveAttribute("data-active", "true");

    await user.click(weeklyButton);
    await user.click(within(
      screen.getByRole("dialog", { name: "Discard unsaved view changes?" }),
    ).getByRole("button", { name: "Discard changes" }));
    expect(weeklyButton).toHaveAttribute("data-active", "true");
    expect(screen.queryByRole("tablist", { name: "Today views" })).toBeNull();
  });

  it("keeps Planner table tab state isolated between two Daily tables", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const todayTabs = screen.getByRole("tablist", { name: "Today views" });
    const beforeTabs = screen.getByRole("tablist", { name: "Before views" });
    await user.click(within(todayTabs).getByRole("button", { name: "Add Today view" }));
    await user.keyboard("{Enter}");

    expect(within(todayTabs).getAllByRole("tab")).toHaveLength(2);
    expect(within(beforeTabs).getAllByRole("tab")).toHaveLength(1);
    expect(within(beforeTabs).getByRole("tab", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Title" }));
    expect(within(todayTabs).getByRole("tab", {
      name: "새 보기, 저장되지 않은 변경사항",
    })).toBeInTheDocument();
    expect(within(beforeTabs).getByRole("tab", { name: "Table" })).toBeInTheDocument();
  });

  it("keeps workspace and planner sibling branches open together", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps workspace and planner independently expanded in the tree", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();
  });

  it("collapses workspace and planner when their expanded buttons are clicked again", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.queryByRole("button", { name: "Areas" })).toBeNull();
    expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.queryByRole("button", { name: "Yearly" })).toBeNull();
    expect(screen.getByRole("button", { name: "ToDo" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("changes the main panel when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("loads selected workspace items from todo-engine into a table", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "area-1",
          type: "area",
          title: "Health",
          status: "active",
          review_cycle: "weekly",
          standard: "Move daily",
          note: "Morning review",
          created_at: "2026-06-21T00:00:00Z",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/todo/items?type=area"),
    );
    expect(screen.getByRole("table", { name: "Areas items" })).toBeInTheDocument();
    expect(screen.getByLabelText("Select all visible items").closest("th")).toHaveClass(
      "selection-column",
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "active" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "weekly" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Morning review" })).toBeInTheDocument();
  });

  it("exposes shared view controls and saved tabs on every Workspace table", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    for (const title of ["Areas", "Projects", "Goals", "Routines", "Tasks", "Events"]) {
      await user.click(screen.getByRole("button", { name: title }));
      const controls = await screen.findByRole("group", { name: `${title} controls` });

      expect(within(controls).getByRole("button", { name: `Filter ${title}` })).toBeVisible();
      expect(within(controls).getByRole("button", { name: `Sort ${title}` })).toBeVisible();
      expect(within(controls).getByRole("button", { name: `Group ${title}` })).toBeVisible();
      expect(within(controls).getByRole("button", { name: `Add to ${title}` })).toBeVisible();
      expect(screen.getByRole("tablist", { name: `${title} views` })).toBeVisible();
      const table = screen.getByRole("table", { name: `${title} items` });
      const emptyCell = screen.getByText(`No ${title.toLowerCase()} found.`).closest("td");

      expect(emptyCell).toBeVisible();
      expect(emptyCell).toHaveAttribute(
        "colspan",
        String(within(table).getAllByRole("columnheader").length),
      );
    }

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(screen.getByRole("button", { name: "Filter Tasks" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sort Tasks" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Group Tasks" })).toBeVisible();
    expect(screen.getByRole("tablist", { name: "Tasks views" })).toBeVisible();
  });

  it("discards an Add-view editor when switching Workspace scopes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    const { result, switchPanel } = await renderWorkspacePanelHarness();
    const taskTabs = screen.getByRole("tablist", { name: "Tasks views" });
    await user.click(within(taskTabs).getByRole("button", { name: "Add Tasks view" }));
    const editor = screen.getByRole("textbox", { name: "View name" });
    await user.clear(editor);
    await user.type(editor, "Leaked event view");

    switchPanel("events", "Events");
    const staleEditor = screen.queryByRole("textbox", { name: "View name" });
    if (staleEditor) {
      staleEditor.focus();
      await user.keyboard("{Enter}");
    }

    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull();
    expect(
      result.current.workspaceTableTabs("workspace.event").tabs.map(({ name }) => name),
    ).toEqual(["Table"]);
    expect(
      result.current.workspaceTableTabs("workspace.task").tabs.map(({ name }) => name),
    ).toEqual(["Table"]);
  });

  it("closes an open filter without leaking transient state across Workspace scopes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    const { switchPanel } = await renderWorkspacePanelHarness();
    await user.click(screen.getByRole("button", { name: "Filter Tasks" }));
    expect(screen.getByRole("dialog", { name: "Filter Tasks" })).toBeVisible();

    switchPanel("events", "Events");
    const eventTabs = screen.getByRole("tablist", { name: "Events views" });
    expect(screen.queryByRole("dialog", { name: "Filter Tasks" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Filter Events" })).toBeNull();
    expect(within(eventTabs).getByRole("tab", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Filter Events" })).toHaveAttribute(
      "data-active",
      "false",
    );

    switchPanel("tasks", "Tasks");
    const taskTabs = screen.getByRole("tablist", { name: "Tasks views" });
    expect(within(taskTabs).getByRole("tab", { name: "Table" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Filter Tasks" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("filters Workspace rows and selects only the derived visible rows", async () => {
    const user = userEvent.setup();
    const tasks = [
      {
        id: "task-active",
        type: "task",
        title: "Active task",
        status: "active",
        updated_at: "2026-07-01T09:00:00Z",
      },
      {
        id: "task-completed",
        type: "task",
        title: "Completed task",
        status: "completed",
        updated_at: "2026-07-01T08:00:00Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? tasks
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await addWorkspaceStatusFilter(user, "active");

    expect(screen.getByRole("button", { name: "Open details for Active task" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open details for Completed task" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select all visible items" }));
    expect(screen.getByRole("checkbox", { name: "Select Active task" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Filter Tasks" }));
    await user.click(screen.getByRole("button", { name: "Delete filter" }));
    expect(
      await screen.findByRole("checkbox", { name: "Select Completed task" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Active task" })).toBeChecked();
  });

  it("removes one filter rule while keeping its siblings", async () => {
    const user = userEvent.setup();
    const tasks = [
      {
        id: "task-active",
        type: "task",
        title: "Active task",
        status: "active",
        updated_at: "2026-07-01T09:00:00Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? tasks
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await addWorkspaceStatusFilter(user, "active");

    const filter = screen.getByRole("dialog", { name: "Filter Tasks" });
    await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));
    await user.selectOptions(within(filter).getByRole("combobox", { name: "Operator for Title" }), "is_empty");
    expect(within(filter).getByRole("button", { name: "Remove Title filter rule" })).toBeInTheDocument();
    await user.click(within(filter).getByRole("button", { name: "Remove Title filter rule" }));
    expect(within(filter).getByRole("button", { name: "Remove Status filter rule" })).toHaveFocus();

    expect(within(filter).getAllByLabelText("Filter field")).toHaveLength(1);
    expect(within(filter).getByLabelText("Filter field")).toHaveValue("status");

    await user.click(within(filter).getByRole("button", { name: "Remove Status filter rule" }));
    expect(within(filter).getByRole("button", { name: "Add filter rule" })).toHaveFocus();
    expect(within(filter).getByRole("button", { name: "Add filter rule" })).toBeInTheDocument();
    expect(within(filter).queryByRole("button", { name: "Delete filter" })).toBeNull();
  });

  it("keeps Workspace rows visible while new select, relation, text, and date filters have no value", async () => {
    const user = userEvent.setup();
    const tasks = [
      {
        id: "task-one",
        type: "task",
        title: "One",
        status: "active",
        updated_at: "2026-07-01T09:00:00Z",
      },
      {
        id: "task-two",
        type: "task",
        title: "Two",
        status: "completed",
        updated_at: "2026-07-01T08:00:00Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? tasks
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Filter Tasks" }));
    const filter = screen.getByRole("dialog", { name: "Filter Tasks" });
    await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filter).getByRole("option", { name: "Status" }));

    for (const field of ["status", "area", "title", "scheduled"]) {
      await user.selectOptions(within(filter).getByLabelText("Filter field"), field);
      expect(screen.getByRole("button", { name: "Open details for One" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Open details for Two" })).toBeVisible();
      expect(screen.queryByText("1 rules")).toBeNull();
    }
  });

  it("sorts Workspace rows by descending title", async () => {
    const user = userEvent.setup();
    const tasks = [
      {
        id: "task-alpha",
        type: "task",
        title: "Alpha task",
        status: "active",
        updated_at: "2026-07-01T09:00:00Z",
      },
      {
        id: "task-zulu",
        type: "task",
        title: "Zulu task",
        status: "active",
        updated_at: "2026-07-01T08:00:00Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? tasks
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    expect(
      screen.getByRole("table", { name: "Tasks items" }).querySelectorAll("tbody"),
    ).toHaveLength(1);
    expect(workspaceTaskRows().map((row) => row.getAttribute("aria-label"))).toEqual([
      "Open details for Alpha task",
      "Open details for Zulu task",
    ]);

    await user.click(screen.getByRole("button", { name: "Sort Tasks" }));
    const dialog = screen.getByRole("dialog", { name: "Sort Tasks" });
    await user.selectOptions(within(dialog).getByLabelText("Sort field"), "title");
    await user.selectOptions(within(dialog).getByLabelText("Sort direction"), "desc");

    expect(workspaceTaskRows().map((row) => row.getAttribute("aria-label"))).toEqual([
      "Open details for Zulu task",
      "Open details for Alpha task",
    ]);
  });

  it("renders stable Workspace row groups without flattening table bodies", async () => {
    const user = userEvent.setup();
    const tasks = [
      { id: "task-active", type: "task", title: "Active task", status: "active" },
      {
        id: "task-completed",
        type: "task",
        title: "Completed task",
        status: "completed",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? tasks
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Group Tasks" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Status" }));

    const table = screen.getByRole("table", { name: "Tasks items" });
    const activeGroup = within(table).getByRole("rowgroup", { name: "Active group" });
    const completedGroup = within(table).getByRole("rowgroup", {
      name: "Completed group",
    });
    expect(within(activeGroup).getByText("Active")).toBeVisible();
    expect(within(activeGroup).getByRole("button", {
      name: "Open details for Active task",
    })).toBeVisible();
    expect(within(completedGroup).getByText("Completed")).toBeVisible();
    expect(within(completedGroup).getByRole("button", {
      name: "Open details for Completed task",
    })).toBeVisible();
  });

  it("keeps settings in a second Workspace saved tab independent", async () => {
    const user = userEvent.setup();
    const tasks = [
      { id: "task-active", type: "task", title: "Active task", status: "active" },
      {
        id: "task-completed",
        type: "task",
        title: "Completed task",
        status: "completed",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? tasks
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    const tabs = screen.getByRole("tablist", { name: "Tasks views" });
    await user.click(within(tabs).getByRole("button", { name: "Add Tasks view" }));
    await user.keyboard("{Enter}");
    await addWorkspaceStatusFilter(user, "active");
    await user.click(within(tabs).getByRole("button", {
      name: "Open 새 보기 view menu",
    }));
    await user.click(within(plannerViewActions("새 보기")).getByRole("button", {
      name: "Save current settings",
    }));

    expect(screen.queryByRole("button", { name: "Open details for Completed task" })).toBeNull();
    await user.click(within(tabs).getByRole("tab", { name: "Table" }));
    expect(
      await screen.findByRole("button", { name: "Open details for Completed task" }),
    ).toBeVisible();
    await user.click(within(tabs).getByRole("tab", { name: "새 보기" }));
    expect(screen.queryByRole("button", { name: "Open details for Completed task" })).toBeNull();
  });

  it("distinguishes an empty Workspace view from an empty Workspace panel", async () => {
    const user = userEvent.setup();
    const task = { id: "task-active", type: "task", title: "Active task", status: "active" };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
              ? [task]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await addWorkspaceStatusFilter(user, "missed");

    expect(screen.getByText("No items match this view.")).toBeVisible();
    expect(screen.queryByText("No tasks found.")).toBeNull();
  });

  it("renders weekly goals and keeps day item titles on one line with overflow tooltips", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        {
          id: "goal-1",
          type: "goal",
          title: "July Goal",
          status: "active",
          horizon: "month",
          scheduled: monthStart,
        },
        {
          id: "goal-2",
          type: "goal",
          title: "Week Goal",
          status: "active",
          horizon: "week",
          scheduled: weekStart,
        },
      ],
      "/api/v1/todo/items?type=task": [
        { id: "task-active", type: "task", title: "Active task", status: "active", scheduled: weekStart },
        { id: "task-completed", type: "task", title: "Completed task", status: "completed", scheduled: weekStart },
        { id: "task-secondary-active", type: "task", title: "Secondary active task", status: "active", scheduled: weekStart },
        { id: "task-waiting", type: "task", title: "Waiting task", status: "waiting", scheduled: weekStart },
      ],
      "/api/v1/todo/items?type=event": [
        { id: "event-team", type: "event", title: "Team event", status: "active", scheduled: weekStart },
        { id: "event-done", type: "event", title: "Completed event", status: "completed", scheduled: weekStart },
      ],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    expect(
      await screen.findByRole("heading", { name: "Goals for this month" }),
    ).toBeInTheDocument();
    expect(screen.getByText("July Goal")).toBeInTheDocument();
    expect(screen.getByText("Week Goal")).toBeInTheDocument();
    const weeklyTask = screen.getByRole("button", { name: "Active task" });
    expect(weeklyTask).toHaveClass("weekly-single-line-title");
    Object.defineProperties(weeklyTask, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 180 },
    });
    fireEvent.mouseEnter(weeklyTask);
    expect(weeklyTask).toHaveAttribute("title", "Active task");

    Object.defineProperty(weeklyTask, "scrollWidth", {
      configurable: true,
      value: 80,
    });
    fireEvent.mouseEnter(weeklyTask);
    expect(weeklyTask).not.toHaveAttribute("title");
    expect(await screen.findByRole("checkbox", { name: "Complete Active task" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Complete Secondary active task" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /Waiting task/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Complete Team event" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reopen Completed event" })).toBeChecked();
    expect(screen.getAllByTestId("weekly-day-card")).toHaveLength(7);
  });

  it("scopes weekly goal and weekday-grid controls to their own tables", async () => {
    const user = userEvent.setup();
    const weekStart = testWeekStart(testToday());
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "month-a", type: "goal", title: "Month Alpha", status: "active", horizon: "month", scheduled: testMonthStart(weekStart) },
        { id: "month-z", type: "goal", title: "Month Zulu", status: "active", horizon: "month", scheduled: testMonthStart(weekStart) },
        { id: "week-a", type: "goal", title: "Week Alpha", status: "active", horizon: "week", scheduled: weekStart },
        { id: "week-z", type: "goal", title: "Week Zulu", status: "active", horizon: "week", scheduled: weekStart },
      ],
      "/api/v1/todo/items?type=task": Array.from({ length: 7 }, (_, offset) => [
        { id: `day-${offset}-a`, type: "task", title: `Alpha ${offset}`, status: "active", scheduled: testAddDays(weekStart, offset) },
        { id: `day-${offset}-z`, type: "task", title: `Zulu ${offset}`, status: "active", scheduled: testAddDays(weekStart, offset) },
      ]).flat(),
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Month Alpha");

    expect(screen.getByRole("group", { name: "Month Goals controls" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Week Goals controls" })).toBeInTheDocument();
    const dayGridControls = screen.getByRole("group", { name: "Weekday grid controls" });

    await user.click(screen.getByRole("button", { name: "Group Month Goals" }));
    const goalGroupDialog = screen.getByRole("dialog", { name: "Group Month Goals" });
    await user.click(within(goalGroupDialog).getByRole("button", { name: "Choose group property" }));
    expect(within(goalGroupDialog).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "None",
      "Tag",
      "Status",
    ]);
    await user.keyboard("{Escape}{Escape}");

    await user.click(within(dayGridControls).getByRole("button", { name: "Group Weekday grid" }));
    const workGroupDialog = screen.getByRole("dialog", { name: "Group Weekday grid" });
    await user.click(within(workGroupDialog).getByRole("button", { name: "Choose group property" }));
    expect(within(workGroupDialog).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "None",
      "Area",
      "Project",
      "Routine",
      "Tag",
      "Item type",
      "Status",
    ]);
    await user.keyboard("{Escape}{Escape}");

    await user.click(within(dayGridControls).getByRole("button", { name: "Sort Weekday grid" }));
    const sortDialog = screen.getByRole("dialog", { name: "Sort Weekday grid" });
    await user.selectOptions(within(sortDialog).getByLabelText("Sort field"), "title");
    await user.selectOptions(within(sortDialog).getByLabelText("Sort direction"), "desc");

    for (const [offset, card] of screen.getAllByTestId("weekly-day-card").entries()) {
      expect(within(card).getByText(`Zulu ${offset}`).compareDocumentPosition(
        within(card).getByText(`Alpha ${offset}`),
      ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText("Month Alpha").compareDocumentPosition(
      screen.getByText("Month Zulu"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Week Alpha").compareDocumentPosition(
      screen.getByText("Week Zulu"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives every table control an independent accessible disclosure", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByLabelText("Weekly planner");

    const monthControls = screen.getByRole("group", { name: "Month Goals controls" });
    const weekControls = screen.getByRole("group", { name: "Week Goals controls" });
    const monthFilter = within(monthControls).getByRole("button", { name: "Filter Month Goals" });
    const weekSort = within(weekControls).getByRole("button", { name: "Sort Week Goals" });

    expect(monthFilter).toHaveAttribute("aria-expanded", "false");
    expect(weekSort).toHaveAttribute("aria-expanded", "false");
    expect(monthFilter.getAttribute("aria-controls")).not.toBe(weekSort.getAttribute("aria-controls"));

    await user.click(monthFilter);
    expect(monthFilter).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Filter Month Goals" })).toHaveAttribute(
      "id",
      monthFilter.getAttribute("aria-controls"),
    );

    await user.click(weekSort);
    expect(monthFilter).toHaveAttribute("aria-expanded", "false");
    expect(weekSort).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog", { name: "Filter Month Goals" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Sort Week Goals" })).toHaveAttribute(
      "id",
      weekSort.getAttribute("aria-controls"),
    );

    await user.keyboard("{Escape}");
    expect(weekSort).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Sort Week Goals" })).toBeNull();
    expect(weekSort).toHaveFocus();

    await user.click(monthFilter);
    await user.click(screen.getByRole("heading", { name: "Goals for this week" }));
    expect(monthFilter).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Filter Month Goals" })).toBeNull();
    await waitFor(() => expect(monthFilter).toHaveFocus());
  });

  it("renders Planner filter menus in a viewport portal", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByLabelText("Weekly planner");

    await user.click(screen.getByRole("button", { name: "Filter Month Goals" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Month Goals" });

    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveStyle({ position: "fixed" });
  });

  it("groups every Monthly calendar cell without changing goals and exposes scoped Add buttons", async () => {
    const user = userEvent.setup();
    const monthStart = testMonthStart(testToday());
    const weekStart = testWeekStart(monthStart);
    const secondDay = testAddDays(weekStart, 1);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "month-a", type: "goal", title: "Month Alpha", status: "active", horizon: "month", scheduled: monthStart },
        { id: "month-z", type: "goal", title: "Month Zulu", status: "active", horizon: "month", scheduled: monthStart },
        { id: "week-a", type: "goal", title: "Week Alpha", status: "active", horizon: "week", scheduled: weekStart },
        { id: "week-z", type: "goal", title: "Week Zulu", status: "active", horizon: "week", scheduled: weekStart },
      ],
      "/api/v1/todo/items?type=task": [
        { id: "day-one-active", type: "task", title: "Day one active", status: "active", scheduled: weekStart },
        { id: "day-one-complete", type: "task", title: "Day one complete", status: "completed", scheduled: weekStart },
        { id: "day-two-active", type: "task", title: "Day two active", status: "active", scheduled: secondDay },
        { id: "day-two-complete", type: "task", title: "Day two complete", status: "completed", scheduled: secondDay },
      ],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Month Alpha");

    const calendarControls = screen.getByRole("group", { name: "Calendar controls" });
    expect(screen.getByRole("button", { name: "Add to Month Goals" })).toBeInTheDocument();
    expect(within(calendarControls).getByRole("button", { name: "Add to Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Week Goals" })).toBeInTheDocument();

    await user.click(within(calendarControls).getByRole("button", { name: "Group Calendar" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Status" }));

    for (const date of [weekStart, secondDay]) {
      const day = screen.getByRole("gridcell", { name: `${date} todo` });
      expect(within(day).getByRole("heading", { name: "Active" })).toBeInTheDocument();
      expect(within(day).getByRole("heading", { name: "Completed" })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Month goal carousel" })).queryByRole(
      "heading",
      { name: "Active" },
    )).toBeNull();
    expect(within(screen.getByRole("region", { name: "W1 goals" })).queryByRole(
      "heading",
      { name: "Active" },
    )).toBeNull();
  });

  it("filters every Monthly weekly rail without filtering calendar cells", async () => {
    const user = userEvent.setup();
    const monthStart = testMonthStart(testToday());
    const firstWeekStart = testWeekStart(monthStart);
    const secondWeekStart = testAddDays(firstWeekStart, 7);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "week-one-keep", type: "goal", title: "Keep first rail", status: "active", horizon: "week", scheduled: firstWeekStart },
        { id: "week-one-hide", type: "goal", title: "Hide first rail", status: "active", horizon: "week", scheduled: firstWeekStart },
        { id: "week-two-keep", type: "goal", title: "Keep second rail", status: "active", horizon: "week", scheduled: secondWeekStart },
        { id: "week-two-hide", type: "goal", title: "Hide second rail", status: "active", horizon: "week", scheduled: secondWeekStart },
      ],
      "/api/v1/todo/items?type=task": [
        { id: "calendar-hide-one", type: "task", title: "Hide calendar one", status: "active", scheduled: firstWeekStart },
        { id: "calendar-hide-two", type: "task", title: "Hide calendar two", status: "active", scheduled: secondWeekStart },
      ],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Keep first rail");

    const controls = screen.getByRole("group", { name: "Week Goals controls" });
    await user.click(within(controls).getByRole("button", { name: "Filter Week Goals" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Week Goals" });
    await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(dialog).getByRole("option", { name: "Title" }));
    await user.type(within(dialog).getByLabelText("Filter value"), "Keep");

    expect(screen.getByRole("region", { name: "W1 goals" })).toHaveTextContent("Keep first rail");
    expect(screen.getByRole("region", { name: "W1 goals" })).not.toHaveTextContent("Hide first rail");
    expect(screen.getByRole("region", { name: "W2 goals" })).toHaveTextContent("Keep second rail");
    expect(screen.getByRole("region", { name: "W2 goals" })).not.toHaveTextContent("Hide second rail");
    expect(screen.getByRole("gridcell", { name: `${firstWeekStart} todo` })).toHaveTextContent("Hide calendar one");
    expect(screen.getByRole("gridcell", { name: `${secondWeekStart} todo` })).toHaveTextContent("Hide calendar two");
  });

  it("sorts all twelve Yearly month cards without sorting period goals and exposes scoped Add buttons", async () => {
    const user = userEvent.setup();
    const year = testToday().slice(0, 4);
    const monthGoals = Array.from({ length: 12 }, (_, index) => {
      const scheduled = `${year}-${String(index + 1).padStart(2, "0")}-01`;
      return [
        { id: `month-${index}-a`, type: "goal", title: `Alpha ${index}`, status: "active", horizon: "month", scheduled },
        { id: `month-${index}-z`, type: "goal", title: `Zulu ${index}`, status: "active", horizon: "month", scheduled },
      ];
    }).flat();
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "year-a", type: "goal", title: "Annual Alpha", status: "active", horizon: "year", scheduled: `${year}-01-01` },
        { id: "year-z", type: "goal", title: "Annual Zulu", status: "active", horizon: "year", scheduled: `${year}-01-01` },
        ...monthGoals,
      ],
      "/api/v1/todo/items?type=task": [],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Annual Alpha");

    const monthControls = screen.getByRole("group", { name: "Month Goals controls" });
    expect(screen.getByRole("button", { name: "Add to Year Goals" })).toBeInTheDocument();
    expect(within(monthControls).getByRole("button", { name: "Add to Month Goals" })).toBeInTheDocument();

    await user.click(within(monthControls).getByRole("button", { name: "Sort Month Goals" }));
    const sortDialog = screen.getByRole("dialog", { name: "Sort Month Goals" });
    await user.selectOptions(within(sortDialog).getByLabelText("Sort field"), "title");
    await user.selectOptions(within(sortDialog).getByLabelText("Sort direction"), "desc");

    for (const [index, card] of screen.getAllByTestId("yearly-month-card").entries()) {
      expect(within(card).getByText(`Zulu ${index}`).compareDocumentPosition(
        within(card).getByText(`Alpha ${index}`),
      ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const carousel = screen.getByRole("region", { name: "Year goal carousel" });
    expect(within(carousel).getByText("Annual Alpha").compareDocumentPosition(
      within(carousel).getByText("Annual Zulu"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("defaults weekly planner goal creation to the active week anchor and shows it", async () => {
    const user = userEvent.setup();
    const weekStart = testWeekStart(testToday());
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [],
      "/api/v1/todo/items?type=task": [],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/goals/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Anchored weekly goal",
              horizon: "week",
              scheduled: weekStart,
              actor: "user",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-new",
            type: "goal",
            title: "Anchored weekly goal",
            status: "active",
            horizon: "week",
            scheduled: weekStart,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Add to Week Goals" }));

    const period = screen.getByRole("group", { name: "Period" });
    expect(period).toHaveTextContent("Week");
    expect(period).toHaveTextContent(`${weekStart} to ${testAddDays(weekStart, 6)}`);
    expect(within(period).queryByRole("button", { name: "Period" })).toBeNull();

    await user.type(screen.getByLabelText("Title"), "Anchored weekly goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", { name: "Anchored weekly goal" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "< Back" }));

    expect(screen.getByText("Anchored weekly goal")).toBeInTheDocument();
  });

  it("submits canonical yearly and monthly planner goal anchors from the creation dialog", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [],
      "/api/v1/todo/items?type=task": [],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    const goalBodies: Array<{ title: string; horizon: string; scheduled: string; actor: string }> =
      [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/goals/propose") {
        const body = JSON.parse(String(init?.body)) as {
          title: string;
          horizon: string;
          scheduled: string;
          actor: string;
        };
        goalBodies.push(body);

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: `goal-${goalBodies.length}`,
            type: "goal",
            title: body.title,
            status: "active",
            horizon: body.horizon,
            scheduled: body.scheduled,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Add to Year Goals" }));

    const yearlyPeriod = screen.getByRole("group", { name: "Period" });
    expect(yearlyPeriod).toHaveTextContent("Year");
    expect(yearlyPeriod).toHaveTextContent(
      `${yearStart} to ${yearStart.slice(0, 4)}-12-31`,
    );

    await user.type(screen.getByLabelText("Title"), "Year anchor goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(goalBodies[0]).toEqual({
      title: "Year anchor goal",
      horizon: "year",
      scheduled: yearStart,
      actor: "user",
    });

    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.click(screen.getByRole("button", { name: "Add to Month Goals" }));

    expect(screen.getByRole("group", { name: "Period" })).toHaveTextContent("Month");

    await user.type(screen.getByLabelText("Title"), "Month anchor goal");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(goalBodies[1]).toEqual({
      title: "Month anchor goal",
      horizon: "month",
      scheduled: monthStart,
      actor: "user",
    });
  });

  it("creates weekly planner tasks and daily planner events from table type selectors", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [],
      "/api/v1/todo/items?type=task": [],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/tasks/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Weekly task",
              scheduled: weekStart,
              actor: "user",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "Weekly task",
            status: "active",
            scheduled: weekStart,
          }),
        });
      }
      if (url === "/api/v1/todo/events/propose") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "Daily event",
              scheduled: today,
              actor: "user",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-new",
            type: "event",
            title: "Daily event",
            status: "active",
            scheduled: today,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Add to Weekday grid" }));
    await user.selectOptions(screen.getByLabelText("Type"), "task");
    expect(screen.getByLabelText("Scheduled")).toHaveValue(weekStart);
    await user.type(screen.getByLabelText("Title"), "Weekly task");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Weekly task")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(
      await screen.findByRole("checkbox", { name: "Complete Weekly task" }),
    ).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add to Today" }));
    expect(within(screen.getByLabelText("Type")).queryByRole("option", { name: "Routine" })).toBeNull();
    await user.selectOptions(screen.getByLabelText("Type"), "event");
    expect(screen.getByLabelText("Scheduled")).toHaveValue(today);
    await user.type(screen.getByLabelText("Title"), "Daily event");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Daily event")).toBeInTheDocument();
  });

  it("uses chip tags when creating a planner item", async () => {
    const user = userEvent.setup();
    const taskBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/v1/todo/tasks/propose") {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          taskBodies.push(body);
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: "task-new", type: "task", status: "active", ...body }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [{ id: "task-1", type: "task", title: "Focus task", status: "active" }]
              : [],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add to Today" }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "focus{Enter}");
    expect(screen.getByText("focus")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Tagged task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(taskBodies).toEqual([{
      title: "Tagged task",
      scheduled: testToday(),
      tags: ["focus"],
      actor: "user",
    }]);
  });

  it("labels and portals the creation tag picker outside the dialog", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [{ id: "task-1", type: "task", title: "Focus task", status: "active" }]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add to Today" }));

    const dialog = screen.getByRole("dialog", { name: "Create Daily item" });
    expect(within(dialog).getByText("Tags")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Tags" }));
    const dropdown = screen.getByRole("listbox", { name: "Tags options" }).parentElement;
    expect(dropdown).not.toBeNull();
    expect(dialog.contains(dropdown)).toBe(false);
    expect(dropdown).toHaveStyle({ zIndex: "110" });
  });

  it("removes a chip tag while creating a planner item", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [{ id: "task-1", type: "task", title: "Focus task", status: "active" }]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add to Today" }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.type(screen.getByRole("combobox", { name: "Tags" }), "focus{Enter}");
    await user.click(screen.getByRole("button", { name: "Remove focus tag" }));
    expect(screen.queryByText("focus")).not.toBeInTheDocument();
  });

  it("closes planner creation when Escape is pressed in the open tag search", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add to Today" }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByRole("combobox", { name: "Tags" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Create Daily item" })).toBeNull();
  });

  it("renders daily planner sections with filter, group, and sort controls", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const overdue = testAddDays(today, -1);
    const upcoming = testAddDays(today, 1);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=task": [
        {
          id: "task-active",
          type: "task",
          title: "Active task",
          status: "active",
          scheduled: today,
        },
        {
          id: "task-completed",
          type: "task",
          title: "Completed task",
          status: "completed",
          scheduled: today,
        },
        {
          id: "task-secondary-active",
          type: "task",
          title: "Secondary active task",
          status: "active",
          scheduled: today,
        },
        {
          id: "task-waiting",
          type: "task",
          title: "Waiting task",
          status: "waiting",
          scheduled: today,
        },
        {
          id: "task-1",
          type: "task",
          title: "Today Task",
          status: "active",
          scheduled: today,
          tags: ["deep-work"],
          area_id: "area-1",
        },
        {
          id: "task-2",
          type: "task",
          title: "Done Task",
          status: "completed",
          scheduled: today,
          tags: ["deep-work"],
          area_id: "area-1",
        },
        {
          id: "task-3",
          type: "task",
          title: "Overdue Task",
          status: "active",
          scheduled: overdue,
          area_id: "area-2",
        },
        {
          id: "task-4",
          type: "task",
          title: "Upcoming Task",
          status: "active",
          scheduled: upcoming,
          area_id: "area-2",
        },
        {
          id: "task-5",
          type: "task",
          title: "Inbox Task",
          status: "active",
          area_id: "area-2",
        },
      ],
      "/api/v1/todo/items?type=event": [
        { id: "event-team", type: "event", title: "Team event", status: "active", scheduled: today },
      ],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [
        { id: "area-1", type: "area", title: "Focus", status: "active" },
        { id: "area-2", type: "area", title: "Admin", status: "active" },
        {
          id: "area-3",
          type: "area",
          title: "Area Should Not Render",
          status: "active",
          scheduled: today,
        },
      ],
      "/api/v1/todo/items?type=project": [
        {
          id: "project-1",
          type: "project",
          title: "Project Should Not Render",
          status: "active",
          scheduled: today,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    expect(
      await screen.findByRole("heading", { name: testLongDateLabel(today) }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort Today" })).toBeInTheDocument();
    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Complete Active task" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Complete Secondary active task" })).not.toBeChecked();
    expect(screen.getByText("Waiting task")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Waiting task/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Complete Team event" })).not.toBeChecked();
    expect(screen.getByText("Overdue Task")).toBeInTheDocument();
    expect(screen.queryByText("Upcoming Task")).toBeNull();
    expect(screen.getByText("Inbox Task")).toBeInTheDocument();
    expect(screen.getByLabelText("Scheduled daily work")).toContainElement(
      screen.getByLabelText(testLongDateLabel(today)),
    );
    expect(screen.getByLabelText("Scheduled daily work")).toContainElement(
      screen.getByLabelText(`Before ${testLongDateLabel(today)}`),
    );
    expect(screen.getByLabelText("Daily planner")).toContainElement(
      screen.getByLabelText("Unscheduled"),
    );
    expect(screen.getByText("Done Task")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Area Should Not Render" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Project Should Not Render" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    const filterDialog = screen.getByRole("dialog", { name: "Filter Today" });
    expect(filterDialog).not.toHaveClass("planner-control-dropdown-compact");
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Area" }));
    await user.click(screen.getByRole("button", { name: "Select Area filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "Focus" }));

    expect(screen.getByText("Today Task")).toBeInTheDocument();
    expect(screen.getByText("Overdue Task")).toBeInTheDocument();
    expect(screen.queryByText("Upcoming Task")).toBeNull();
    expect(screen.getByText("Inbox Task")).toBeInTheDocument();
    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add filter rule" }));

    expect(screen.getByText("And")).toBeInTheDocument();
    expect(screen.queryByText("2 rules")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filter mode" }));
    await user.click(screen.getByRole("option", { name: "Or" }));

    expect(screen.getByText("Or")).toBeInTheDocument();
  }, 10_000);

  it("keeps Daily table controls isolated and hides the fixed Unscheduled Task type", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=task": [
        { id: "today-keep", type: "task", title: "Keep today", status: "active", scheduled: today },
        { id: "today-hide", type: "task", title: "Hide today", status: "active", scheduled: today },
        { id: "before", type: "task", title: "Before remains", status: "active", scheduled: testAddDays(today, -1) },
        { id: "unscheduled", type: "task", title: "Inbox remains", status: "active" },
      ],
      "/api/v1/todo/items?type=event": [],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=goal": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByText("Keep today");

    const todayControls = screen.getByRole("group", { name: "Today controls" });
    expect(screen.getByRole("group", { name: "Before controls" })).toBeInTheDocument();
    const unscheduledControls = screen.getByRole("group", { name: "Unscheduled controls" });

    await user.click(within(todayControls).getByRole("button", { name: "Filter Today" }));
    const filterDialog = screen.getByRole("dialog", { name: "Filter Today" });
    await user.click(within(filterDialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filterDialog).getByRole("option", { name: "Title" }));
    await user.type(within(filterDialog).getByLabelText("Filter value"), "Keep");

    expect(screen.getByText("Keep today")).toBeInTheDocument();
    expect(screen.queryByText("Hide today")).toBeNull();
    expect(screen.getByText("Before remains")).toBeInTheDocument();
    expect(screen.getByText("Inbox remains")).toBeInTheDocument();

    await user.click(within(unscheduledControls).getByRole("button", { name: "Add to Unscheduled" }));
    expect(screen.queryByLabelText("Type")).toBeNull();
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
  });

  it("uses each date-work table anchor and never renders Routine in Planner creation or date rows", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=routine"
          ? [{
              id: "routine-related",
              type: "routine",
              title: "Related routine metadata",
              status: "active",
              scheduled: today,
              recurrence_rule: "RRULE:FREQ=DAILY",
            }]
          : [],
      })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    expect(await screen.findByLabelText("Daily planner")).toBeInTheDocument();
    expect(screen.queryByText("Related routine metadata")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add to Today" }));
    expect(screen.getByLabelText("Scheduled")).toHaveValue(today);
    expect(screen.getByLabelText("Scheduled")).toHaveAttribute("readonly");
    expect(within(screen.getByLabelText("Type")).queryByRole("option", { name: "Routine" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Add to Before" }));
    expect(screen.getByLabelText("Scheduled")).toHaveValue(testAddDays(today, -1));
    expect(screen.getByLabelText("Scheduled")).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Add to Unscheduled" }));
    expect(screen.queryByLabelText("Type")).toBeNull();
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await user.click(screen.getByRole("button", { name: "Add to Weekday grid" }));
    expect(screen.getByLabelText("Scheduled")).toHaveValue(weekStart);
    expect(screen.getByLabelText("Scheduled")).not.toHaveAttribute("readonly");
    expect(within(screen.getByLabelText("Type")).queryByRole("option", { name: "Routine" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.click(screen.getByRole("button", { name: "Add to Calendar" }));
    expect(screen.getByLabelText("Scheduled")).toHaveValue(monthStart);
    expect(screen.getByLabelText("Scheduled")).not.toHaveAttribute("readonly");
    expect(within(screen.getByLabelText("Type")).queryByRole("option", { name: "Routine" })).toBeNull();
  });

  it("constrains all goal-table creation to Goal and the approved period anchor", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    const yearStart = testYearStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    async function expectFixedGoalContext(buttonName: string, horizon: string, range: string) {
      await user.click(screen.getByRole("button", { name: buttonName }));
      expect(within(screen.getByLabelText("Type")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Goal"]);
      expect(screen.queryByLabelText("Area")).toBeNull();
      expect(screen.queryByLabelText("Project")).toBeNull();
      expect(screen.queryByLabelText("Priority")).toBeNull();
      expect(screen.getByLabelText("Tags")).toBeInTheDocument();
      const period = screen.getByRole("group", { name: "Period" });
      expect(period).toHaveTextContent(horizon);
      expect(period).toHaveTextContent(range);
      expect(within(period).queryByRole("button", { name: "Period" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    }

    async function expectEditableGoalContext(buttonName: string, horizon: string, range: string) {
      await user.click(screen.getByRole("button", { name: buttonName }));
      expect(within(screen.getByLabelText("Type")).getAllByRole("option").map((option) => option.textContent)).toEqual(["Goal"]);
      const trigger = screen.getByRole("button", { name: "Period" });
      expect(trigger).toHaveTextContent(horizon);
      await user.click(trigger);
      const picker = screen.getByRole("dialog", { name: "Period" });
      expect(within(picker).getByText(range)).toBeInTheDocument();
      expect(within(picker).queryByRole("button", { name: /^(Year|Month|Week)$/ })).toBeNull();
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    }

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await expectFixedGoalContext(
      "Add to Month Goals",
      "Month",
      `${monthStart} to ${testMonthEnd(today)}`,
    );
    await expectFixedGoalContext(
      "Add to Week Goals",
      "Week",
      `${weekStart} to ${testAddDays(weekStart, 6)}`,
    );

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await expectFixedGoalContext(
      "Add to Month Goals",
      "Month",
      `${monthStart} to ${testMonthEnd(today)}`,
    );
    await expectEditableGoalContext(
      "Add to Week Goals",
      "Week",
      `${testWeekStart(monthStart)} to ${testAddDays(testWeekStart(monthStart), 6)}`,
    );

    await user.click(screen.getByRole("button", { name: "Yearly" }));
    await expectFixedGoalContext(
      "Add to Year Goals",
      "Year",
      `${yearStart} to ${yearStart.slice(0, 4)}-12-31`,
    );
    await expectEditableGoalContext(
      "Add to Month Goals",
      "Month",
      `${yearStart} to ${yearStart.slice(0, 4)}-01-31`,
    );
  });

  it("prefills deterministic planner filters and warns without forcing nondeterministic filters", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const deterministicSettings = {
      filterMode: "and",
      filterRules: [
        { id: "area", field: "area", type: "relation", operator: "is", value: ["area-1"] },
        { id: "project", field: "project", type: "relation", operator: "is", value: ["project-1"] },
        { id: "priority", field: "priority", type: "select", operator: "is", value: ["4"] },
        { id: "tag", field: "tags", type: "multiSelect", operator: "contains", value: ["focus"] },
      ],
      sortRules: [],
      groupSettings: {
        groupBy: "none",
        sort: "manual",
        hideEmpty: true,
        manualOrder: [],
        hiddenGroupKeys: [],
      },
    };
    const eventBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/preferences/planner.v1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tableSettings: { "daily.today": deterministicSettings } }),
        });
      }
      if (url === "/api/v1/todo/events/propose") {
        const body = JSON.parse(String(init?.body));
        eventBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "event-filtered", type: "event", status: "active", ...body }),
        });
      }
      if (url === "/api/v1/todo/items?type=area") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "area-1", type: "area", title: "Suggested area", status: "active" },
            { id: "area-2", type: "area", title: "Chosen area", status: "active" },
          ],
        });
      }
      if (url === "/api/v1/todo/items?type=project") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "project-1", type: "project", title: "Suggested project", status: "active" },
            { id: "project-2", type: "project", title: "Chosen project", status: "active" },
          ],
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByText("4 rules");
    await user.click(screen.getByRole("button", { name: "Add to Today" }));

    expect(screen.queryByText(/may not appear in the current table/i)).toBeNull();
    expect(screen.getByLabelText("Area")).toHaveValue("area-1");
    expect(screen.getByLabelText("Project")).toHaveValue("project-1");
    expect(screen.getByLabelText("Priority")).toHaveValue("4");
    const tagTrigger = screen.getByRole("button", { name: "Tags" });
    const removeFocusTag = screen.getByRole("button", { name: "Remove focus tag" });
    expect(tagTrigger.tagName).toBe("BUTTON");
    expect(removeFocusTag.closest('[role="button"]')).toBeNull();
    expect(tagTrigger.contains(removeFocusTag)).toBe(false);
    await user.selectOptions(screen.getByLabelText("Type"), "event");
    await user.selectOptions(screen.getByLabelText("Area"), "area-2");
    await user.selectOptions(screen.getByLabelText("Project"), "project-2");
    await user.selectOptions(screen.getByLabelText("Priority"), "8");
    await user.click(screen.getByRole("button", { name: "Remove focus tag" }));
    await user.click(screen.getByRole("button", { name: "Tags" }));
    const tagSearch = screen.getByRole("combobox", { name: "Tags" });
    await user.type(tagSearch, "user{Enter}");
    await user.type(tagSearch, "edited{Enter}");
    await user.type(screen.getByLabelText("Title"), "Filtered event");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(eventBodies).toEqual([{
      title: "Filtered event",
      scheduled: today,
      area: "area-2",
      project_id: "project-2",
      priority: 8,
      tags: ["user", "edited"],
      actor: "user",
    }]);
  });

  it("resets table-incompatible persisted filters before planner creation", async () => {
    const user = userEvent.setup();
    const taskBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/preferences/planner.v1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tableSettings: {
              "daily.today": {
                filterMode: "and",
                filterRules: [
                  { id: "project", field: "project", type: "relation", operator: "is", value: ["project-1"] },
                  { id: "empty-title", field: "title", type: "text", operator: "contains", value: "" },
                  { id: "hidden-horizon", field: "horizon", type: "select", operator: "is", value: ["week"] },
                ],
                sortRules: [],
                groupSettings: {
                  groupBy: "none",
                  sort: "manual",
                  hideEmpty: true,
                  manualOrder: [],
                  hiddenGroupKeys: [],
                },
              },
            },
          }),
        });
      }
      if (url === "/api/v1/todo/tasks/propose") {
        const body = JSON.parse(String(init?.body));
        taskBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-effective-filter", type: "task", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByLabelText("Daily planner");
    expect(screen.queryByText("1 rules")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add to Today" }));

    expect(screen.queryByText(/may not appear in the current table/i)).toBeNull();
    await user.type(screen.getByLabelText("Title"), "Project task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(taskBodies).toEqual([{
      title: "Project task",
      scheduled: testToday(),
      actor: "user",
    }]);
  });

  it("does not warn when an OR table has no effective filters", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/v1/preferences/planner.v1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tableSettings: {
              "daily.today": {
                filterMode: "or",
                filterRules: [
                  { id: "empty-project", field: "project", type: "relation", operator: "is", value: [] },
                  { id: "hidden-horizon", field: "horizon", type: "select", operator: "is", value: ["week"] },
                ],
                sortRules: [],
                groupSettings: {
                  groupBy: "none",
                  sort: "manual",
                  hideEmpty: true,
                  manualOrder: [],
                  hiddenGroupKeys: [],
                },
              },
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Add to Today" }));

    expect(screen.queryByText(/may not appear in the current table/i)).toBeNull();
  });

  it.each([
    ["or", [{ id: "area", field: "area", type: "relation", operator: "is", value: ["area-1"] }]],
    ["and", [{ id: "title", field: "title", type: "text", operator: "contains", value: "focus" }]],
    ["and", [{ id: "scheduled", field: "scheduled", type: "date", operator: "is_after", value: testToday() }]],
    ["and", [{ id: "tags", field: "tags", type: "multiSelect", operator: "contains", value: ["focus", "ops"] }]],
  ] as const)("warns for %s nondeterministic contextual filters", async (filterMode, filterRules) => {
    const user = userEvent.setup();
    const taskBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/preferences/planner.v1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tableSettings: {
              "daily.today": {
                filterMode,
                filterRules,
                sortRules: [],
                groupSettings: {
                  groupBy: "none",
                  sort: "manual",
                  hideEmpty: true,
                  manualOrder: [],
                  hiddenGroupKeys: [],
                },
              },
            },
          }),
        });
      }
      if (url === "/api/v1/todo/tasks/propose") {
        const body = JSON.parse(String(init?.body));
        taskBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-warning", type: "task", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByText("1 rules");
    await user.click(screen.getByRole("button", { name: "Add to Today" }));

    expect(screen.getByText(/may not appear in the current table/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Warning task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(taskBodies).toEqual([{
      title: "Warning task",
      scheduled: testToday(),
      actor: "user",
    }]);
  });

  it("completes a daily planner task without opening its detail from the checkbox", async () => {
    const user = userEvent.setup();
    let resolveComplete!: (value: Response) => void;
    const completeResponse = new Promise<Response>((resolve) => {
      resolveComplete = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/task-active/complete") return completeResponse;
      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=task"
          ? [{ id: "task-active", type: "task", title: "Active task", status: "active", scheduled: testToday() }]
          : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    await user.click(await screen.findByRole("button", { name: "Active task" }));
    expect(screen.getByRole("heading", { name: "Active task" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "< Back" }));

    const checkbox = await screen.findByRole("checkbox", { name: "Complete Active task" });
    await user.click(checkbox);
    expect(checkbox).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Active task" })).toBeInTheDocument();
    await user.click(checkbox);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items/task-active/complete"),
    ).toHaveLength(1);

    resolveComplete({
      ok: true,
      json: async () => ({
        id: "task-active",
        type: "task",
        title: "Active task",
        status: "completed",
        scheduled: testToday(),
      }),
    } as Response);

    const reopenedCheckbox = await screen.findByRole("checkbox", { name: "Reopen Active task" });
    expect(reopenedCheckbox).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Active task" }));
    expect(screen.getByRole("heading", { name: "Active task" })).toBeInTheDocument();
  });

  it("completes and reopens a daily planner event from the checkbox", async () => {
    const user = userEvent.setup();
    let status = "active";
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/event-team/complete") {
        status = "completed";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-team",
            type: "event",
            title: "Team event",
            status,
            scheduled: testToday(),
          }),
        } as Response);
      }
      if (url === "/api/v1/todo/items/event-team/reopen") {
        status = "active";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-team",
            type: "event",
            title: "Team event",
            status,
            scheduled: testToday(),
            completed_at: null,
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=event"
          ? [{ id: "event-team", type: "event", title: "Team event", status, scheduled: testToday() }]
          : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    await user.click(await screen.findByRole("checkbox", { name: "Complete Team event" }));
    expect(await screen.findByRole("checkbox", { name: "Reopen Team event" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Reopen Team event" }));
    expect(await screen.findByRole("checkbox", { name: "Complete Team event" })).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/event-team/complete",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/event-team/reopen",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("opens a Miss dialog only from active task and event rows across Planner views", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=task": [
        { id: "task-active", type: "task", title: "Active task", status: "active", scheduled: today },
        { id: "task-missed", type: "task", title: "Missed task", status: "missed", scheduled: today },
        { id: "task-completed", type: "task", title: "Completed task", status: "completed", scheduled: today },
        { id: "task-paused", type: "task", title: "Paused task", status: "paused", scheduled: today },
      ],
      "/api/v1/todo/items?type=event": [
        { id: "event-active", type: "event", title: "Active event", status: "active", scheduled: today },
      ],
      "/api/v1/todo/items?type=routine": [
        { id: "routine-active", type: "routine", title: "Active routine", status: "active", scheduled: today },
      ],
      "/api/v1/todo/items?type=goal": [
        { id: "goal-active", type: "goal", title: "Active goal", status: "active", horizon: "week", scheduled: testWeekStart(today) },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    for (const view of ["Daily", "Weekly", "Monthly"]) {
      await user.click(screen.getByRole("button", { name: view }));
      expect(
        await screen.findByRole("button", { name: "Miss Active task" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Miss Active event" }),
      ).toBeInTheDocument();
    }

    for (const title of [
      "Missed task",
      "Completed task",
      "Paused task",
      "Active routine",
      "Active goal",
    ]) {
      expect(screen.queryByRole("button", { name: `Miss ${title}` })).toBeNull();
    }

    const trigger = screen.getByRole("button", { name: "Miss Active task" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Miss Active task?" });
    const tomorrow = testAddDays(testToday(), 1);
    const postponeDate = within(dialog).getByLabelText("Postpone date");
    expect(within(dialog).getByRole("button", { name: "Mark missed" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Miss and postpone" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(postponeDate).toHaveValue(tomorrow);
    expect(postponeDate).toHaveAttribute("min", tomorrow);
    await user.tab({ shift: true });
    expect(postponeDate).toHaveFocus();
    fireEvent.change(postponeDate, {
      target: { value: testAddDays(testToday(), 5) },
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(trigger);
    expect(
      within(screen.getByRole("dialog", { name: "Miss Active task?" }))
        .getByLabelText("Postpone date"),
    ).toHaveValue(tomorrow);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Miss Active task?" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("marks missed in place and keeps the Planner row visible until filtered out", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-active",
      type: "task",
      title: "Active task",
      status: "active",
      scheduled: testToday(),
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items/task-active/miss"
            ? { ...task, status: "missed" }
            : url === "/api/v1/todo/items?type=task"
              ? [task]
              : [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Miss Active task" }));
    const dialog = screen.getByRole("dialog", { name: "Miss Active task?" });
    await user.click(within(dialog).getByRole("button", { name: "Mark missed" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Active task" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Miss Active task" })).toBeNull();
      expect(screen.getByRole("button", { name: "Filter Today" })).toHaveFocus();
      expect(document.body).not.toHaveFocus();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-active/miss",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );

    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: "Select Status filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "missed" }));
    await user.selectOptions(screen.getByLabelText("Operator for Status"), "is_not");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Active task" })).toBeNull(),
    );
  });

  it("returns success focus to the Planner header after a status group remounts the missed row", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-active",
      type: "task",
      title: "Active task",
      status: "active",
      scheduled: testToday(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items/task-active/miss"
              ? { ...task, status: "missed" }
              : url === "/api/v1/todo/items?type=task"
                ? [task]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Group Today" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Status" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Miss Active task" }));
    await user.click(within(screen.getByRole("dialog", { name: "Miss Active task?" })).getByRole("button", { name: "Mark missed" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "missed" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Filter Today" })).toHaveFocus();
      expect(document.body).not.toHaveFocus();
    });
  });

  it("returns success focus to the Planner header when the active filter removes the missed row", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-active",
      type: "task",
      title: "Active task",
      status: "active",
      scheduled: testToday(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items/task-active/miss"
              ? { ...task, status: "missed" }
              : url === "/api/v1/todo/items?type=task"
                ? [task]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: "Select Status filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "active" }));
    await user.click(screen.getByRole("button", { name: "Miss Active task" }));
    await user.click(within(screen.getByRole("dialog", { name: "Miss Active task?" })).getByRole("button", { name: "Mark missed" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Active task" })).toBeNull();
      expect(screen.getByRole("button", { name: "Filter Today" })).toHaveFocus();
      expect(document.body).not.toHaveFocus();
    });
  });

  it("postpones to a selected browser-local date and prevents duplicate dialog submission", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 25, 23, 30));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const task = {
      id: "task-active",
      type: "task",
      title: "Active task",
      status: "active",
      scheduled: "2026-07-25",
    };
    let resolvePostpone!: (value: Response) => void;
    const postponeResponse = new Promise<Response>((resolve) => {
      resolvePostpone = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/task-active/postpone") {
        return postponeResponse;
      }
      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=task" ? [task] : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Miss Active task" }));
    const dialog = screen.getByRole("dialog", { name: "Miss Active task?" });
    const postpone = within(dialog).getByRole("button", { name: "Miss and postpone" });
    const postponeDate = within(dialog).getByLabelText("Postpone date");
    expect(postponeDate).toHaveValue("2026-07-26");
    expect(postponeDate).toHaveAttribute("min", "2026-07-26");
    fireEvent.change(postponeDate, { target: { value: "" } });
    expect(postpone).toBeDisabled();
    fireEvent.change(postponeDate, { target: { value: "2026-07-25" } });
    expect(postpone).toBeDisabled();
    fireEvent.change(postponeDate, { target: { value: "2026-07-30" } });
    expect(postpone).toBeEnabled();
    fireEvent.click(postpone);
    fireEvent.click(postpone);

    expect(postpone).toBeDisabled();
    await waitFor(() => {
      expect(dialog).toHaveAttribute("aria-busy", "true");
      expect(within(dialog).getByRole("status")).toHaveTextContent("Updating missed work…");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/postpone"),
      expect.objectContaining({
        body: JSON.stringify({
          today: "2026-07-25",
          scheduled: "2026-07-30",
        }),
      }),
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items/task-active/postpone"),
    ).toHaveLength(1);

    resolvePostpone({
      ok: true,
      json: async () => ({
        source: { ...task, status: "missed" },
        follow_up: { ...task, id: "task-follow-up", scheduled: "2026-07-30" },
      }),
    } as Response);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Miss Active task?" })).toBeNull(),
    );
    vi.useRealTimers();
  });

  it("allows an overdue Planner item to be postponed to today", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 25, 12));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const task = {
      id: "task-overdue",
      type: "task",
      title: "Overdue task",
      status: "active",
      scheduled: "2026-07-24",
    };
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/v1/todo/items?type=task" ? [task] : [],
    } as Response)));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Miss Overdue task" }));

    const postponeDate = within(
      screen.getByRole("dialog", { name: "Miss Overdue task?" }),
    ).getByLabelText("Postpone date");
    expect(postponeDate).toHaveValue("2026-07-25");
    expect(postponeDate).toHaveAttribute("min", "2026-07-25");
    vi.useRealTimers();
  });

  it("does not expose postpone controls in the detail panel", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-detail",
      type: "task",
      title: "Detail task",
      status: "active",
      scheduled: testToday(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => url === "/api/v1/todo/items?type=task" ? [task] : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Detail task" }));

    expect(screen.queryByLabelText("Postpone date")).toBeNull();
    expect(screen.queryByRole("button", { name: /Postpone/ })).toBeNull();
  });

  it("keeps a completed daily planner task checked when reopening fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/task-completed/reopen") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "validation_error",
            message: "The request is invalid.",
            fields: {},
            request_id: "00000000-0000-4000-8000-000000000003",
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=task"
          ? [{ id: "task-completed", type: "task", title: "Completed task", status: "completed", scheduled: testToday() }]
          : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("checkbox", { name: "Reopen Completed task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request is invalid.",
    );
    expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
  });

  it("shares task transition state across duplicate tag-group rows", async () => {
    const user = userEvent.setup();
    let resolveFailure!: (value: Response) => void;
    let resolveRetry!: (value: Response) => void;
    const failureResponse = new Promise<Response>((resolve) => {
      resolveFailure = resolve;
    });
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
    let transitionAttempt = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/task-shared/complete") {
        transitionAttempt += 1;
        return transitionAttempt === 1 ? failureResponse : retryResponse;
      }
      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=task"
          ? [
              {
                id: "task-shared",
                type: "task",
                title: "Shared task",
                status: "active",
                scheduled: testToday(),
                tags: ["focus", "ops"],
              },
              {
                id: "task-other",
                type: "task",
                title: "Other task",
                status: "active",
                scheduled: testToday(),
                tags: ["other"],
              },
            ]
          : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByRole("checkbox", { name: "Complete Shared task" });
    await user.click(screen.getByRole("button", { name: "Group Today" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

    let sharedCheckboxes = screen.getAllByRole("checkbox", { name: "Complete Shared task" });
    expect(sharedCheckboxes).toHaveLength(2);
    await user.click(sharedCheckboxes[0]);
    sharedCheckboxes = screen.getAllByRole("checkbox", { name: "Complete Shared task" });
    expect(sharedCheckboxes.every((checkbox) => checkbox.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Complete Other task" })).not.toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url === "/api/v1/todo/items/task-shared/complete"),
    ).toHaveLength(1);

    resolveFailure({
      ok: false,
      status: 400,
      json: async () => ({
        code: "validation_error",
        message: "The request is invalid.",
        fields: {},
        request_id: "00000000-0000-4000-8000-000000000004",
      }),
    } as Response);
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("The request is invalid.");
    expect(screen.getAllByRole("checkbox", { name: "Complete Shared task" })[0]).not.toBeChecked();

    await user.click(screen.getAllByRole("checkbox", { name: "Complete Shared task" })[0]);
    expect(screen.queryByRole("alert")).toBeNull();
    sharedCheckboxes = screen.getAllByRole("checkbox", { name: "Complete Shared task" });
    expect(sharedCheckboxes.every((checkbox) => checkbox.hasAttribute("disabled"))).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url === "/api/v1/todo/items/task-shared/complete"),
    ).toHaveLength(2);

    resolveRetry({
      ok: true,
      json: async () => ({
        id: "task-shared",
        type: "task",
        title: "Shared task",
        status: "completed",
        scheduled: testToday(),
        tags: ["focus", "ops"],
      }),
    } as Response);

    const reopenedCheckboxes = await screen.findAllByRole("checkbox", {
      name: "Reopen Shared task",
    });
    expect(reopenedCheckboxes).toHaveLength(2);
    expect(reopenedCheckboxes.every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
    expect(reopenedCheckboxes.every((checkbox) => !checkbox.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Shared task" })[0]);
    expect(screen.getByRole("heading", { name: "Shared task" })).toBeInTheDocument();
  });

  it("filters daily planner items through the rule builder dropdown", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [
                  {
                    id: "task-1",
                    type: "task",
                    title: "Focus Task",
                    status: "active",
                    tags: ["focus"],
                    area_id: "area-1",
                    scheduled: testToday(),
                  },
                  {
                    id: "task-2",
                    type: "task",
                    title: "Ops Task",
                    status: "active",
                    tags: ["ops"],
                    area_id: "area-2",
                    scheduled: testToday(),
                  },
                ]
              : url === "/api/v1/todo/items?type=area"
                ? [
                    { id: "area-1", type: "area", title: "Work", status: "active" },
                    { id: "area-2", type: "area", title: "Ops", status: "active" },
                  ]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    await screen.findByText("Focus Task");
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    expect(screen.getByRole("option", { name: "Title" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Item type" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Horizon" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "focus" }));

    expect(screen.getByText("Focus Task")).toBeInTheDocument();
    expect(screen.queryByText("Ops Task")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete filter" }));

    expect(screen.getByText("Focus Task")).toBeInTheDocument();
    expect(screen.getByText("Ops Task")).toBeInTheDocument();
  });

  it("does not carry Daily table filters into Weekly goal tables", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [
                  {
                    id: "task-1",
                    type: "task",
                    title: "Focus Task",
                    status: "active",
                    area_id: "area-1",
                    scheduled: testToday(),
                  },
                  {
                    id: "task-2",
                    type: "task",
                    title: "Ops Task",
                    status: "active",
                    area_id: "area-2",
                    scheduled: testToday(),
                  },
                ]
              : url === "/api/v1/todo/items?type=area"
                ? [
                    { id: "area-1", type: "area", title: "Focus", status: "active" },
                    { id: "area-2", type: "area", title: "Ops", status: "active" },
                  ]
                : url === "/api/v1/todo/items?type=goal"
                  ? [
                      {
                        id: "goal-1",
                        type: "goal",
                        title: "Monthly Goal",
                        status: "active",
                        horizon: "month",
                        scheduled: testMonthStart(testToday()),
                        tags: ["month-current"],
                      },
                    ]
                  : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    await screen.findByText("Focus Task");
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Area" }));
    await user.click(screen.getByRole("button", { name: "Select Area filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "Focus" }));

    expect(screen.getByText("1 rules")).toBeInTheDocument();
    await savePlannerView(user, "Today views");

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    expect(await screen.findByText("Monthly Goal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter Month Goals" }));

    expect(screen.queryByText("1 rules")).toBeNull();
    expect(screen.queryByDisplayValue("Title")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add filter rule" }));
    await user.click(screen.getByRole("option", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Select Tags filter values" }));
    await user.click(screen.getByRole("checkbox", { name: "month-current" }));

    expect(screen.getByText("Monthly Goal")).toBeInTheDocument();
    expect(screen.getByText("1 rules")).toBeInTheDocument();
  });

  it("sorts and groups daily planner items from dropdown controls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [
                  {
                    id: "task-b",
                    type: "task",
                    title: "B Task",
                    status: "active",
                    tags: ["ops"],
                    priority: 2,
                    scheduled: testToday(),
                  },
                  {
                    id: "task-a",
                    type: "task",
                    title: "A Task",
                    status: "active",
                    tags: ["focus"],
                    priority: 1,
                    scheduled: testToday(),
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByText("A Task");

    await user.click(screen.getByRole("button", { name: "Sort Today" }));
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");

    const selectedDaySection = screen.getByLabelText(testLongDateLabel(testToday()));
    expect(
      Array.from(selectedDaySection.querySelectorAll(".planner-item")).map((button) => button.textContent),
    ).toEqual(["A Task", "B Task"]);

    await user.click(screen.getByRole("button", { name: "Group Today" }));
    expect(screen.getByRole("dialog", { name: "Group Today" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Group settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close group settings" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

    expect(within(selectedDaySection).getByRole("heading", { name: "focus" })).toBeInTheDocument();
    expect(within(selectedDaySection).getByRole("heading", { name: "ops" })).toBeInTheDocument();
  });

  it("links and dismisses the Group dropdown through its real toolbar events", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const groupTrigger = screen.getByRole("button", { name: "Group Today" });
    await user.click(groupTrigger);
    const groupDialog = screen.getByRole("dialog", { name: "Group Today" });
    expect(groupTrigger).toHaveAttribute("aria-controls", "planner-group-dropdown-daily-today");
    expect(groupDialog).toHaveAttribute("id", "planner-group-dropdown-daily-today");
    expect(groupDialog).toHaveClass("planner-control-dropdown-compact");

    await user.click(screen.getByRole("button", { name: "Choose group sort" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Choose group sort" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Group Today" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Group Today" })).not.toBeInTheDocument();
    expect(groupTrigger).toHaveFocus();

    await user.click(groupTrigger);
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Group Today" })).not.toBeInTheDocument();
    });
    expect(groupTrigger).toHaveFocus();
  });

  it("shows planner period controls for monthly, weekly, and daily views", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Yearly" }));

    expect(screen.queryByRole("button", { name: "Choose Weekly date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose Daily date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous week" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous day" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Monthly" }));

    const monthlyNavigation = within(
      screen.getByRole("group", { name: "Planner period navigation" }),
    );
    await user.click(monthlyNavigation.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("button", { name: "Choose Monthly date" })).toBeInTheDocument();
    await user.click(monthlyNavigation.getByRole("button", { name: "Now" }));
    await user.click(screen.getByRole("button", { name: "Choose Monthly date" }));
    const monthlyPicker = screen.getByRole("dialog", { name: "Choose Monthly date" });
    const yearSelect = within(monthlyPicker).getByLabelText("Year");
    await waitFor(() => expect(yearSelect).toHaveFocus());
    await user.selectOptions(
      yearSelect,
      String(new Date().getFullYear() + 1),
    );
    const monthSelect = within(monthlyPicker).getByLabelText("Month");
    await user.selectOptions(monthSelect, "06");
    expect(monthSelect).toHaveFocus();
    expect(screen.getByRole("button", { name: "Choose Monthly date" })).toHaveTextContent(
      `June ${new Date().getFullYear() + 1}`,
    );

    expect(screen.queryByRole("button", { name: "Choose Weekly date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose Daily date" })).toBeNull();
    expect(monthlyNavigation.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(monthlyNavigation.getByRole("button", { name: "Next month" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Weekly" }));

    expect(screen.getByRole("button", { name: "Choose Weekly date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose Daily date" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Daily" }));

    expect(screen.getByRole("button", { name: "Choose Daily date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose Weekly date" })).toBeNull();
  });

  it("dismisses the monthly planner picker with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));

    const monthlyTrigger = screen.getByRole("button", { name: "Choose Monthly date" });
    await user.click(monthlyTrigger);
    expect(screen.getByRole("dialog", { name: "Choose Monthly date" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Monthly date" })).toBeNull(),
    );
    expect(monthlyTrigger).toHaveFocus();
  });

  it("dismisses the monthly planner picker on outside pointer and restores trigger focus", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));

    const monthlyTrigger = screen.getByRole("button", { name: "Choose Monthly date" });
    await user.click(monthlyTrigger);
    expect(screen.getByRole("dialog", { name: "Choose Monthly date" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Monthly date" })).toBeNull(),
    );
    expect(monthlyTrigger).toHaveFocus();
  });

  it("keeps the weekly title pill and date navigator in the same leading toolbar group", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    const titlePill = document.querySelector(".planner-view-pill");
    const trigger = screen.getByRole("button", { name: "Choose Weekly date" });
    const addButton = screen.getByRole("button", { name: "Add to Month Goals" });
    const leadingGroup = trigger.closest(".planner-view-leading");

    expect(titlePill).not.toBeNull();
    expect(leadingGroup).not.toBeNull();
    expect(titlePill?.closest(".planner-view-leading")).toBe(leadingGroup);
    expect(addButton.closest(".planner-view-actions")).not.toBeNull();
    expect(leadingGroup).not.toBe(addButton.closest(".planner-view-actions"));
  });

  it("matches weekly and daily keyboard focus previews to their committed ranges", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    await user.click(screen.getByRole("button", { name: "Choose Weekly date" }));
    const weeklyPicker = screen.getByRole("dialog", { name: "Choose Weekly date" });
    const weeklyCandidate = within(weeklyPicker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(weeklyCandidate).toBeDefined();
    if (!weeklyCandidate) {
      throw new Error("Missing unselected weekly calendar candidate.");
    }

    fireEvent.focus(weeklyCandidate);
    expect(calendarPreviewButtons(weeklyPicker)).toHaveLength(7);

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );

    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Choose Daily date" }));
    const dailyPicker = screen.getByRole("dialog", { name: "Choose Daily date" });
    const dailyCandidate = within(dailyPicker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(dailyCandidate).toBeDefined();
    if (!dailyCandidate) {
      throw new Error("Missing unselected daily calendar candidate.");
    }

    fireEvent.focus(dailyCandidate);
    expect(calendarPreviewButtons(dailyPicker)).toHaveLength(1);
  });

  it("dismisses the weekly planner date portal on outside pointer without committing a new period", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    const weeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
    const triggerTextBefore = weeklyTrigger.textContent;

    await user.click(weeklyTrigger);
    expect(screen.getByRole("dialog", { name: "Choose Weekly date" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Choose Weekly date" })).toHaveTextContent(
      triggerTextBefore ?? "",
    );
    expect(screen.getByRole("button", { name: "Choose Weekly date" })).toHaveFocus();
  });

  it("previews and selects planner weeks from the shared calendar popover", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    const weeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
    expect(
      weeklyTrigger.compareDocumentPosition(screen.getByRole("button", { name: "Now" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(weeklyTrigger);
    const picker = screen.getByRole("dialog", { name: "Choose Weekly date" });
    const candidate = within(picker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(candidate).toBeDefined();
    if (!candidate) {
      throw new Error("Missing unselected weekly calendar candidate.");
    }

    fireEvent.mouseEnter(candidate);
    const { start, end } = calendarSelectionRange(candidate);
    expect(calendarPreviewButtons(picker)).toHaveLength(7);

    await user.click(candidate);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: `Mon · ${start}` })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: `Sun · ${end}` })).toBeInTheDocument();

    const updatedWeeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
    await user.click(updatedWeeklyTrigger);
    const reopenedPicker = screen.getByRole("dialog", { name: "Choose Weekly date" });
    fireEvent.keyDown(reopenedPicker, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Weekly date" })).toBeNull(),
    );
    expect(updatedWeeklyTrigger).toHaveFocus();
  });

  it("previews and selects planner days from the shared calendar popover", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));

    const dailyTrigger = screen.getByRole("button", { name: "Choose Daily date" });
    expect(
      dailyTrigger.compareDocumentPosition(screen.getByRole("button", { name: "Now" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(dailyTrigger);
    const picker = screen.getByRole("dialog", { name: "Choose Daily date" });
    const candidate = within(picker)
      .getAllByRole("button")
      .find(
        (button) =>
          button.classList.contains("goal-period-calendar-day") &&
          !button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(candidate).toBeDefined();
    if (!candidate) {
      throw new Error("Missing unselected daily calendar candidate.");
    }

    fireEvent.mouseEnter(candidate);
    expect(calendarPreviewButtons(picker)).toHaveLength(1);

    const selectedDayLabel = calendarSelectionDayLabel(candidate);
    await user.click(candidate);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Daily date" })).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: selectedDayLabel })).toBeInTheDocument();

    const updatedDailyTrigger = screen.getByRole("button", { name: "Choose Daily date" });
    await user.click(updatedDailyTrigger);
    const reopenedPicker = screen.getByRole("dialog", { name: "Choose Daily date" });
    fireEvent.keyDown(reopenedPicker, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Choose Daily date" })).toBeNull(),
    );
    expect(updatedDailyTrigger).toHaveFocus();
  });

  it("groups weekly goal strips with planner controls while keeping day cards visible", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  {
                    id: "month-goal-b",
                    type: "goal",
                    title: "Beta Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "month-goal-a",
                    type: "goal",
                    title: "Alpha Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal-b",
                    type: "goal",
                    title: "Beta Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal-a",
                    type: "goal",
                    title: "Alpha Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal-ops",
                    type: "goal",
                    title: "Ops Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["ops"],
                  },
                ]
              : url === "/api/v1/todo/items?type=task"
                ? [
                    {
                      id: "task-1",
                      type: "task",
                      title: "Monday Task",
                      status: "active",
                      scheduled: weekStart,
                      tags: ["focus"],
                    },
                  ]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Alpha Month Goal");

    await user.click(screen.getByRole("button", { name: "Sort Month Goals" }));
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");
    await user.click(screen.getByRole("button", { name: "Group Month Goals" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));

    const monthGoals = screen.getByLabelText("Weekly month goals");
    expect(within(monthGoals).getByRole("heading", { name: "focus" })).toBeInTheDocument();
    expect(
      Array.from(monthGoals.querySelectorAll(".planner-item")).map((button) => button.textContent),
    ).toEqual(["Alpha Month Goal", "Beta Month Goal"]);

    const weekGoals = screen.getByLabelText("Weekly goals");
    expect(within(weekGoals).queryByRole("heading", { name: "focus" })).toBeNull();
    expect(within(weekGoals).getByText("Alpha Week Goal")).toBeInTheDocument();
    expect(within(weekGoals).getByText("Beta Week Goal")).toBeInTheDocument();
    expect(within(weekGoals).getByText("Ops Week Goal")).toBeInTheDocument();

    expect(screen.getByText("Monday Task")).toBeInTheDocument();
    expect(screen.getAllByTestId("weekly-day-card")).toHaveLength(7);
  });

  it("ignores unsupported weekly group values when switching to monthly planner", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  {
                    id: "goal-1",
                    type: "goal",
                    title: "Work Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    area_id: "area-1",
                  },
                ]
              : url === "/api/v1/todo/items?type=area"
                ? [{ id: "area-1", type: "area", title: "Work", status: "active" }]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));

    await user.click(screen.getByRole("button", { name: "Group Weekday grid" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Area" }));

    expect(screen.getByText("Grouped by area")).toBeInTheDocument();
    await savePlannerView(user, "Weekday grid views");

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Work Goal");

    expect(screen.queryByText("Grouped by area")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Work" })).toBeNull();
  });

  it("keeps weekly sort and group choices isolated from monthly and yearly tabs", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    const yearStart = testYearStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  {
                    id: "year-goal",
                    type: "goal",
                    title: "Year Goal",
                    status: "active",
                    horizon: "year",
                    scheduled: yearStart,
                    area_id: "area-1",
                  },
                  {
                    id: "month-goal",
                    type: "goal",
                    title: "Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    area_id: "area-1",
                  },
                  {
                    id: "week-goal",
                    type: "goal",
                    title: "Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    area_id: "area-1",
                  },
                ]
              : url === "/api/v1/todo/items?type=task"
                ? [
                    {
                      id: "task-1",
                      type: "task",
                      title: "Weekly Task",
                      status: "active",
                      scheduled: weekStart,
                      area_id: "area-1",
                    },
                  ]
                : url === "/api/v1/todo/items?type=area"
                  ? [{ id: "area-1", type: "area", title: "Work", status: "active" }]
                  : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");

    await user.click(screen.getByRole("button", { name: "Sort Weekday grid" }));
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");
    await user.click(screen.getByRole("button", { name: "Group Weekday grid" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Area" }));

    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
    expect(screen.getByText("Grouped by area")).toBeInTheDocument();
    await savePlannerView(user, "Weekday grid views");

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Month Goal");
    expect(screen.queryByText("Sorted by title")).toBeNull();
    expect(screen.queryByText("Grouped by area")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Yearly" }));
    await screen.findByText("Year Goal");
    expect(screen.queryByText("Sorted by title")).toBeNull();
    expect(screen.queryByText("Grouped by area")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
    expect(screen.getByText("Grouped by area")).toBeInTheDocument();
  });

  it("keeps weekday-grid sort and group choices after visiting monthly", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  {
                    id: "month-goal-b",
                    type: "goal",
                    title: "Beta Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "month-goal-a",
                    type: "goal",
                    title: "Alpha Month Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["focus"],
                  },
                  {
                    id: "week-goal",
                    type: "goal",
                    title: "Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: weekStart,
                    tags: ["focus"],
                  },
                ]
              : url === "/api/v1/todo/items?type=task"
                ? [
                    {
                      id: "task-1",
                      type: "task",
                      title: "Weekly Task",
                      status: "active",
                      scheduled: weekStart,
                      tags: ["focus"],
                    },
                  ]
                : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");

    await user.click(screen.getByRole("button", { name: "Sort Weekday grid" }));
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");
    await user.click(screen.getByRole("button", { name: "Group Weekday grid" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));
    await savePlannerView(user, "Weekday grid views");

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Alpha Month Goal");

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("Week Goal");
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();
    expect(screen.getByText("Grouped by tag")).toBeInTheDocument();
  });

  it("shows an active sort pill when planner sort differs from the tab default", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const weekStart = testWeekStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [
                  {
                    id: "task-b",
                    type: "task",
                    title: "B Task",
                    status: "active",
                    scheduled: weekStart,
                  },
                  {
                    id: "task-a",
                    type: "task",
                    title: "A Task",
                    status: "active",
                    scheduled: weekStart,
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await screen.findByText("A Task");

    expect(screen.queryByLabelText("Active planner controls")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sort Weekday grid" }));
    await user.selectOptions(screen.getByLabelText("Sort field"), "title");

    expect(screen.getByLabelText("Active planner controls")).toBeInTheDocument();
    expect(screen.getByText("Sorted by title")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add sort" }));
    await user.click(
      within(screen.getByRole("listbox", { name: "Sort fields" })).getByRole("option", {
        name: "Updated",
      }),
    );
    const sortRows = screen
      .getAllByLabelText("Drag sort rule")
      .map((handle) => handle.closest(".planner-sort-row") as HTMLElement);
    const dataTransfer = {
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? "";
      },
    };
    fireEvent.dragStart(sortRows[1], { dataTransfer });
    fireEvent.dragOver(sortRows[0], { dataTransfer });
    fireEvent.drop(sortRows[0], { dataTransfer });

    expect(screen.getByText("Sorted by updated +1")).toBeInTheDocument();
  });

  it("renders yearly period carousel and twelve month goal cards", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const nextYearStart = testNextYearStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "goal-year", type: "goal", title: "Annual Goal", status: "active", horizon: "year", scheduled: yearStart, tags: ["annual-current"] },
        { id: "goal-other-year", type: "goal", title: "Other Year Goal", status: "active", horizon: "year", scheduled: nextYearStart, tags: ["annual-future"] },
        { id: "goal-month", type: "goal", title: "Monthly Goal", status: "active", horizon: "month", scheduled: monthStart, tags: ["month-current"] },
        { id: "goal-year-done", type: "goal", title: "Completed Annual Goal", status: "completed", horizon: "year", scheduled: yearStart, tags: ["annual-done"] },
      ],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(await screen.findByRole("region", { name: "Year goal carousel" })).toBeInTheDocument();
    expect(screen.getByText("Annual Goal")).toBeInTheDocument();
    expect(screen.getByText("Other Year Goal")).toBeInTheDocument();
    expect(screen.queryByText("Completed Annual Goal")).toBeNull();
    expect(screen.getAllByTestId("yearly-month-card")).toHaveLength(12);
    expect(
      screen.getByRole("region", { name: `${testMonthLabel(monthStart)} goals` }),
    ).toHaveTextContent("Monthly Goal");
    expect(screen.getByRole("button", { name: "Previous year" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next year" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter Year Goals" }));
    const yearlyFilter = screen.getByRole("dialog", { name: "Filter Year Goals" });
    await user.click(within(yearlyFilter).getByRole("button", { name: "Add filter rule" }));
    expect(within(yearlyFilter).getByRole("option", { name: "Horizon" })).toBeInTheDocument();
    expect(within(yearlyFilter).getByRole("option", { name: "Parent" })).toBeInTheDocument();
    expect(within(yearlyFilter).queryByRole("option", { name: "Priority" })).toBeNull();
    await user.click(within(yearlyFilter).getByRole("option", { name: "Tags" }));
    await user.click(within(yearlyFilter).getByRole("button", { name: "Select Tags filter values" }));
    expect(within(yearlyFilter).getByRole("checkbox", { name: "annual-current" })).toBeInTheDocument();
    expect(within(yearlyFilter).getByRole("checkbox", { name: "annual-future" })).toBeInTheDocument();
    expect(within(yearlyFilter).queryByRole("checkbox", { name: "annual-done" })).toBeNull();
    expect(within(yearlyFilter).queryByRole("checkbox", { name: "month-current" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Group Month Goals" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));
    const yearlyGroupPanel = screen.getByRole("dialog", { name: "Group Month Goals" });
    expect(within(yearlyGroupPanel).getByText("month-current")).toBeInTheDocument();
    expect(within(yearlyGroupPanel).queryByText("annual-current")).toBeNull();
    expect(within(yearlyGroupPanel).queryByText("annual-future")).toBeNull();
  });

  it("keeps a Year Goals tag filter active when its option leaves the navigated period", async () => {
    const user = userEvent.setup();
    const currentYear = testYearStart(testToday());
    const nextYear = testNextYearStart(currentYear);
    const targetYear = testNextYearStart(nextYear);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  { id: "goal-current", type: "goal", title: "Current annual goal", status: "active", horizon: "year", scheduled: currentYear, tags: ["focus"] },
                  { id: "goal-target", type: "goal", title: "Other annual goal", status: "active", horizon: "year", scheduled: targetYear, tags: ["ops"] },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Current annual goal");

    await user.click(screen.getByRole("button", { name: "Filter Year Goals" }));
    const filterDialog = screen.getByRole("dialog", { name: "Filter Year Goals" });
    await user.click(within(filterDialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filterDialog).getByRole("option", { name: "Tags" }));
    await user.click(within(filterDialog).getByRole("button", { name: "Select Tags filter values" }));
    await user.click(within(filterDialog).getByRole("checkbox", { name: "focus" }));
    await user.click(screen.getByRole("button", { name: "Filter Year Goals" }));

    await user.click(screen.getByRole("button", { name: "Next year" }));
    await user.click(screen.getByRole("button", { name: "Next year" }));

    const selectedCard = screen
      .getByRole("region", { name: "Year goal carousel" })
      .querySelector<HTMLElement>('[data-position="selected"]');
    expect(selectedCard).not.toBeNull();
    expect(within(selectedCard as HTMLElement).queryAllByRole("button", { name: /annual goal/ })).toHaveLength(0);
    expect(screen.queryByText("Other annual goal")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter Year Goals" }));
    expect(screen.getByRole("button", { name: "Select Tags filter values" })).toHaveTextContent("focus");
  });

  it("renders monthly period carousel and ISO Monday week goal cards", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    const nextMonthStart = testNextMonthStart(today);
    const firstWeekStart = testWeekStart(monthStart);
    const secondWeekStart = testAddDays(firstWeekStart, 7);
    const firstWeekEventDate = testAddDays(firstWeekStart, 2);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "goal-month", type: "goal", title: "Monthly Goal", status: "active", horizon: "month", scheduled: monthStart, tags: ["month-current"] },
        { id: "goal-other-month", type: "goal", title: "Other Month Goal", status: "active", horizon: "month", scheduled: nextMonthStart, tags: ["month-future"] },
        { id: "goal-week-1", type: "goal", title: "First Week Goal", status: "active", horizon: "week", scheduled: firstWeekStart, tags: ["week-current"] },
        { id: "goal-week-2", type: "goal", title: "Second Week Goal", status: "active", horizon: "week", scheduled: secondWeekStart, tags: ["week-current"] },
        { id: "goal-week-done", type: "goal", title: "Done Week Goal", status: "completed", horizon: "week", scheduled: firstWeekStart, tags: ["week-done"] },
      ],
      "/api/v1/todo/items?type=task": [
        { id: "task-active", type: "task", title: "Active task", status: "active", scheduled: firstWeekStart, tags: ["month-todo"], updated_at: "2026-07-01T09:00:00Z" },
        { id: "task-completed", type: "task", title: "Completed task", status: "completed", scheduled: firstWeekStart, tags: ["month-todo"], updated_at: "2026-07-01T08:00:00Z" },
        { id: "task-secondary-active", type: "task", title: "Secondary active task", status: "active", scheduled: testAddDays(firstWeekStart, 1), tags: ["month-todo"], updated_at: "2026-07-01T07:00:00Z" },
        { id: "task-waiting", type: "task", title: "Waiting task", status: "waiting", scheduled: testAddDays(firstWeekStart, 1), tags: ["month-todo"], updated_at: "2026-07-01T06:00:00Z" },
        { id: "task-additional-active", type: "task", title: "Additional active task", status: "active", scheduled: testAddDays(firstWeekStart, 3), tags: ["month-todo"], updated_at: "2026-07-01T05:00:00Z" },
        { id: "task-paused", type: "task", title: "Paused task", status: "paused", scheduled: testAddDays(firstWeekStart, 3), tags: ["month-todo"], updated_at: "2026-07-01T04:00:00Z" },
      ],
      "/api/v1/todo/items?type=event": [
        { id: "event-month", type: "event", title: "Month Event", status: "active", scheduled: firstWeekEventDate, tags: ["month-todo"] },
      ],
      "/api/v1/todo/items?type=routine": [],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(await screen.findByRole("region", { name: "Month goal carousel" })).toBeInTheDocument();
    expect(screen.getByText("Monthly Goal")).toBeInTheDocument();
    expect(screen.getByText("Other Month Goal")).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "Monthly todo calendar" })).toBeInTheDocument();
    const weekdayHeader = screen.getByRole("row", { name: "Monthly weekdays" });
    expect(
      within(weekdayHeader).getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(screen.getAllByTestId("monthly-week-row").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByTestId("monthly-day-card").length).toBeGreaterThanOrEqual(28);
    expect(screen.getByRole("gridcell", { name: `${firstWeekStart} todo` })).toHaveTextContent("Active task");
    expect(screen.getByRole("gridcell", { name: `${firstWeekStart} todo` })).toHaveTextContent("Completed task");
    expect(await screen.findByRole("checkbox", { name: "Complete Active task" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Complete Secondary active task" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Complete Additional active task" })).not.toBeChecked();
    for (const title of ["Waiting task", "Paused task"]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: new RegExp(title) })).toBeNull();
    }
    expect(screen.getByRole("checkbox", { name: "Complete Month Event" })).not.toBeChecked();
    expect(screen.getByRole("gridcell", { name: `${firstWeekEventDate} todo` })).toHaveTextContent("Month Event");
    expect(screen.getAllByTestId("monthly-week-goal-rail").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("region", { name: "W1 goals" })).toHaveTextContent("First Week Goal");
    expect(screen.getByRole("region", { name: "W2 goals" })).toHaveTextContent("Second Week Goal");
    expect(screen.queryByText("Done Week Goal")).toBeNull();
    const monthlyNavigation = within(
      screen.getByRole("group", { name: "Planner period navigation" }),
    );
    expect(monthlyNavigation.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
    expect(monthlyNavigation.getByRole("button", { name: "Next month" })).toBeInTheDocument();
    expect(monthlyNavigation.getByRole("button", { name: "Now" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Group Week Goals" }));
    await user.click(screen.getByRole("button", { name: "Choose group property" }));
    await user.click(screen.getByRole("option", { name: "Tag" }));
    const monthlyGroupPanel = screen.getByRole("dialog", { name: "Group Week Goals" });
    expect(within(monthlyGroupPanel).getByText("week-current")).toBeInTheDocument();
    expect(within(monthlyGroupPanel).queryByText("month-current")).toBeNull();
    expect(within(monthlyGroupPanel).queryByText("month-future")).toBeNull();
  });

  it("keeps a Month Goals relation filter active when its option leaves the navigated period", async () => {
    const user = userEvent.setup();
    const currentMonth = testMonthStart(testToday());
    const nextMonth = testNextMonthStart(currentMonth);
    const targetMonth = testNextMonthStart(nextMonth);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  { id: "parent-current", type: "goal", title: "Current parent", status: "active", horizon: "year", scheduled: testYearStart(currentMonth) },
                  { id: "parent-target", type: "goal", title: "Target parent", status: "active", horizon: "year", scheduled: testYearStart(targetMonth) },
                  { id: "goal-current-month", type: "goal", title: "Current month goal", status: "active", horizon: "month", scheduled: currentMonth, parent_id: "parent-current" },
                  { id: "goal-target-month", type: "goal", title: "Other month goal", status: "active", horizon: "month", scheduled: targetMonth, parent_id: "parent-target" },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Current month goal");

    await user.click(screen.getByRole("button", { name: "Filter Month Goals" }));
    const filterDialog = screen.getByRole("dialog", { name: "Filter Month Goals" });
    await user.click(within(filterDialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filterDialog).getByRole("option", { name: "Parent" }));
    await user.click(within(filterDialog).getByRole("button", { name: "Select Parent filter values" }));
    await user.click(within(filterDialog).getByRole("checkbox", { name: "Current parent" }));
    await user.click(screen.getByRole("button", { name: "Filter Month Goals" }));

    const monthlyNavigation = within(
      screen.getByRole("group", { name: "Planner period navigation" }),
    );
    await user.click(monthlyNavigation.getByRole("button", { name: "Next month" }));
    await user.click(monthlyNavigation.getByRole("button", { name: "Next month" }));

    const selectedCard = screen
      .getByRole("region", { name: "Month goal carousel" })
      .querySelector<HTMLElement>('[data-position="selected"]');
    expect(selectedCard).not.toBeNull();
    expect(within(selectedCard as HTMLElement).queryAllByRole("button", { name: /month goal/ })).toHaveLength(0);
    expect(screen.queryByText("Other month goal")).toBeNull();
    expect(screen.getByText("1 rules")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filter Month Goals" }));
    expect(screen.getByRole("button", { name: "Select Parent filter values" })).toHaveTextContent("Current parent");
  });

  it("opens monthly day overflow with sorted task and event items", async () => {
    const { firstWeekStart, moreButton, user } = await renderMonthlyDayOverflow();

    expect(moreButton).toHaveTextContent("+2 more");
    await user.click(moreButton);

    const overflow = screen.getByRole("dialog", { name: `${firstWeekStart} items` });
    expect(within(overflow).queryByText("Monthly routine")).toBeNull();
    expect(
      Array.from(overflow.querySelectorAll(".monthly-day-item"))
        .map((button) => button.textContent),
    ).toEqual(["Latest task", "Overflow task", "Middle event", "Earliest task"]);

    await user.click(within(overflow).getByRole("button", { name: "Overflow task" }));
    expect(await screen.findByRole("heading", { name: "Overflow task" })).toBeInTheDocument();
  });

  it("focuses the first item when opening monthly day overflow", async () => {
    const { firstWeekStart, moreButton, user } = await renderMonthlyDayOverflow();

    await user.click(moreButton);
    const overflow = screen.getByRole("dialog", { name: `${firstWeekStart} items` });

    await waitFor(() => {
      expect(within(overflow).getByRole("button", { name: "Latest task" })).toHaveFocus();
    });
  });

  it("switches monthly day overflow dates without restoring focus to the previous trigger", async () => {
    const {
      firstWeekStart,
      moreButton,
      secondDate,
      secondMoreButton,
      user,
    } = await renderMonthlyDayOverflow();

    await user.click(moreButton);
    expect(screen.getByRole("dialog", { name: `${firstWeekStart} items` })).toBeInTheDocument();
    await user.click(secondMoreButton);

    const overflow = screen.getByRole("dialog", { name: `${secondDate} items` });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => {
      expect(within(overflow).getByRole("button", { name: "Second day latest" })).toHaveFocus();
      expect(moreButton).not.toHaveFocus();
    });
  });

  it("dismisses monthly day overflow with Escape and restores focus", async () => {
    const { firstWeekStart, moreButton, user } = await renderMonthlyDayOverflow();

    await user.click(moreButton);
    expect(screen.getByRole("dialog", { name: `${firstWeekStart} items` })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: `${firstWeekStart} items` })).toBeNull();
      expect(moreButton).toHaveFocus();
    });
  });

  it("dismisses monthly day overflow on outside press and restores focus", async () => {
    const { firstWeekStart, moreButton, user } = await renderMonthlyDayOverflow();

    await user.click(moreButton);
    expect(screen.getByRole("dialog", { name: `${firstWeekStart} items` })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: `${firstWeekStart} items` })).toBeNull();
      expect(moreButton).toHaveFocus();
    });
  });

  it("moves monthly periods with arrows and returns with Now", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    const nextMonthStart = testNextMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "current", type: "goal", title: "Current Month", status: "active", horizon: "month", scheduled: monthStart },
        { id: "next", type: "goal", title: "Next Month", status: "active", horizon: "month", scheduled: nextMonthStart },
      ],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(await screen.findByText("Current Month")).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "Planner period navigation" })).getByRole("button", {
        name: "Next month",
      }),
    );
    expect(await screen.findByText("Next Month")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Now" }));
    expect(await screen.findByText("Current Month")).toBeInTheDocument();
  });

  it("disables Now when yearly or monthly planner already matches the current period", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const monthStart = testMonthStart(today);
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=goal": [
        { id: "current-year", type: "goal", title: "Current Year", status: "active", horizon: "year", scheduled: yearStart },
        { id: "current-month", type: "goal", title: "Current Month", status: "active", horizon: "month", scheduled: monthStart },
      ],
      "/api/v1/todo/items?type=area": [],
      "/api/v1/todo/items?type=project": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => responses[url] ?? [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    expect(await screen.findByText("Current Year")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Monthly" }));

    expect(await screen.findByText("Current Month")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Now" })).toBeDisabled();
  });

  it("keeps same-year month goal tags out of Yearly period-goal filters", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const yearStart = testYearStart(today);
    const monthStart = testMonthStart(today);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  {
                    id: "goal-year",
                    type: "goal",
                    title: "Annual Goal",
                    status: "active",
                    horizon: "year",
                    scheduled: yearStart,
                    tags: ["annual-current"],
                  },
                  {
                    id: "goal-month",
                    type: "goal",
                    title: "Monthly Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["month-current"],
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await screen.findByText("Annual Goal");

    await user.click(screen.getByRole("button", { name: "Filter Year Goals" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Year Goals" });
    await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(dialog).getByRole("option", { name: "Tags" }));
    await user.click(within(dialog).getByRole("button", { name: "Select Tags filter values" }));
    expect(within(dialog).getByRole("checkbox", { name: "annual-current" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "month-current" })).toBeNull();
  });

  it("keeps intersecting week goal tags scoped to Monthly weekly-rail filters", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const monthStart = testMonthStart(today);
    const firstWeekStart = testWeekStart(monthStart);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [
                  {
                    id: "goal-month",
                    type: "goal",
                    title: "Monthly Goal",
                    status: "active",
                    horizon: "month",
                    scheduled: monthStart,
                    tags: ["month-current"],
                  },
                  {
                    id: "goal-week-1",
                    type: "goal",
                    title: "First Week Goal",
                    status: "active",
                    horizon: "week",
                    scheduled: firstWeekStart,
                    tags: ["week-current"],
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await screen.findByText("Monthly Goal");

    await user.click(screen.getByRole("button", { name: "Filter Week Goals" }));
    const dialog = screen.getByRole("dialog", { name: "Filter Week Goals" });
    await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(dialog).getByRole("option", { name: "Tags" }));
    await user.click(within(dialog).getByRole("button", { name: "Select Tags filter values" }));
    expect(within(dialog).getByRole("checkbox", { name: "week-current" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "month-current" })).toBeNull();
  });

  it("normalizes visible workspace tags after save", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: ["deep-work", "planning"],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "Plan", status: "active", tags: ["deep-work"] },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const tagField = await screen.findByRole("button", { name: "Tags for Plan" });
    expect(within(tagField).queryByRole("textbox")).toBeNull();
    await user.click(tagField);
    const tags = screen.getByPlaceholderText("Search for an option...");
    await user.type(tags, " deep-work, deep-work, planning ");
    fireEvent.blur(tags);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove planning tag" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Remove deep-work tag" })).toBeInTheDocument();
  });

  it("turns entered workspace tags into removable chips", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: body.tags,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work"],
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("button", { name: "Tags for Plan" }));
    const tags = screen.getByPlaceholderText("Search for an option...");
    await user.type(tags, "planning{Enter}");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          method: "PATCH",
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Remove planning tag" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work"] }),
          method: "PATCH",
        }),
      ),
    );
  });

  it("selects stored tags from the workspace tag dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: body.tags,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url === "/api/v1/todo/items") {
            return [
              { id: "task-1", type: "task", title: "Plan", status: "active", tags: ["deep-work"] },
              { id: "project-1", type: "project", title: "Roadmap", status: "active", tags: ["planning"] },
              { id: "area-1", type: "area", title: "Ops", status: "active", tags: ["ops"] },
            ];
          }

          return url === "/api/v1/todo/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work"],
                },
              ]
            : [];
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const tagField = await screen.findByRole("button", { name: "Tags for Plan" });
    expect(within(tagField).queryByRole("textbox")).toBeNull();
    await user.click(tagField);

    expect(screen.getByPlaceholderText("Search for an option...")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "planning" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          method: "PATCH",
        }),
      ),
    );
  });

  it("waits for IME composition to finish before committing a tag", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { tags: string[] };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: body.tags,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work"],
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("button", { name: "Tags for Plan" }));
    const tags = screen.getByPlaceholderText("Search for an option...");
    fireEvent.change(tags, { target: { value: "새 태그" } });
    fireEvent.keyDown(tags, { key: "Enter", isComposing: true });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items/task-1")).toEqual([]);

    fireEvent.keyDown(tags, { key: "Enter", isComposing: false });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/task-1",
        expect.objectContaining({
          body: JSON.stringify({ tags: ["deep-work", "새 태그"] }),
          method: "PATCH",
        }),
      ),
    );
  });

  it("does not patch tags when only spacing changes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=task"
            ? [
                {
                  id: "task-1",
                  type: "task",
                  title: "Plan",
                  status: "active",
                  tags: ["deep-work", "planning"],
                },
              ]
            : [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("button", { name: "Tags for Plan" }));
    const tags = screen.getByPlaceholderText("Search for an option...");
    await user.type(tags, " deep-work, planning ");
    fireEvent.blur(tags);

    expect(screen.getByRole("button", { name: "Remove deep-work tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove planning tag" })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items/task-1"),
    ).toHaveLength(0);
  });

  it("shows linked workspace item titles in item-specific columns", async () => {
    const user = userEvent.setup();
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=area": [
        {
          id: "area-1",
          type: "area",
          title: "Health",
          status: "active",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/api/v1/todo/items?type=project": [
        {
          id: "project-1",
          type: "project",
          title: "Recovery Plan",
          status: "active",
          area_id: "area-1",
          due: "2026-06-30",
          definition_of_done: "Walk without pain",
          note: "Check weekly",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/api/v1/todo/items?type=routine": [
        {
          id: "routine-1",
          type: "routine",
          title: "Stretch",
          status: "active",
          area_id: "area-1",
          recurrence_rule: "daily",
          materialization_policy: "single_open",
          note: "After coffee",
          last_materialized_at: "2026-06-21T07:00:00Z",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/api/v1/todo/items?type=task": [
        {
          id: "task-1",
          type: "task",
          title: "Book physio",
          status: "active",
          area_id: "area-1",
          project_id: "project-1",
          routine_id: "routine-1",
          description: "Call clinic and confirm insurance",
          note: "Call before noon",
          created_at: "2026-06-20T00:00:00Z",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/api/v1/todo/items?type=event": [
        {
          id: "event-1",
          type: "event",
          title: "Planning review",
          status: "active",
          area_id: "area-1",
          scheduled: "2026-06-24T10:00:00Z",
          metadata_: { location: "Desk", participants: ["Me"] },
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
      "/api/v1/todo/items?type=goal": [
        {
          id: "goal-1",
          type: "goal",
          title: "June outcome",
          status: "active",
          area_id: "area-1",
          horizon: "month",
          scheduled: "2026-06-01",
          due: "2026-06-30",
          parent_id: "goal-root",
          updated_at: "2026-06-21T00:00:00Z",
        },
        {
          id: "goal-root",
          type: "goal",
          title: "Root objective",
          status: "active",
          updated_at: "2026-06-21T00:00:00Z",
        },
      ],
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => responses[url] ?? [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("cell", { name: "Walk without pain" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Due for Recovery Plan")).toHaveValue("2026-06-30");
    expect(screen.getByRole("cell", { name: "Check weekly" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Recovery Plan" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Stretch" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Call clinic and confirm insurance" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Call before noon" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "2026-06-20" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("cell", { name: "2026-06-21" }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Description for Book physio")).toBeNull();
    expect(screen.queryByLabelText("Note for Book physio")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Routines" }));

    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "daily" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Health" })).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Single open" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "After coffee" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "2026-06-21" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Events" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "Planning review" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Starts At for Planning review")).toHaveValue(
      "2026-06-24T10:00",
    );
    expect(screen.getByRole("cell", { name: "Desk" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Me" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Goals" }));

    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "June outcome" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("cell", { name: "Root objective" })).toHaveLength(
      2,
    );
    expect(screen.getByRole("button", { name: "Period for June outcome" })).toHaveTextContent(
      "Month",
    );
    expect(screen.queryByLabelText("Due for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Horizon for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Scheduled for June outcome")).toBeNull();
  }, 10000);

  it("selects yearly when planner is clicked and daily when daily is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkbenchPageClient />);

    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(screen.getByRole("button", { name: "Yearly" })).toHaveAttribute(
      "data-active",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("enables trash only for selected rows and confirms archive", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith("/archive")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
          { id: "task-2", type: "task", title: "Two", status: "active" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const trash = await screen.findByRole("button", {
      name: "Archive selected items",
    });
    expect(trash).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Select One" }));
    expect(trash).toBeEnabled();

    await user.click(trash);
    expect(
      screen.getByRole("dialog", { name: "Archive selected items?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("focuses and traps the archive dialog, and closes it on escape", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/archive")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "active" },
          ],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(screen.getByRole("checkbox", { name: "Select One" }));
    await user.click(screen.getByRole("button", { name: "Archive selected items" }));

    const dialog = screen.getByRole("dialog", { name: "Archive selected items?" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Archive selected items?" })).toBeNull();
  });

  it("marks the select-all checkbox indeterminate for partial selection", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/archive")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "active" },
            { id: "task-2", type: "task", title: "Two", status: "active" },
          ],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const selectAll = screen.getByRole("checkbox", { name: "Select all visible items" }) as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Select One" }));
    await waitFor(() => {
      expect(selectAll.checked).toBe(false);
      expect(selectAll.indeterminate).toBe(true);
    });
  });

  it("opens a creation dialog and creates a row", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/tasks/propose") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "New task",
            status: "active",
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(screen.getByRole("button", { name: "Add to Tasks" }));

    expect(
      screen.getByRole("dialog", { name: "Create Tasks item" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "New task");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", { name: "New task" }),
    ).toBeInTheDocument();
  });

  it("focuses and traps the creation dialog through every control, and closes it on escape", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/propose")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    const addButton = screen.getByRole("button", { name: "Add to Goals" });
    await user.click(addButton);

    const dialog = screen.getByRole("dialog", { name: "Create Goals item" });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());

    await user.tab();
    expect(screen.getByRole("button", { name: "Period" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Create Goals item" })).toBeNull();
    expect(addButton).toHaveFocus();

    await user.click(addButton);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Create Goals item" })).toBeNull();
    expect(addButton).toHaveFocus();
  });

  it("creates workspace goals through one period control", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/goals/propose" && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            title: "July goal",
            horizon: "month",
            scheduled: "2026-07-01",
            actor: "user",
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-new",
            type: "goal",
            title: "July goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-07-01",
          }),
        });
      }

      if (url === "/api/v1/todo/items?type=goal" || url === "/api/v1/todo/items") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-existing",
              type: "goal",
              title: "Existing July goal",
              status: "active",
              horizon: "month",
              scheduled: "2026-07-01",
            },
          ],
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(screen.getByRole("button", { name: "Add to Goals" }));

    const trigger = screen.getByRole("button", { name: "Period" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    expect(screen.queryByLabelText("Horizon")).toBeNull();
    expect(screen.queryByLabelText("Due")).toBeNull();

    await user.type(screen.getByLabelText("Title"), "July goal");
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period" });
    expect(within(picker).getByRole("button", { name: "Year" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(picker).getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(within(picker).getByRole("button", { name: "Month" }));
    expect(screen.getByRole("dialog", { name: "Period" })).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Year");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(trigger).toHaveTextContent("Year");

    await user.click(trigger);
    const committedPicker = screen.getByRole("dialog", { name: "Period" });
    await user.click(within(committedPicker).getByRole("button", { name: "Month" }));
    await user.click(within(committedPicker).getByRole("button", { name: "July 2026" }));
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(trigger).toHaveTextContent("Month");

    await user.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(trigger).toHaveTextContent("Month");

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/goals/propose",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      await screen.findByRole("heading", { name: "July goal" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create Goals item" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    const goalsTable = await screen.findByRole("table", { name: "Goals items" });
    expect(
      within(goalsTable).getByRole("cell", { name: "Existing July goal" }),
    ).toBeInTheDocument();
    expect(within(goalsTable).getByRole("cell", { name: "July goal" })).toBeInTheDocument();
  });

  it("keeps a failed Goal creation in the dialog and allows retry", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/goals/propose" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({
              code: "validation_error",
              message: "The request is invalid.",
              fields: {},
              request_id: "00000000-0000-4000-8000-000000000005",
            }),
          });
        }

        expect(init.body).toBe(
          JSON.stringify({
            title: "Career",
            horizon: "month",
            scheduled: "2026-07-01",
            actor: "user",
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-retry",
            type: "goal",
            title: "Career",
            status: "active",
            horizon: "month",
            scheduled: "2026-07-01",
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(screen.getByRole("button", { name: "Add to Goals" }));
    await user.type(screen.getByLabelText("Title"), "Career");
    const trigger = screen.getByRole("button", { name: "Period" });
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period" });
    await user.click(within(picker).getByRole("button", { name: "Month" }));
    await user.click(within(picker).getByRole("button", { name: "July 2026" }));

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The request is invalid.");
    expect(screen.getByRole("dialog", { name: "Create Goals item" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Career");
    expect(trigger).toHaveTextContent(/^Month · July 2026$/);

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("heading", { name: "Career" })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("requires scheduled for event creation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).endsWith("/propose")) {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));
    await user.click(screen.getByRole("button", { name: "Add to Events" }));

    expect(screen.getByLabelText("Scheduled")).toBeRequired();
  });

  it("opens a detail view and saves note edits", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ note: "Saved note" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Saved note",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active", note: "Old note" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    await user.click(await screen.findByRole("cell", { name: "One" }));
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
    expect(screen.getByText("Properties")).toBeInTheDocument();
    const detailView = screen.getByLabelText("One details");
    expect(detailView.querySelector(".detail-header")).not.toBeNull();
    expect(detailView.querySelector(".detail-properties-list")).not.toBeNull();
    expect(detailView.querySelector(".detail-properties-grid")).toBeNull();
    expect(screen.getByRole("button", { name: "< Back" }).textContent).toBe("");
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton.textContent).toBe("");
    expect(saveButton).toBeDisabled();
    expect(detailView.querySelector(".detail-header")?.contains(saveButton)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.clear(note);
    await user.type(note, "Saved note");
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );

    await waitFor(() => expect(saveButton).toBeDisabled());
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Unsaved title");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Unsaved title");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("table", { name: "Tasks items" })).toBeInTheDocument();
  });

  it("traverses nested detail visits with browser history", async () => {
    const user = userEvent.setup();
    const originalUrl = window.location.href;
    window.history.replaceState({ preserved: "keep" }, "", originalUrl);
    const pushState = vi.spyOn(window.history, "pushState");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => linkedAreaItemsResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    expect(pushState).toHaveBeenCalledTimes(2);

    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    act(() => window.history.back());
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
    act(() => window.history.forward());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    act(() => window.history.forward());
    expect(await screen.findByLabelText("Checkup details")).toBeInTheDocument();
    expect(window.location.href).toBe(originalUrl);
    expect(window.history.state).toMatchObject({ preserved: "keep" });
    expect(pushState).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(await screen.findByRole("table", { name: "Tasks items" })).toBeInTheDocument();
    await waitFor(() =>
      expect(window.history.state).toMatchObject({
        preserved: "keep",
        __ravenDetailItemId: null,
      }),
    );
  });

  it("falls back to the list for an unavailable detail history item", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, json: async () => linkedAreaItemsResponse(url) }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
    window.history.pushState(
      { ...window.history.state, __ravenDetailItemId: "missing-item" },
      "",
    );

    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    act(() => window.history.forward());
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
  });

  it("confirms browser Back before discarding a dirty detail draft", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const controlledForward = controlHistoryForward();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => linkedAreaItemsResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Health draft");
    await user.tab();

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(1));
    await controlledForward.releaseNext();
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Health draft");
    act(() => window.history.back());
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Health draft");
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(2));
    await user.keyboard("{Escape}");
    await controlledForward.releaseNext();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull(),
    );
    controlledForward.spy.mockRestore();
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Health draft");

    act(() => window.history.back());
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Health draft");
    act(() => window.history.back());
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("defers Archive cancellation until browser Back restoration settles", async () => {
    const user = userEvent.setup();
    const controlledForward = controlHistoryForward();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, json: async () => linkedAreaItemsResponse(url) }),
      ),
    );

    await openLinkedHealthDetail(user);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const archiveDialog = screen.getByRole("dialog", { name: "Archive Health?" });

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(1));
    await user.click(within(archiveDialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Archive Health?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    await controlledForward.releaseNext();

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Archive Health?" })).toBeNull(),
    );
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    controlledForward.spy.mockRestore();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
  });

  it("keeps the first deferred Archive dialog intent while restoration settles", async () => {
    const user = userEvent.setup();
    const controlledForward = controlHistoryForward();
    let archiveAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        archiveAttempts += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Health",
            status: "archived",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog", { name: "Archive Health?" });
    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(1));

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    expect(archiveAttempts).toBe(0);
    expect(dialog).toHaveAttribute("aria-busy", "true");
    await controlledForward.releaseNext();

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Archive Health?" })).toBeNull(),
    );
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(archiveAttempts).toBe(0);
    controlledForward.spy.mockRestore();
  });

  it("defers successful Archive close until browser Back restoration settles", async () => {
    const user = userEvent.setup();
    const controlledForward = controlHistoryForward();
    const health = { id: "area-1", type: "area", title: "Health", status: "active" };
    const work = { id: "area-2", type: "area", title: "Work", status: "active" };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...health, status: "archived" }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [health, work],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(1));
    await user.click(within(
      screen.getByRole("dialog", { name: "Archive Health?" }),
    ).getByRole("button", { name: "Archive" }));

    expect(screen.getByRole("dialog", { name: "Archive Health?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    await controlledForward.releaseNext();

    const areasTable = await screen.findByRole("table", { name: "Areas items" });
    expect(within(areasTable).queryByRole("button", {
      name: "Open details for Health",
    })).toBeNull();
    await user.click(within(areasTable).getByRole("button", { name: "Open details for Work" }));
    expect(screen.getByLabelText("Work details")).toBeInTheDocument();
    controlledForward.spy.mockRestore();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
  });

  it("renders nonempty linked-item groups and opens the selected child", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => linkedAreaItemsResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));

    const linkedItems = screen.getByRole("region", { name: "Linked items" });
    expect(within(linkedItems).getByRole("heading", { name: "Projects · 1" })).toBeInTheDocument();
    expect(within(linkedItems).getByRole("heading", { name: "Tasks · 1" })).toBeInTheDocument();
    const layout = linkedItems.closest(".detail-layout");
    const note = layout?.querySelector(".detail-note");
    expect(layout).not.toBeNull();
    expect(note).not.toBeNull();
    if (!layout || !note) {
      throw new Error("Missing linked-item detail layout or Markdown note");
    }
    expect(linkedItems.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(layout.lastElementChild).toBe(note);
    await user.click(within(linkedItems).getByRole("button", { name: "Open Checkup details" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    const areaSelect = screen.getByLabelText("Area for Checkup");
    expect(areaSelect).toHaveValue("area-1");
    expect(within(areaSelect).getByRole("option", { name: "Health" })).toHaveValue("area-1");
  });

  it("omits Add from detail linked lists without leaving latent creation state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => linkedAreaItemsResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));

    const linkedItems = screen.getByRole("region", { name: "Linked items" });
    expect(within(linkedItems).queryByRole("button", { name: "Add to Projects" })).toBeNull();
    expect(within(linkedItems).queryByRole("button", { name: "Add to Tasks" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "< Back" }));

    expect(screen.queryByRole("dialog", { name: /^Create / })).toBeNull();
    expect(screen.getByRole("button", { name: "Add to Areas" })).toBeVisible();
  });

  it("caps each linked-item type at five direct children with accessible More and Less actions", async () => {
    const user = userEvent.setup();
    await openOverflowAreaDetail(user);

    const tasks = linkedItemTypeGroup("Tasks · 6");
    expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(5);
    expect(within(tasks).queryByRole("button", {
      name: "Open Indirect project task details",
    })).toBeNull();

    await user.click(within(tasks).getByRole("button", { name: "More (1) Tasks" }));
    expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(6);
    expect(within(tasks).getByRole("button", { name: "Less Tasks" })).toBeVisible();

    await user.click(within(tasks).getByRole("button", { name: "Less Tasks" }));
    expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(5);
    expect(within(tasks).getByRole("button", { name: "More (1) Tasks" })).toBeVisible();
  });

  it("starts retained linked types collapsed after navigating to another detail item", async () => {
    const user = userEvent.setup();
    await openOverflowAreaDetail(user);

    const areaTasks = linkedItemTypeGroup("Tasks · 6");
    await user.click(within(areaTasks).getByRole("button", { name: "More (1) Tasks" }));
    expect(within(areaTasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(6);

    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    expect(screen.getByLabelText("Checkup details")).toBeVisible();
    const projectTasks = linkedItemTypeGroup("Tasks · 7");
    expect(within(projectTasks).getAllByRole("button", {
      name: /^Open (?:Task \w+|Indirect project task) details$/,
    })).toHaveLength(5);
    expect(within(projectTasks).getByRole("button", {
      name: "More (2) Tasks",
    })).toBeVisible();
  });

  it("remounts same-type linked lists when navigating between nested Goal details", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => nestedGoalOverflowResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(await screen.findByRole("button", {
      name: "Open details for Parent goal",
    }));

    const parentTasks = linkedItemTypeGroup("Tasks · 6");
    await user.click(within(parentTasks).getByRole("button", { name: "More (1) Tasks" }));
    expect(within(parentTasks).getAllByRole("button", {
      name: /^Open Parent Task \d details$/,
    })).toHaveLength(6);

    await user.click(screen.getByRole("button", { name: "Open Child goal details" }));
    expect(screen.getByLabelText("Child goal details")).toBeVisible();
    const childTasks = linkedItemTypeGroup("Tasks · 6");
    expect(within(childTasks).getAllByRole("button", {
      name: /^Open Child Task \d details$/,
    })).toHaveLength(5);
    expect(within(childTasks).getByRole("button", { name: "More (1) Tasks" })).toBeVisible();
  });

  it("keeps linked Project and Task controls independent and removes overflow after filtering", async () => {
    const user = userEvent.setup();
    await openOverflowAreaDetail(user);

    const projects = linkedItemTypeGroup("Projects · 1");
    const tasks = linkedItemTypeGroup("Tasks · 6");
    expect(within(projects).getByRole("group", { name: "Projects controls" })).toBeVisible();
    expect(within(tasks).getByRole("group", { name: "Tasks controls" })).toBeVisible();
    expect(within(projects).getByRole("button", { name: "Filter Projects" })).toBeVisible();
    expect(within(projects).getByRole("button", { name: "Sort Projects" })).toBeVisible();
    expect(within(projects).getByRole("button", { name: "Group Projects" })).toBeVisible();
    expect(within(tasks).getByRole("button", { name: "Filter Tasks" })).toBeVisible();
    expect(within(tasks).getByRole("button", { name: "Sort Tasks" })).toBeVisible();
    expect(within(tasks).getByRole("button", { name: "Group Tasks" })).toBeVisible();
    expect(within(projects).getByRole("tablist", { name: "Projects views" })).toBeVisible();
    expect(within(tasks).getByRole("tablist", { name: "Tasks views" })).toBeVisible();

    await user.click(within(tasks).getByRole("button", { name: "Filter Tasks" }));
    const filter = screen.getByRole("dialog", { name: "Filter Tasks" });
    await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filter).getByRole("option", { name: "Status" }));
    await user.click(within(filter).getByRole("button", {
      name: "Select Status filter values",
    }));
    await user.click(within(filter).getByRole("checkbox", { name: "completed" }));

    expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(2);
    expect(within(tasks).queryByRole("button", { name: /More/ })).toBeNull();
    expect(within(projects).getByRole("button", {
      name: "Open Checkup details",
    })).toBeVisible();
    expect(within(projects).queryByText("No linked items match this view.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Tasks · 2" })).toBeVisible();
  });

  it("spans an empty linked-items view across its single column", async () => {
    const user = userEvent.setup();
    await openOverflowAreaDetail(user);

    const projects = linkedItemTypeGroup("Projects · 1");
    await user.click(within(projects).getByRole("button", { name: "Filter Projects" }));
    const filter = screen.getByRole("dialog", { name: "Filter Projects" });
    await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filter).getByRole("option", { name: "Status" }));
    await user.click(within(filter).getByRole("button", {
      name: "Select Status filter values",
    }));
    await user.click(within(filter).getByRole("checkbox", { name: "missed" }));

    const emptyCell = within(projects)
      .getByText("No linked items match this view.")
      .closest("td");
    expect(emptyCell).toHaveAttribute("colspan", "1");
  });

  it("applies the five-row cap across linked Task groups instead of per group", async () => {
    const user = userEvent.setup();
    await openOverflowAreaDetail(user);

    const tasks = linkedItemTypeGroup("Tasks · 6");
    await user.click(within(tasks).getByRole("button", { name: "Group Tasks" }));
    const groupDialog = screen.getByRole("dialog", { name: "Group Tasks" });
    await user.click(within(groupDialog).getByRole("button", {
      name: "Choose group property",
    }));
    await user.click(within(groupDialog).getByRole("option", { name: "Status" }));

    expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(5);
    expect(within(tasks).getByRole("rowgroup", { name: "Active group" })).toBeVisible();
    expect(within(tasks).getByRole("rowgroup", { name: "Completed group" })).toBeVisible();
    expect(within(tasks).getByRole("button", { name: "More (1) Tasks" })).toBeVisible();
  });

  it("collapses expanded linked Tasks when their active tab or draft settings change", async () => {
    const user = userEvent.setup();
    await openOverflowAreaDetail(user);

    const tasks = linkedItemTypeGroup("Tasks · 6");
    await user.click(within(tasks).getByRole("button", { name: "More (1) Tasks" }));
    expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(6);

    const taskTabs = within(tasks).getByRole("tablist", { name: "Tasks views" });
    await user.click(within(taskTabs).getByRole("button", { name: "Add Tasks view" }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(5));
    expect(within(taskTabs).getByRole("tab", { name: "새 보기" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(within(tasks).getByRole("button", { name: "More (1) Tasks" }));
    await user.click(within(tasks).getByRole("button", { name: "Sort Tasks" }));
    const sortDialog = screen.getByRole("dialog", { name: "Sort Tasks" });
    await user.selectOptions(within(sortDialog).getByLabelText("Sort field"), "title");
    await waitFor(() => expect(within(tasks).getAllByRole("button", {
      name: /^Open Task \w+ details$/,
    })).toHaveLength(5));
    expect(within(tasks).getByRole("button", { name: "More (1) Tasks" })).toBeVisible();
  });

  it("confirms before discarding a dirty detail draft to open a linked item", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => linkedAreaItemsResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Health draft");
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));

    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    await user.tab();
    expect(screen.getByRole("button", { name: "Discard changes" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Discard changes" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Health draft");

    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ __ravenDetailItemId: "project-1" }),
    );
    act(() => window.history.back());
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ __ravenDetailItemId: "area-1" }),
    );
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
  });

  it("cancels linked navigation only after browser Back restoration settles", async () => {
    const user = userEvent.setup();
    const controlledForward = controlHistoryForward();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, json: async () => linkedAreaItemsResponse(url) }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Health draft");
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await controlledForward.releaseNext();

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull(),
    );
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Health draft");
    controlledForward.spy.mockRestore();
    act(() => window.history.back());
    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" }))
      .toBeInTheDocument();
  });

  it("opens a linked detail only after browser Back restoration settles", async () => {
    const user = userEvent.setup();
    const controlledForward = controlHistoryForward();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, json: async () => linkedAreaItemsResponse(url) }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Health" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Health draft");
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));

    act(() => window.history.back());
    await waitFor(() => expect(controlledForward.spy).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    await controlledForward.releaseNext();

    expect(await screen.findByLabelText("Checkup details")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ __ravenDetailItemId: "project-1" }),
    );
    controlledForward.spy.mockRestore();
    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    act(() => window.history.back());
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
  });

  it("does not render linked items for a Task without direct children", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => taskWithoutLinkedItemsResponse(url),
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(
      await screen.findByRole("button", { name: "Open details for Book appointment" }),
    );

    expect(screen.queryByRole("region", { name: "Linked items" })).toBeNull();
  });

  it("does not transition an active goal when saving an unrelated detail field", async () => {
    const user = userEvent.setup();
    const apiStatus = "active";
    let apiNote = "Old note";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH") {
        apiNote = "Saved note";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Secondary active goal",
            status: apiStatus,
            note: apiNote,
            horizon: "month",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Secondary active goal",
            status: apiStatus,
            note: apiNote,
            horizon: "month",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(await screen.findByRole("cell", { name: "Secondary active goal" }));

    expect(screen.getByLabelText("Status for Secondary active goal")).toHaveValue("active");
    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.clear(note);
    await user.type(note, "Saved note");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/goal-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.getByLabelText("Status for Secondary active goal")).toHaveValue("active");
  });

  it("keeps detail tag clicks from triggering chip removal", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=task"
              ? [
                  {
                    id: "task-1",
                    type: "task",
                    title: "One",
                    status: "active",
                    tags: ["deep-work", "planning"],
                  },
                ]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    const tagField = screen.getByRole("button", { name: "Tags" });
    expect(tagField.closest("label")).toBeNull();
    await user.click(tagField);

    expect(screen.getByRole("button", { name: "Remove deep-work tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove planning tag" })).toBeInTheDocument();
  });

  it("keeps detail Markdown note drafts while relation edits wait for Save", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ note: "Draft detail text", area: "area-2" }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Draft detail text",
            area_id: "area-2",
            project_id: "project-1",
            routine_id: "routine-1",
          }),
        });
      }

      if (url === "/api/v1/todo/items?type=area") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "area-1", type: "area", title: "Health", status: "active" },
            { id: "area-2", type: "area", title: "Career", status: "active" },
          ],
        });
      }

      if (url === "/api/v1/todo/items?type=project") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "project-1", type: "project", title: "Plan", status: "active" },
          ],
        });
      }

      if (url === "/api/v1/todo/items?type=routine") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "routine-1", type: "routine", title: "Stretch", status: "active" },
          ],
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            area_id: "area-1",
            project_id: "project-1",
            routine_id: "routine-1",
            description: "Original description",
            note: "Original note",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    expect(screen.getByLabelText("Status for One")).toBeInTheDocument();
    expect(screen.getByLabelText("Area for One")).toBeInTheDocument();
    expect(screen.queryByText("Type")).toBeNull();
    expectFieldBefore("Status for One", "Area for One");

    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.clear(note);
    await user.type(note, "Draft detail text");
    await user.selectOptions(screen.getByLabelText("Area for One"), "area-2");

    expect(screen.getByText("Draft detail text")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/task-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    expect(fetchMock.mock.calls.find(([url]) => url === "/api/v1/todo/items/task-1")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("skips detail patch requests when save only changes status", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/complete") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "completed",
            note: "Old note",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Old note",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    await user.selectOptions(screen.getByLabelText("Status for One"), "completed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === "/api/v1/todo/items/task-1" &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );

    expect(patchCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1/complete",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === "POST")
        .map(([url]) => url),
    ).toEqual(["/api/v1/todo/items/task-1/complete"]);
  });

  it("requires a Project definition of done and includes it in creation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/projects/propose") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-new",
            type: "project",
            title: "Project title",
            status: "active",
            definition_of_done: "Done when verified",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));
    await user.click(screen.getByRole("button", { name: "Add to Projects" }));
    await user.type(screen.getByLabelText("Title"), "Project title");

    expect(screen.getByLabelText("Definition of Done")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Definition of Done"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Project requires definition_of_done",
    );
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v1/todo/projects/propose"),
    ).toBe(false);

    await user.type(screen.getByLabelText("Definition of Done"), "Done when verified");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/projects/propose",
      expect.objectContaining({
        body: JSON.stringify({
          title: "Project title",
          actor: "user",
          definition_of_done: "Done when verified",
        }),
      }),
    );
  });

  it("defaults Routine recurrence and rejects a cleared rule", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/routines/propose") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-new",
            type: "routine",
            title: "Daily review",
            status: "active",
            recurrence_rule: "RRULE:FREQ=DAILY",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await user.click(screen.getByRole("button", { name: "Add to Routines" }));
    await user.type(screen.getByLabelText("Title"), "Daily review");

    expect(screen.getByLabelText("Recurrence Rule Preview")).toHaveTextContent(
      "RRULE:FREQ=DAILY",
    );
    await user.clear(screen.getByLabelText("Every"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Routine requires recurrence_rule",
    );
    expect(screen.getByRole("dialog", { name: "Create Routines item" })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/v1/todo/routines/propose"),
    ).toBe(false);

    await user.clear(screen.getByLabelText("Every"));
    await user.type(screen.getByLabelText("Every"), "5");
    expect(screen.getByLabelText("Recurrence Rule Preview")).toHaveTextContent(
      "RRULE:FREQ=DAILY;INTERVAL=5",
    );
    fireEvent.change(screen.getByLabelText("Every"), { target: { value: "0" } });
    fireEvent.blur(screen.getByLabelText("Every"));
    expect(screen.getByLabelText("Every")).toHaveValue(1);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/routines/propose",
      expect.objectContaining({
        body: JSON.stringify({
          title: "Daily review",
          actor: "user",
          materialization_policy: "single_open",
          recurrence_rule: "RRULE:FREQ=DAILY",
        }),
      }),
    );
  });

  it("saves the visible Daily recurrence before resuming a routine without a stored rule", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const routine = {
      id: "routine-1",
      type: "routine",
      title: "Daily routine",
      status: "paused",
      recurrence_rule: null,
      materialization_policy: "per_occurrence",
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/routine-1" && init?.method === "PATCH") {
        calls.push("patch");
        expect(JSON.parse(String(init.body))).toEqual({
          recurrence_rule: "RRULE:FREQ=DAILY",
        });
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...routine, recurrence_rule: "RRULE:FREQ=DAILY" }),
        });
      }
      if (url === "/api/v1/todo/items/routine-1/resume") {
        expect(init?.method).toBe("POST");
        calls.push("resume");
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...routine,
            status: "active",
            recurrence_rule: "RRULE:FREQ=DAILY",
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => (url === "/api/v1/todo/items?type=routine" ? [routine] : []),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await user.click(await screen.findByRole("cell", { name: "Daily routine" }));
    await user.selectOptions(screen.getByLabelText("Status for Daily routine"), "active");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls).toEqual(["patch", "resume"]));
  });

  it("shows the same task fields in the table while keeping description table-only in detail", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1") {
        expect(init).toEqual(expect.objectContaining({ method: "PATCH" }));
        expect(JSON.parse(String(init?.body))).toEqual({
          note: "Updated note",
          priority: 2,
        });

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Book physio",
            status: "active",
            scheduled: "2026-07-03",
            due: "2026-07-04",
            priority: 2,
            description: "Original description",
            note: "Updated note",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-02T00:00:00Z",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "Book physio",
            status: "active",
            scheduled: "2026-07-03",
            due: "2026-07-04",
            priority: 1,
            description: "Original description",
            note: "Original note",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-02T00:00:00Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(
      await screen.findByRole("cell", { name: "Original description" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Original note" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Description for Book physio")).toBeNull();

    await user.click(screen.getByRole("cell", { name: "Book physio" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Book physio");
    expect(screen.getByLabelText("Scheduled")).toHaveValue("2026-07-03");
    expect(screen.getByLabelText("Due")).toHaveValue("2026-07-04");
    expect(screen.getByLabelText("Priority")).toHaveValue("1");
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.getByText("Original note")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(screen.getByText("2026-07-02")).toBeInTheDocument();
    expectFieldBefore("Scheduled", "Due");
    expectFieldBefore("Due", "Priority");
    expectFieldBeforeProperty("Priority", "Created");
    expectPropertyImmediatelyBeforeProperty("Created", "Updated");

    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.clear(note);
    await user.type(note, "Updated note");
    await user.selectOptions(screen.getByLabelText("Priority"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Updated note")).toBeInTheDocument();
  });

  it("shows one Markdown note last and omits description from Workspace details", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "task-1",
              type: "task",
              title: "Write release notes",
              status: "active",
              description: "Legacy description",
              note: "# Checklist\n\n- [x] Drafted",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "Write release notes" }));

    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.queryByLabelText("Note")).toBeNull();
    expect(screen.queryByText("Legacy description")).toBeNull();
    expect(screen.getByRole("heading", { name: "Checklist" })).toBeInTheDocument();

    const layout = screen.getByRole("heading", { name: "Write release notes" }).closest(".detail-layout");
    const note = screen.getByLabelText("Markdown note editor");
    expect(layout?.lastElementChild).toBe(note);
  });

  it("places the Markdown note after all detail properties", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "area-1",
              type: "area",
              title: "Finance",
              status: "active",
              review_cycle: "weekly",
              standard: "Keep accounts clean",
              note: "Monthly close",
              created_at: "2026-07-01T00:00:00Z",
              updated_at: "2026-07-02T00:00:00Z",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("cell", { name: "Finance" }));

    expectFieldBeforeProperty("Standard", "Created");
    expectPropertyImmediatelyBeforeProperty("Created", "Updated");
    expect(screen.getByText("Monthly close")).toBeInTheDocument();
    const layout = screen.getByRole("heading", { name: "Finance" }).closest(".detail-layout");
    const note = screen.getByLabelText("Markdown note editor");
    expect(layout?.lastElementChild).toBe(note);
  });

  it("selects task priority from a detail dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ priority: 10 });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            priority: 10,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active", priority: 1 },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    const priority = screen.getByLabelText("Priority");
    expect(priority.tagName).toBe("SELECT");
    expect(within(priority).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "-",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    await user.selectOptions(priority, "10");
    expect(priority).toHaveValue("10");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows the same goal fields in the table and detail", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "June outcome",
            status: "active",
            horizon: "month",
            scheduled: "2026-06-01",
            parent_id: "goal-root",
            note: "Ship the monthly target",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-02T00:00:00Z",
          },
          {
            id: "goal-root",
            type: "goal",
            title: "Root objective",
            status: "active",
            horizon: "year",
            scheduled: "2026-01-01",
            note: "",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        ],
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    expect(screen.getByRole("button", { name: "Period for June outcome" })).toHaveTextContent(
      "Month",
    );
    expect(screen.queryByRole("dialog", { name: "Period for June outcome" })).toBeNull();
    expect(screen.queryByLabelText("Due for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Horizon for June outcome")).toBeNull();
    expect(screen.queryByLabelText("Scheduled for June outcome")).toBeNull();
    expect(screen.getAllByRole("cell", { name: "Root objective" })).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "Ship the monthly target" })).toBeInTheDocument();

    await user.click(screen.getByRole("cell", { name: "June outcome" }));

    expect(screen.getByRole("button", { name: "Period" })).toHaveTextContent("Month");
    const periodRow = screen.getByRole("button", { name: "Period" }).closest(".field-label");
    expect(periodRow).not.toBeNull();
    if (!periodRow) {
      throw new Error("Missing Period field row");
    }
    expect(periodRow.querySelector(".goal-period-control")).not.toBeNull();
    expect(periodRow.nextElementSibling).toBe(fieldRow("Parent"));
    expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
    expect(screen.queryByLabelText("Due")).toBeNull();
    expect(screen.queryByLabelText("Horizon")).toBeNull();
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    expect(screen.getByLabelText("Parent")).toHaveValue("goal-root");
    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    expect(screen.getByRole("textbox", { name: "Markdown note line 1" })).toHaveValue(
      "Ship the monthly target",
    );
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
    expect(screen.getByText("2026-06-02")).toBeInTheDocument();

    const detailTrigger = screen.getByRole("button", { name: "Period" });
    await user.click(detailTrigger);
    const detailPicker = screen.getByRole("dialog", { name: "Period" });
    await user.click(within(detailPicker).getByRole("button", { name: "Week" }));
    await user.click(within(detailPicker).getByRole("button", { name: /June 10, 2026/ }));

    expect(detailTrigger).toHaveTextContent("Week · 2026-06-08 to 2026-06-14");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(detailTrigger).toHaveTextContent("Month · June 2026");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(detailTrigger).toHaveTextContent("Week · 2026-06-08 to 2026-06-14");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(patchCalls(fetchMock)).toHaveLength(0);
  });

  it("patches a goal period through the inline calendar with an ISO week anchor", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/goal-1") && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "week", scheduled: "2026-07-06" }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "week",
            scheduled: "2026-07-06",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Week" }));

    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).includes("/items/goal-1") && init?.method === "PATCH",
      ),
    ).toHaveLength(0);

    await user.click(within(picker).getByRole("button", { name: /July 10, 2026/ }));
    expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "Goal" })).not.toBeInTheDocument();
  });

  it("previews and selects goal weeks as a full calendar row", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Goal",
              status: "active",
              horizon: "week",
              scheduled: "2026-07-06",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const july17 = within(picker).getByRole("button", { name: /July 17, 2026/ });

    const selectedDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(selectedDays.map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);

    fireEvent.mouseEnter(july17);

    const stillSelectedDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(stillSelectedDays.map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);

    const previewDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-preview"),
      );
    expect(previewDays.map((button) => button.textContent)).toEqual([
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
    ]);
    expect(previewDays[0]).toHaveClass("goal-period-calendar-day-range-start");
    expect(previewDays[6]).toHaveClass("goal-period-calendar-day-range-end");

    fireEvent.mouseLeave(july17);
    expect(
      within(picker)
        .getAllByRole("button")
        .filter((button) =>
          button.classList.contains("goal-period-calendar-day-preview"),
        ),
    ).toHaveLength(0);
  });

  it("selects a goal month from a year-scoped month grid", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "month", scheduled: "2027-03-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "month",
            scheduled: "2027-03-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });

    expect(within(picker).getByText("2026")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "June 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(picker).queryByRole("button", { name: /June 10, 2026/ })).toBeNull();

    await user.click(within(picker).getByRole("button", { name: "Next year" }));
    expect(within(picker).getByText("2027")).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "March 2027" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("returns the month picker to this year without committing a period", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const currentYear = new Date().getFullYear();
    const scheduledYear = 2026;
    const navigatingBack = scheduledYear > currentYear;
    const navigationLabel = navigatingBack ? "Previous year" : "Next year";
    const navigatedYear = navigatingBack ? scheduledYear - 1 : scheduledYear + 1;

    await user.click(within(picker).getByRole("button", { name: navigationLabel }));
    expect(within(picker).getByText(String(navigatedYear))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This year" })).toBeEnabled();

    await user.click(within(picker).getByRole("button", { name: "This year" }));

    expect(within(picker).getByText(String(currentYear))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This year" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Period for Goal" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the week calendar to this month without committing a period", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "week",
            scheduled: "2026-07-06",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const currentMonthStart = testMonthStart(testToday());
    const scheduledMonthStart = "2026-07-01";
    const navigatingBack = scheduledMonthStart > currentMonthStart;
    const navigationLabel = navigatingBack ? "Previous month" : "Next month";
    const navigatedMonthStart = navigatingBack
      ? testPreviousMonthStart(scheduledMonthStart)
      : testNextMonthStart(scheduledMonthStart);

    await user.click(within(picker).getByRole("button", { name: navigationLabel }));
    expect(
      within(picker).getByText(monthLabelForDate(new Date(`${navigatedMonthStart}T00:00:00`))),
    ).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This month" })).toBeEnabled();

    await user.click(within(picker).getByRole("button", { name: "This month" }));

    expect(within(picker).getByText(monthLabelForDate(new Date()))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This month" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Period for Goal" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a fixed viewport popover, repositions on scroll, and restores focus on escape", async () => {
    const user = userEvent.setup();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Goal",
              status: "active",
              horizon: "month",
              scheduled: "2026-06-01",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    await user.click(trigger);

    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await waitFor(() =>
      expect(within(picker).getByRole("button", { name: "Month" })).toHaveFocus(),
    );
    expect(picker).toHaveStyle({
      position: "fixed",
      overflowY: "auto",
    });
    expect(picker.style.maxHeight).not.toBe("");
    expect(document.body).toContainElement(picker);
    expect(screen.getByLabelText("Goals items")).not.toContainElement(picker);
    expect(
      addEventListenerSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);
    expect(
      addEventListenerSpy.mock.calls.some(
        ([type, _listener, options]) => type === "scroll" && options === true,
      ),
    ).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      removeEventListenerSpy.mock.calls.some(([type]) => type === "resize"),
    ).toBe(true);
    expect(
      removeEventListenerSpy.mock.calls.some(
        ([type, _listener, options]) => type === "scroll" && options === true,
      ),
    ).toBe(true);
  });

  it("commits a same-year month goal to year exactly once and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2026-01-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "year",
            scheduled: "2026-01-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });

    await user.click(within(picker).getByRole("button", { name: "Year" }));
    await user.selectOptions(within(picker).getByLabelText("Goal year"), "2026");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull());
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH",
      ),
    ).toHaveLength(1);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent("Year");
  });

  it("commits a goal year through a scrollable year dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2040-01-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "year",
            scheduled: "2040-01-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Year" }));

    const yearSelect = within(picker).getByLabelText("Goal year");
    expect(yearSelect.tagName).toBe("SELECT");
    const currentYear = new Date().getFullYear();
    expect(
      within(yearSelect).getByRole("option", { name: String(currentYear - 50) }),
    ).toBeInTheDocument();
    expect(
      within(yearSelect).getByRole("option", { name: String(currentYear + 50) }),
    ).toBeInTheDocument();

    await user.selectOptions(yearSelect, "2040");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("includes an out-of-range stored goal year in the dropdown", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Long Goal",
              status: "active",
              horizon: "year",
              scheduled: "2120-01-01",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Long Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Long Goal" });
    const yearSelect = within(picker).getByLabelText("Goal year");

    expect(within(yearSelect).getByRole("option", { name: "2120" })).toBeInTheDocument();
    expect(yearSelect).toHaveValue("2120");
  });

  it("shows a parent horizon error when an inline goal period change is rejected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2026-01-01" }),
        );

        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "validation_error",
            message: "Request validation failed.",
            fields: {},
            request_id: "00000000-0000-4000-8000-000000000001",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "week",
            scheduled: "2026-07-06",
            parent_id: "goal-parent",
          },
          {
            id: "goal-parent",
            type: "goal",
            title: "Parent Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-07-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    expect(trigger).toHaveTextContent("Week");

    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Year" }));
    await user.selectOptions(within(picker).getByLabelText("Goal year"), "2026");

    expect(
      await screen.findByRole("dialog", { name: "Year로 변경할 수 없음" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 Parent 기간은 Month이고, 요청한 Goal 기간은 Year입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(trigger).toHaveTextContent("Week");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("uses the loaded parent horizon when normalized validation metadata is absent", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "month", scheduled: "2026-07-01" }),
        );

        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "validation_error",
            message: "Request validation failed.",
            fields: { horizon: ["invalid"] },
            request_id: "00000000-0000-4000-8000-000000000002",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "active",
            horizon: "week",
            scheduled: "2026-07-06",
            parent_id: "goal-parent",
          },
          {
            id: "goal-parent",
            type: "goal",
            title: "Parent Goal",
            status: "active",
            horizon: "month",
            scheduled: "2026-07-01",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    const trigger = await screen.findByRole("button", { name: "Period for Goal" });
    expect(trigger).toHaveTextContent("Week");

    await user.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Month" }));
    await user.click(within(picker).getByRole("button", { name: "July 2026" }));

    expect(
      await screen.findByRole("dialog", { name: "Month로 변경할 수 없음" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "현재 Parent 기간은 Month이고, 요청한 Goal 기간은 Month입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(trigger).toHaveTextContent("Week");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("saves project detail definition of done through the item PATCH endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/project-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ definition_of_done: "Ship review fixes" }));

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-1",
            type: "project",
            title: "Plan",
            status: "active",
            definition_of_done: "Ship review fixes",
            due: "2026-06-30",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=project"
            ? [
                {
                  id: "project-1",
                  type: "project",
                  title: "Plan",
                  status: "active",
                  definition_of_done: "Old DoD",
                  due: "2026-06-30",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    await user.click(await screen.findByRole("cell", { name: "Plan" }));
    await user.clear(screen.getByLabelText("Definition of Done"));
    await user.type(screen.getByLabelText("Definition of Done"), "Ship review fixes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/project-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("saves routine detail recurrence rule through the item PATCH endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/routine-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({
            recurrence_rule: "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-1",
            type: "routine",
            title: "Stretch",
            status: "active",
            recurrence_rule: "weekly",
            materialization_policy: "single_open",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=routine"
            ? [
                {
                  id: "routine-1",
                  type: "routine",
                  title: "Stretch",
                  status: "active",
                  recurrence_rule: "daily",
                  materialization_policy: "single_open",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));

    await user.click(await screen.findByRole("cell", { name: "Stretch" }));
    expect(screen.queryByLabelText("Recurrence Rule")).toBeNull();
    expect(screen.getByText("Recurrence Rule").closest(".recurrence-row")).not.toBeNull();
    expect(screen.getByLabelText("Every").closest(".recurrence-field")).not.toBeNull();
    expect(screen.getByLabelText("Recurrence Rule Preview").closest(".recurrence-preview")).not.toBeNull();
    await user.clear(screen.getByLabelText("Every"));
    await user.type(screen.getByLabelText("Every"), "2");
    await user.selectOptions(screen.getByLabelText("Frequency"), "weekly");
    await user.click(screen.getByLabelText("Monday"));
    await user.click(screen.getByLabelText("Wednesday"));
    await user.click(screen.getByLabelText("Friday"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/routine-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows and saves routine task template fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/routine-1" && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          project_id: "project-2",
          priority: 3,
        });

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-1",
            type: "routine",
            title: "물 마시기",
            status: "active",
            project_id: "project-2",
            description: "500ml를 마신다",
            priority: 3,
            recurrence_rule: "daily",
            materialization_policy: "single_open",
            tags: ["health"],
            note: "오후에도 반복",
          }),
        });
      }

      if (url === "/api/v1/todo/items?type=project") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: "project-1", type: "project", title: "건강", status: "active" },
            { id: "project-2", type: "project", title: "생활", status: "active" },
          ],
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=routine"
            ? [
                {
                  id: "routine-1",
                  type: "routine",
                  title: "물 마시기",
                  status: "active",
                  project_id: "project-1",
                  description: "500ml를 마신다",
                  priority: 2,
                  recurrence_rule: "daily",
                  materialization_policy: "single_open",
                  tags: ["health"],
                  note: "오후에도 반복",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await screen.findByRole("option", { name: "건강" });
    expect(screen.getByLabelText("Project for 물 마시기")).toHaveValue("project-1");
    expect(screen.getByLabelText("Priority for 물 마시기")).toHaveValue("2");
    expect(screen.getByRole("cell", { name: "500ml를 마신다" })).toBeInTheDocument();

    await user.click(screen.getByRole("cell", { name: "물 마시기" }));

    expect(screen.getByRole("button", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByText("오후에도 반복")).toBeInTheDocument();
    expect(screen.getByLabelText("Project for 물 마시기")).toHaveValue("project-1");
    expect(screen.getByLabelText("Priority")).toHaveValue("2");
    expect(screen.queryByLabelText("Description")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Project for 물 마시기"), "project-2");
    await user.selectOptions(screen.getByLabelText("Priority"), "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/todo/items/routine-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("opens legacy weekly recurrence without sending an unchanged recurrence rule patch", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/routine-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ note: "Keep this stretch" }));
        expect(String(init.body)).not.toContain("description");

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "routine-1",
            type: "routine",
            title: "Stretch",
            status: "active",
            recurrence_rule: "every 2 weeks on monday",
            materialization_policy: "single_open",
            note: "Keep this stretch",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=routine"
            ? [
                {
                  id: "routine-1",
                  type: "routine",
                  title: "Stretch",
                  status: "active",
                  recurrence_rule: "every 2 weeks on monday",
                  materialization_policy: "single_open",
                  note: "",
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));

    await user.click(await screen.findByRole("cell", { name: "Stretch" }));

    expect(screen.getByLabelText("Every")).toHaveValue(2);
    expect(screen.getByLabelText("Frequency")).toHaveValue("weekly");
    expect(screen.getByLabelText("Monday")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    await user.type(
      screen.getByRole("textbox", { name: "Markdown note line 1" }),
      "Keep this stretch",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/routine-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it.each([
    ["월-금", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]],
    ["평일", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]],
    ["월수금", ["Monday", "Wednesday", "Friday"]],
  ])("opens Korean legacy recurrence %s as weekly weekdays", async (rule, checkedDays) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "routine-1",
          type: "routine",
          title: "Stretch",
          status: "active",
          recurrence_rule: rule,
          materialization_policy: "single_open",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));

    await user.click(await screen.findByRole("cell", { name: "Stretch" }));

    expect(screen.getByLabelText("Frequency")).toHaveValue("weekly");
    for (const day of checkedDays) {
      expect(screen.getByLabelText(day)).toBeChecked();
    }
  });

  it("shows routine last materialized in detail as readonly", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "routine-1",
            type: "routine",
            title: "Stretch",
            status: "active",
            recurrence_rule: "daily",
            materialization_policy: "single_open",
            note: "After coffee",
            last_materialized_at: "2026-06-21T07:00:00Z",
            created_at: "2026-06-20T00:00:00Z",
            updated_at: "2026-06-22T00:00:00Z",
          },
        ],
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await user.click(await screen.findByRole("cell", { name: "Stretch" }));

    const properties = screen.getByText("Properties").closest(".detail-properties");
    expect(within(properties as HTMLElement).getByText("Last Materialized")).toBeInTheDocument();
    expect(within(properties as HTMLElement).getByText("2026-06-21")).toBeInTheDocument();
    expect(screen.queryByLabelText("Last Materialized")).toBeNull();
    expectPropertyImmediatelyBeforeProperty("Updated", "Last Materialized");
    expect(screen.getByText("After coffee")).toBeInTheDocument();
    const layout = screen.getByRole("heading", { name: "Stretch" }).closest(".detail-layout");
    const note = screen.getByLabelText("Markdown note editor");
    expect(layout?.lastElementChild).toBe(note);
  });

  it("omits unchanged event participants from the detail PATCH body", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/event-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ priority: 2, location: "Office" }));

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "active",
            scheduled: "2026-06-24T10:00:00Z",
            due: "2026-06-24",
            priority: 2,
            metadata_: {
              location: "Office",
              participants: ["Me", "Team"],
              commitment_type: "busy",
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=event"
            ? [
                {
                  id: "event-1",
                  type: "event",
                  title: "Review",
                  status: "active",
                  scheduled: "2026-06-24T10:00:00Z",
                  due: "2026-06-24",
                  priority: 1,
                  metadata_: {
                    location: "Desk",
                    participants: ["Me", "Team"],
                    commitment_type: "busy",
                  },
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));

    await user.click(await screen.findByRole("cell", { name: "Review" }));
    expectFieldBeforeProperty("Commitment Type", "Created");
    expectPropertyImmediatelyBeforeProperty("Created", "Updated");
    const layout = screen.getByRole("heading", { name: "Review" }).closest(".detail-layout");
    const note = screen.getByLabelText("Markdown note editor");
    expect(layout?.lastElementChild).toBe(note);
    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "Office");
    await user.selectOptions(screen.getByLabelText("Priority"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows only active status choices and priority controls", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=event"
              ? [
                  {
                    id: "event-1",
                    type: "event",
                    title: "Review",
                    status: "active",
                    priority: 4,
                  },
                ]
              : [
                  {
                    id: "task-1",
                    type: "task",
                    title: "One",
                    status: "active",
                    priority: 5,
                  },
                ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(await statusOptions("One")).toEqual(["active", "completed"]);
    const inlinePriority = screen.getByLabelText("Priority for One");
    expect(inlinePriority.tagName).toBe("SELECT");
    expect(within(inlinePriority).getByRole("option", { name: "10" })).toBeInTheDocument();

    await user.click(screen.getByRole("cell", { name: "One" }));
    const detailPriority = screen.getByLabelText("Priority");
    expect(detailPriority.tagName).toBe("SELECT");
    expect(within(detailPriority).getByRole("option", { name: "10" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "< Back" }));

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(await statusOptions("Review")).toEqual(["active", "paused", "completed"]);
  });

  it("renders the exact stored status without an alias", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=goal"
              ? [{ id: "goal-1", type: "goal", title: "Waiting goal", status: "waiting" }]
              : [],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    expect(await screen.findByLabelText("Status for Waiting goal")).toHaveValue("waiting");
  });

  it("lets project and parent selects choose none while area remains required", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => {
            if (url === "/api/v1/todo/items?type=area") {
              return [{ id: "area-1", type: "area", title: "Health", status: "active" }];
            }
            if (url === "/api/v1/todo/items?type=project") {
              return [{ id: "project-1", type: "project", title: "Plan", status: "active" }];
            }
            if (url === "/api/v1/todo/items?type=goal") {
              return [{ id: "goal-1", type: "goal", title: "Goal", status: "active" }];
            }
            return [{ id: "task-1", type: "task", title: "One", status: "active", area_id: "area-1" }];
          },
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    expect(within(screen.getByLabelText("Project for One")).getByRole("option", { name: "None" })).toBeEnabled();
    expect(within(screen.getByLabelText("Area for One")).getByRole("option", { name: "-" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));
    await user.click(await screen.findByRole("cell", { name: "Goal" }));
    expect(within(screen.getByLabelText("Parent for Goal")).getByRole("option", { name: "None" })).toBeEnabled();
    expect(within(screen.getByLabelText("Parent for Goal")).getByRole("option", { name: "Goal" })).toHaveValue("goal-1");
  });

  it("opens a detail view from the keyboard", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const row = screen.getByRole("button", { name: "Open details for One" });
    row.focus();
    expect(row).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    const reopenedRow = screen.getByRole("button", { name: "Open details for One" });
    reopenedRow.focus();

    await user.keyboard("{Space}");
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
  });

  it("keeps detail navigation and saving in the page header outside the editor", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "active" },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("cell", { name: "One" }));

    const header = screen.getByRole("button", { name: "< Back" }).closest(".detail-header");
    const editor = screen.getByRole("region", { name: "Edit properties" });

    expect(header).toContainElement(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "title",
      "Save (Ctrl/Cmd+S)",
    );
    expect(header).not.toContainElement(editor);
    expect(editor.closest(".detail-layout")).not.toBeNull();
  });

  it("archives an active task from detail and returns to the unchanged Tasks table", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/archive" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Canonical One",
            status: "archived",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));

    const header = screen.getByRole("button", { name: "< Back" }).closest(".detail-header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getAllByRole("button").map((button) =>
      button.getAttribute("aria-label")
    )).toEqual(["< Back", "Undo", "Redo", "Save", "Archive"]);

    const archiveButton = screen.getByRole("button", { name: "Archive" });
    await user.click(archiveButton);
    const dialog = screen.getByRole("dialog", { name: "Archive One?" });
    expect(within(dialog).getByText("Move this item to Archive?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    const tasksTable = await screen.findByRole("table", { name: "Tasks items" });
    expect(within(tasksTable).queryByRole("button", {
      name: /^Open details for /,
    })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
    expect(window.history.state).toMatchObject({ __ravenDetailItemId: null });
  });

  it("does not offer Archive when an archived item is initially rendered in detail", () => {
    const hook = renderHook(() => useWorkbenchController());
    act(() => hook.result.current.openDetailView({
      id: "area-archived",
      type: "area",
      title: "Archived area",
      status: "archived",
    }));

    render(<MainPanel controller={hook.result.current} />);

    expect(screen.getByLabelText("Archived area details")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("protects a dirty detail draft while its Archive confirmation is open", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "Workspace Task", status: "active" },
      ],
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", {
      name: "Open details for Workspace Task",
    }));
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Dirty Workspace Task");

    const archiveButton = screen.getByRole("button", { name: "Archive" });
    await user.click(archiveButton);
    const dialog = screen.getByRole("dialog", { name: "Archive Workspace Task?" });
    expect(within(dialog).getByText(
      "Move this item to Archive? Unsaved changes will be discarded.",
    )).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document, { key: "z", metaKey: true });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(title).toHaveValue("Dirty Workspace Task");
    expect(patchCalls(fetchMock)).toHaveLength(0);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Archive Workspace Task?",
    })).toBeNull());
    expect(title).toHaveValue("Dirty Workspace Task");
    await waitFor(() => expect(archiveButton).toHaveFocus());
  });

  it("keeps Archive unavailable while a dirty detail save is in flight", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        return patchResponse;
      }
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "Workspace Task", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", {
      name: "Open details for Workspace Task",
    }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Saved Workspace Task");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const archiveButton = screen.getByRole("button", { name: "Archive" });
    expect(archiveButton).toBeDisabled();
    fireEvent.click(archiveButton);
    expect(fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith("/archive") && init?.method === "POST",
    )).toHaveLength(0);

    await act(async () => resolvePatch({
      ok: true,
      json: async () => ({
        id: "task-1",
        type: "task",
        title: "Saved Workspace Task",
        status: "active",
      }),
    } as Response));
    await waitFor(() => expect(archiveButton).toBeEnabled());
  });

  it("locks a failed dirty-detail Archive request and retries with only safe errors", async () => {
    const user = userEvent.setup();
    let resolveFirstArchive!: (value: Response) => void;
    const firstArchiveResponse = new Promise<Response>((resolve) => {
      resolveFirstArchive = resolve;
    });
    let archiveAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/archive" && init?.method === "POST") {
        archiveAttempts += 1;
        if (archiveAttempts === 1) return firstArchiveResponse;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Workspace Task",
            status: "archived",
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "Workspace Task", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", {
      name: "Open details for Workspace Task",
    }));
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Unsaved Workspace Task");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("dialog", { name: "Archive Workspace Task?" });
    const confirm = within(dialog).getByRole("button", { name: "Archive" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(archiveAttempts).toBe(1);
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Save", hidden: true })).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(title).toHaveValue("Unsaved Workspace Task");

    await act(async () => resolveFirstArchive({
      ok: false,
      status: 500,
      json: async () => ({
        code: "internal_error",
        message: "Archive is blocked by a related item.",
        fields: { sql: ["private statement"] },
        request_id: "00000000-0000-4000-8000-000000000011",
      }),
    } as Response));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Archive is blocked by a related item.");
    expect(dialog).toHaveAttribute("aria-busy", "false");
    expect(confirm).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("button", { name: "Save", hidden: true })).toBeEnabled();
    expect(title).toHaveValue("Unsaved Workspace Task");
    expect(dialog).not.toHaveTextContent("internal_error");
    expect(dialog).not.toHaveTextContent("private statement");
    expect(dialog).not.toHaveTextContent("00000000-0000-4000-8000-000000000011");

    await user.click(confirm);
    expect(archiveAttempts).toBe(2);
    const tasksTable = await screen.findByRole("table", { name: "Tasks items" });
    expect(within(tasksTable).queryByRole("button", {
      name: "Open details for Workspace Task",
    })).toBeNull();
  });

  it("returns an archived Planner detail to the same Daily date and view settings", async () => {
    const user = userEvent.setup();
    const scheduled = testAddDays(testToday(), 1);
    const task = {
      id: "planner-task",
      type: "task",
      title: "Planner Task",
      status: "active",
      scheduled,
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/planner-task/archive" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...task, status: "archived" }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items?type=task" ? [task] : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(screen.getByRole("button", { name: "Next day" }));
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    const filterDialog = screen.getByRole("dialog", { name: "Filter Today" });
    await user.click(within(filterDialog).getByRole("button", { name: "Add filter rule" }));
    await user.click(within(filterDialog).getByRole("option", { name: "Title" }));
    await user.type(within(filterDialog).getByLabelText("Filter value"), "Planner");
    fireEvent.mouseDown(screen.getByRole("tablist", { name: "Today views" }));
    await user.click(await screen.findByRole("button", { name: "Planner Task" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(within(
      screen.getByRole("dialog", { name: "Archive Planner Task?" }),
    ).getByRole("button", { name: "Archive" }));

    expect(await screen.findByLabelText("Daily planner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("button", { name: "Choose Daily date" })).toHaveTextContent(
      testLongDateLabel(scheduled),
    );
    expect(screen.getByLabelText("Active planner controls")).toHaveTextContent("1 rules");
    await user.click(screen.getByRole("button", { name: "Filter Today" }));
    const restoredFilterDialog = screen.getByRole("dialog", { name: "Filter Today" });
    expect(within(restoredFilterDialog).getByLabelText("Filter field")).toHaveValue("title");
    expect(within(restoredFilterDialog).getByLabelText("Filter value")).toHaveValue(
      "Planner",
    );
    fireEvent.mouseDown(screen.getByRole("tablist", { name: "Today views" }));
    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Filter Today",
    })).toBeNull());
    expect(screen.queryByRole("button", { name: "Planner Task" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Tasks items" })).toBeNull();
  });

  it("returns an archived linked project directly to its Areas list origin", async () => {
    const user = userEvent.setup();
    const area = { id: "area-1", type: "area", title: "Health", status: "active" };
    const project = {
      id: "project-1",
      type: "project",
      title: "Checkup",
      status: "active",
      area_id: "area-1",
    };
    const task = {
      id: "task-1",
      type: "task",
      title: "Book appointment",
      status: "active",
      area_id: "area-1",
    };
    let projectArchived = false;
    let archivePosts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/project-1/archive" && init?.method === "POST") {
        archivePosts += 1;
        return Promise.resolve({
          ok: true,
          json: async () => {
            projectArchived = true;
            return { ...project, status: "archived" };
          },
        } as Response);
      }

      let response: typeof area[] | Array<typeof area | typeof project | typeof task> = [];
      if (url === "/api/v1/todo/items?type=project") {
        response = projectArchived ? [] : [project];
      } else if (url === "/api/v1/todo/items?type=area") {
        response = [area];
      } else if (url === "/api/v1/todo/items") {
        response = projectArchived ? [area, task] : [area, project, task];
      }

      return Promise.resolve({
        ok: true,
        json: async () => response,
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("button", {
      name: "Open details for Checkup",
    })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Areas" }));
    const initialAreasTable = await screen.findByRole("table", { name: "Areas items" });
    await user.click(within(initialAreasTable).getByRole("button", {
      name: "Open details for Health",
    }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(within(
      screen.getByRole("dialog", { name: "Archive Checkup?" }),
    ).getByRole("button", { name: "Archive" }));

    const areasTable = await screen.findByRole("table", { name: "Areas items" });
    expect(archivePosts).toBe(1);
    expect(within(areasTable).getByRole("button", {
      name: "Open details for Health",
    })).toBeInTheDocument();
    expect(screen.queryByLabelText("Health details")).toBeNull();
    expect(screen.queryByLabelText("Checkup details")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open details for Checkup" })).toBeNull();
    expect(window.history.state).toMatchObject({ __ravenDetailItemId: null });

    await user.click(within(areasTable).getByRole("button", {
      name: "Open details for Health",
    }));
    expect(screen.getByRole("region", { name: "Linked items" })).not.toHaveTextContent(
      "Checkup",
    );
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));
    const projectsTable = await screen.findByRole("table", { name: "Projects items" });
    expect(within(projectsTable).queryByRole("button", {
      name: "Open details for Checkup",
    })).toBeNull();
  });

  it("supports detail save undo and redo keyboard conventions", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Canonical title",
            status: "active",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Renamed");

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(title).toHaveValue("One");
    fireEvent.keyDown(document, { key: "z", ctrlKey: true, shiftKey: true });
    expect(title).toHaveValue("Renamed");
    fireEvent.keyDown(document, { key: "z", metaKey: true });
    expect(title).toHaveValue("One");
    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    expect(title).toHaveValue("Renamed");
    fireEvent.keyDown(document, { key: "s", metaKey: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed" }),
      }),
    ));
    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Canonical title");
      expect(screen.getByRole("heading", { name: "Canonical title" })).toBeInTheDocument();
    });
  });

  it("keeps undo history after saving without undoing the server", async () => {
    const user = userEvent.setup();
    let canonicalResponseRead = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => {
            canonicalResponseRead = true;
            return {
              id: "task-1",
              type: "task",
              title: "Saved title",
              status: "active",
            };
          },
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));

    const title = screen.getByLabelText("Title");
    const save = screen.getByRole("button", { name: "Save" });
    await user.clear(title);
    await user.type(title, "Saved title");
    await user.click(save);

    await waitFor(() => {
      expect(canonicalResponseRead).toBe(true);
      expect(title).toHaveValue("Saved title");
      expect(save).toBeDisabled();
      expect(patchCalls(fetchMock)).toHaveLength(1);
    });

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(title).toHaveValue("One");
    expect(save).toBeEnabled();
    expect(patchCalls(fetchMock)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(title).toHaveValue("Saved title");
    expect(save).toBeDisabled();
    expect(patchCalls(fetchMock)).toHaveLength(1);
  });

  it("ignores detail history shortcuts during confirmation and IME composition", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "active" },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Draft title");
    await user.click(screen.getByRole("button", { name: "< Back" }));

    const dialog = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(title).toHaveValue("Draft title");
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "z", ctrlKey: true, isComposing: true });
    expect(title).toHaveValue("Draft title");

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(title).toHaveValue("One");
  });

  it("resets detail history when another item opens", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "active" },
            { id: "task-2", type: "task", title: "Two", status: "active" },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Abandoned draft");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    await screen.findByRole("table", { name: "Tasks items" });
    await user.click(screen.getByRole("button", { name: "Open details for Two" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "< Back" }));
    await screen.findByRole("table", { name: "Tasks items" });
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    expect(screen.getByLabelText("Title")).toHaveValue("One");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("uses the shared detail shortcuts for an item opened from Planner", async () => {
    const user = userEvent.setup();
    const task = {
      id: "task-detail",
      type: "task",
      title: "Detail task",
      status: "active",
      scheduled: testToday(),
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-detail" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...task, title: "Planner edit" }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items?type=task"
            ? [task]
            : [],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await user.click(await screen.findByRole("button", { name: "Detail task" }));

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Planner edit");
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(title).toHaveValue("Detail task");

    await user.clear(title);
    await user.type(title, "Planner edit");
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    await waitFor(() => expect(patchCalls(fetchMock)).toHaveLength(1));
    expect(patchCalls(fetchMock)[0]?.[0]).toBe("/api/v1/todo/items/task-detail");
    expect(patchCalls(fetchMock)[0]?.[1]).toEqual(expect.objectContaining({
      body: JSON.stringify({ title: "Planner edit" }),
    }));
  });

  it("prevents duplicate detail saves while a request is pending", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        return patchResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Renamed");

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true, repeat: true });

    expect(fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/v1/todo/items/task-1" && init?.method === "PATCH",
    )).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    resolvePatch({
      ok: true,
      json: async () => ({
        id: "task-1",
        type: "task",
        title: "Canonical title",
        status: "active",
      }),
    } as Response);

    expect(await screen.findByRole("heading", { name: "Canonical title" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Canonical title");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps detail draft history after a failed save", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({
            code: "internal_error",
            message: "Could not save detail.",
            fields: {},
            request_id: "00000000-0000-4000-8000-000000000007",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Renamed");

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save detail.");
    expect(screen.getByLabelText("Title")).toHaveValue("Renamed");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps the submitted draft and history when a patched status transition fails", async () => {
    const user = userEvent.setup();
    const requestUrls: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        requestUrls.push(url);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Canonical title",
            status: "active",
          }),
        } as Response);
      }

      if (url === "/api/v1/todo/items/task-1/complete" && init?.method === "POST") {
        requestUrls.push(url);
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            code: "conflict",
            message: "Could not complete item.",
            fields: {},
            request_id: "00000000-0000-4000-8000-000000000008",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Renamed");
    await user.selectOptions(screen.getByLabelText("Status for One"), "completed");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not complete item.");
    expect(requestUrls).toEqual([
      "/api/v1/todo/items/task-1",
      "/api/v1/todo/items/task-1/complete",
    ]);
    expect(screen.getByLabelText("Title")).toHaveValue("Renamed");
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("completed");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Renamed");
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("active");
  });

  it("ignores a late detail save success after discarding and opening another item", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1" && init?.method === "PATCH") {
        return patchResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Late Health title");
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Local Checkup draft");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Checkup");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Local Checkup draft");

    await act(async () => {
      resolvePatch({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical late Health title",
          status: "active",
        }),
      } as Response);
      await patchResponse;
    });

    expect(patchCalls(fetchMock)).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Local Checkup draft");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Checkup");
  });

  it("ignores a late detail save failure after discarding and opening another item", async () => {
    const user = userEvent.setup();
    let rejectPatch!: (reason: Error) => void;
    const patchResponse = new Promise<Response>((_resolve, reject) => {
      rejectPatch = reject;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1" && init?.method === "PATCH") {
        return patchResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Late Health title");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Local Checkup draft");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Checkup");
    await user.click(screen.getByRole("button", { name: "Redo" }));

    await act(async () => {
      rejectPatch(new Error("late failure"));
      await patchResponse.catch(() => undefined);
    });

    await waitFor(() => expect(patchCalls(fetchMock)).toHaveLength(1));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Local Checkup draft");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("rejects a late save completion from an older visit to the same detail item", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1" && init?.method === "PATCH") {
        return patchResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Old delayed draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();

    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Newer Health draft");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Health");
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Newer Health draft");

    await act(async () => {
      resolvePatch({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical old save",
          status: "active",
        }),
      } as Response);
      await patchResponse;
    });

    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Newer Health draft");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Health");
  });

  it("rejects a late status transition from an older visit to the same detail item", async () => {
    const user = userEvent.setup();
    let resolveTransition!: (value: Response) => void;
    const transitionResponse = new Promise<Response>((resolve) => {
      resolveTransition = resolve;
    });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        return transitionResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/area-1/archive",
      expect.objectContaining({ method: "POST" }),
    ));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();

    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Newer Health draft");

    await act(async () => {
      resolveTransition({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Health",
          status: "archived",
        }),
      } as Response);
      await transitionResponse;
    });

    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Newer Health draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("blocks keyboard detail saves while an older item transition is pending", async () => {
    const user = userEvent.setup();
    let resolveOldTransition!: (value: Response) => void;
    const oldTransitionResponse = new Promise<Response>((resolve) => {
      resolveOldTransition = resolve;
    });
    let transitionAttempts = 0;
    let patchAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1" && init?.method === "PATCH") {
        patchAttempts += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Newer Health draft",
            status: "active",
          }),
        } as Response);
      }
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        transitionAttempts += 1;
        if (transitionAttempts === 1) return oldTransitionResponse;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Newer Health draft",
            status: "archived",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(transitionAttempts).toBe(1);
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Newer Health draft");
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    await act(async () => Promise.resolve());

    expect(patchAttempts).toBe(0);
    expect(transitionAttempts).toBe(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await act(async () => {
      resolveOldTransition({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Health",
          status: "archived",
        }),
      } as Response);
      await oldTransitionResponse;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    await waitFor(() => expect(patchAttempts).toBe(1));
    await waitFor(() => expect(transitionAttempts).toBe(2));
  });

  it("starts a new same-action transition after reopening the same detail item", async () => {
    const user = userEvent.setup();
    let resolveOldTransition!: (value: Response) => void;
    let resolveNewTransition!: (value: Response) => void;
    const oldTransitionResponse = new Promise<Response>((resolve) => {
      resolveOldTransition = resolve;
    });
    const newTransitionResponse = new Promise<Response>((resolve) => {
      resolveNewTransition = resolve;
    });
    let transitionAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        transitionAttempts += 1;
        return transitionAttempts === 1 ? oldTransitionResponse : newTransitionResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(transitionAttempts).toBe(1);
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();

    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(transitionAttempts).toBe(1);

    await act(async () => {
      resolveOldTransition({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical old transition",
          status: "archived",
        }),
      } as Response);
      await oldTransitionResponse;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(transitionAttempts).toBe(2);

    expect(screen.getByLabelText("Health details")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Health");
    expect(screen.getByLabelText("Status for Health")).toHaveValue("archived");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await act(async () => {
      resolveNewTransition({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical newer transition",
          status: "archived",
        }),
      } as Response);
      await newTransitionResponse;
    });

    expect(screen.getByLabelText("Title")).toHaveValue("Canonical newer transition");
    expect(screen.getByLabelText("Status for Canonical newer transition")).toHaveValue("archived");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Status for Canonical newer transition")).toHaveValue("archived");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Open details for Canonical newer transition",
    })).toBeNull();
  });

  it("keeps a supported completed task status undo saveable", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/complete" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "completed",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.selectOptions(screen.getByLabelText("Status for One"), "completed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("completed"),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("active");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps a completed project canonical while undoing other fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/project-1" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-1",
            type: "project",
            title: "Saved project",
            status: "paused",
          }),
        } as Response);
      }
      if (url === "/api/v1/todo/items/project-1/complete" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-1",
            type: "project",
            title: "Saved project",
            status: "completed",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "project-1",
            type: "project",
            title: "Terminal project",
            status: "paused",
          },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));
    await user.click(await screen.findByRole("button", {
      name: "Open details for Terminal project",
    }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Saved project");
    await user.selectOptions(screen.getByLabelText("Status for Terminal project"), "completed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Saved project" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("completed");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Terminal project");
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("completed");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Saved project");
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("completed");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("serializes detail PATCH calls and keeps the last successful canonical item", async () => {
    const user = userEvent.setup();
    let resolveOldPatch!: (value: Response) => void;
    let resolveNewPatch!: (value: Response) => void;
    let resolveOverlapSuccess!: (value: Response) => void;
    let resolveFailedPatch!: (value: Response) => void;
    const oldPatchResponse = new Promise<Response>((resolve) => {
      resolveOldPatch = resolve;
    });
    const newPatchResponse = new Promise<Response>((resolve) => {
      resolveNewPatch = resolve;
    });
    const overlapSuccessResponse = new Promise<Response>((resolve) => {
      resolveOverlapSuccess = resolve;
    });
    const failedPatchResponse = new Promise<Response>((resolve) => {
      resolveFailedPatch = resolve;
    });
    let patchAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1" && init?.method === "PATCH") {
        patchAttempts += 1;
        if (patchAttempts === 1) return oldPatchResponse;
        if (patchAttempts === 2) return newPatchResponse;
        if (patchAttempts === 3) return overlapSuccessResponse;
        return failedPatchResponse;
      }
      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Older title");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ __ravenDetailItemId: "project-1" }),
    );
    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Newer title");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(patchAttempts).toBe(1);

    await act(async () => {
      resolveOldPatch({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical older PATCH",
          status: "active",
        }),
      } as Response);
      await oldPatchResponse;
    });
    await waitFor(() => expect(patchAttempts).toBe(2));

    await act(async () => {
      resolveNewPatch({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical newer PATCH",
          status: "active",
        }),
      } as Response);
      await newPatchResponse;
    });

    expect(screen.getByRole("heading", { name: "Canonical newer PATCH" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const reopenedItem = await screen.findByRole("button", {
      name: "Open details for Canonical newer PATCH",
    });
    await user.click(reopenedItem);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Accepted overlap PATCH");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ __ravenDetailItemId: "project-1" }),
    );
    act(() => window.history.back());
    expect(await screen.findByLabelText("Canonical newer PATCH details"))
      .toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Failing latest PATCH");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(patchAttempts).toBe(3);

    await act(async () => {
      resolveOverlapSuccess({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Accepted overlap PATCH",
          status: "active",
        }),
      } as Response);
      await overlapSuccessResponse;
    });
    await waitFor(() => expect(patchAttempts).toBe(4));

    await act(async () => {
      resolveFailedPatch({
        ok: false,
        status: 409,
        json: async () => ({
          code: "conflict",
          message: "Could not save latest PATCH.",
          fields: {},
          request_id: "00000000-0000-4000-8000-000000000009",
        }),
      } as Response);
      await failedPatchResponse;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save latest PATCH.");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("button", {
      name: "Open details for Accepted overlap PATCH",
    })).toBeInTheDocument();
  }, 10_000);

  it("retries a detail transition after an older pending transition settles", async () => {
    const user = userEvent.setup();
    let resolveOldTransition!: (value: Response) => void;
    let resolveNewTransition!: (value: Response) => void;
    const oldTransitionResponse = new Promise<Response>((resolve) => {
      resolveOldTransition = resolve;
    });
    const newTransitionResponse = new Promise<Response>((resolve) => {
      resolveNewTransition = resolve;
    });
    let transitionAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        transitionAttempts += 1;
        return transitionAttempts === 1 ? oldTransitionResponse : newTransitionResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ __ravenDetailItemId: "project-1" }),
    );
    act(() => window.history.back());
    expect(await screen.findByLabelText("Health details")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(transitionAttempts).toBe(1);

    await act(async () => {
      resolveOldTransition({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical older transition",
          status: "archived",
        }),
      } as Response);
      await oldTransitionResponse;
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(transitionAttempts).toBe(2);
    await act(async () => {
      resolveNewTransition({
        ok: true,
        json: async () => ({
          id: "area-1",
          type: "area",
          title: "Canonical newer transition",
          status: "archived",
        }),
      } as Response);
      await newTransitionResponse;
    });

    expect(screen.getByRole("heading", { name: "Canonical newer transition" }))
      .toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("archived");
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Open details for Canonical newer transition",
    })).toBeNull();
  });

  it("preserves edits made while a detail save is pending", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    let patchAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        patchAttempts += 1;
        return patchResponse;
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Original note",
          },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), " Submitted A ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.clear(note);
    await user.type(note, "Later B");

    await act(async () => {
      resolvePatch({
        ok: true,
        json: async () => ({
          id: "task-1",
          type: "task",
          title: "Submitted A",
          status: "active",
          note: "Original note",
        }),
      } as Response);
      await patchResponse;
    });

    expect(screen.getByLabelText("Title")).toHaveValue("Submitted A");
    expect(
      within(screen.getByLabelText("Markdown note editor")).getByText("Later B"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Submitted A");
    expect(
      within(screen.getByLabelText("Markdown note editor")).getByText("Original note"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Submitted A");
    expect(
      within(screen.getByLabelText("Markdown note editor")).getByText("Later B"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(patchAttempts).toBe(1);
  });

  it("retries a failed composite detail save to the final canonical item", async () => {
    const user = userEvent.setup();
    let transitionAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1" && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Canonical composite title",
            status: "active",
          }),
        } as Response);
      }
      if (url === "/api/v1/todo/items/area-1/archive" && init?.method === "POST") {
        transitionAttempts += 1;
        if (transitionAttempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              code: "conflict",
              message: "Could not archive item.",
              fields: {},
              request_id: "00000000-0000-4000-8000-000000000010",
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Canonical composite title",
            status: "archived",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => linkedAreaItemsResponse(url),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await openLinkedHealthDetail(user);
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Composite title");
    await user.selectOptions(screen.getByLabelText("Status for Health"), "archived");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not archive item.");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Canonical composite title" }))
      .toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("archived");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(transitionAttempts).toBe(2);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("archived");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("archived");
    expect(screen.getByLabelText("Title")).toHaveValue("Health");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("archived");
    expect(screen.getByLabelText("Title")).toHaveValue("Canonical composite title");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "< Back" }));
    expect(await screen.findByRole("table", { name: "Areas items" })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Open details for Canonical composite title",
    })).toBeNull();
  });

  it("completes and releases a detail save rendered in React StrictMode", async () => {
    const user = userEvent.setup();
    let resolvePatch!: (value: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    let patchAttempts = 0;
    let transitionAttempts = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
        patchAttempts += 1;
        if (patchAttempts === 1) return patchResponse;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Canonical second StrictMode save",
            status: "completed",
          }),
        } as Response);
      }
      if (url === "/api/v1/todo/items/task-1/complete" && init?.method === "POST") {
        transitionAttempts += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Canonical StrictMode save",
            status: "completed",
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <React.StrictMode>
        <WorkbenchPageClient />
      </React.StrictMode>,
    );
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "StrictMode save");
    await user.selectOptions(screen.getByLabelText("Status for One"), "completed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await act(async () => {
      resolvePatch({
        ok: true,
        json: async () => ({
          id: "task-1",
          type: "task",
          title: "Canonical StrictMode save",
          status: "active",
        }),
      } as Response);
      await patchResponse;
    });

    await waitFor(() => expect(transitionAttempts).toBe(1));
    expect(await screen.findByRole("heading", { name: "Canonical StrictMode save" }))
      .toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Status for / })).toHaveValue("completed");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Second StrictMode save");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchAttempts).toBe(2));
    expect(await screen.findByRole("heading", { name: "Canonical second StrictMode save" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("groups detail edits into page-local undo and redo steps", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Old note",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(screen.getByRole("button", { name: "Edit Markdown note line 1" }));
    const note = screen.getByRole("textbox", { name: "Markdown note line 1" });
    await user.clear(note);
    await user.type(note, "New note");

    await user.click(undo);
    expect(title).toHaveValue("Renamed");
    expect(within(screen.getByLabelText("Markdown note editor")).getByText("Old note")).toBeVisible();

    await user.click(undo);
    expect(title).toHaveValue("One");
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();

    await user.click(redo);
    expect(title).toHaveValue("Renamed");
    expect(within(screen.getByLabelText("Markdown note editor")).getByText("Old note")).toBeVisible();

    await user.click(redo);
    expect(within(screen.getByLabelText("Markdown note editor")).getByText("New note")).toBeVisible();
    expect(redo).toBeDisabled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  }, 10_000);

  it("clears detail redo history after a new local edit", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await openWorkspaceTasks(user);
    await user.click(screen.getByRole("button", { name: "Open details for One" }));

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "First edit");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    await user.clear(title);
    await user.type(title, "Second edit");

    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(title).toHaveValue("Second edit");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("keeps checkbox keyboard selection from opening details", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "task-1", type: "task", title: "One", status: "active" },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const checkbox = screen.getByRole("checkbox", { name: "Select One" });
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: "Archive selected items" })).toBeEnabled();

    checkbox.focus();
    expect(checkbox).toHaveFocus();

    await user.keyboard("{Space}");
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive selected items" })).toBeEnabled();

    checkbox.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive selected items" })).toBeEnabled();
  });

  it("materializes a routine with its future occurrence target", async () => {
    const user = userEvent.setup();
    const routine = {
      id: "rtn-1",
      type: "routine",
      title: "이불정리",
      status: "active",
      recurrence_rule: "RRULE:FREQ=DAILY",
      materialization_policy: "per_occurrence",
      future_occurrences: 7,
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === "/api/v1/todo/routines/rtn-1/materialize") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({ future_occurrences: 3 }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            routine: { ...routine, last_materialized_at: "2026-07-15T09:00:00Z" },
            created: [
              { id: "task-1", type: "task", title: "이불정리", status: "active" },
              { id: "task-2", type: "task", title: "이불정리", status: "active" },
              { id: "task-3", type: "task", title: "이불정리", status: "active" },
            ],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => (String(url).includes("type=routine") ? [routine] : []),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await user.click(await screen.findByRole("cell", { name: "이불정리" }));

    expect(screen.getByLabelText("Future occurrences")).toHaveValue(7);
    expect(within(propertyRow("Last Materialized")).getByText("-")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Future occurrences"));
    await user.type(screen.getByLabelText("Future occurrences"), "3");
    await user.click(screen.getByRole("button", { name: "Materialize" }));

    expect(await screen.findByText("Created 3 tasks")).toBeInTheDocument();
    expect(
      within(propertyRow("Last Materialized")).queryByText("-"),
    ).not.toBeInTheDocument();
  });

  it("blocks an invalid future occurrence target and reports a rejected one", async () => {
    const user = userEvent.setup();
    const routine = {
      id: "rtn-1",
      type: "routine",
      title: "이불정리",
      status: "active",
      recurrence_rule: "RRULE:FREQ=DAILY",
      materialization_policy: "per_occurrence",
      future_occurrences: 7,
    };
    const fetchMock = vi.fn((url: string) => {
      if (String(url) === "/api/v1/todo/routines/rtn-1/materialize") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            code: "validation_error",
            message: "The request is invalid.",
            fields: {},
            request_id: "00000000-0000-4000-8000-000000000006",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => (String(url).includes("type=routine") ? [routine] : []),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Routines" }));
    await user.click(await screen.findByRole("cell", { name: "이불정리" }));

    await user.clear(screen.getByLabelText("Future occurrences"));
    expect(screen.getByRole("button", { name: "Materialize" })).toBeDisabled();

    await user.type(screen.getByLabelText("Future occurrences"), "366");
    expect(screen.getByRole("button", { name: "Materialize" })).toBeDisabled();
    expect(screen.getByLabelText("Future occurrences")).toHaveAttribute("max", "365");

    await user.clear(screen.getByLabelText("Future occurrences"));
    await user.type(screen.getByLabelText("Future occurrences"), "7");
    await user.click(screen.getByRole("button", { name: "Materialize" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request is invalid.",
    );
  });

  it("patches an inline due edit without opening details", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ due: "2026-06-30" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            due: "2026-06-30",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            due: "2026-06-20",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const due = await screen.findByLabelText("Due for One");
    await user.click(due);
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();

    await user.clear(due);
    await user.type(due, "2026-06-30");
    await user.tab();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
  });

  it("patches an inline project due edit through the item PATCH endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/project-1") && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ due: "2026-07-01" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "project-1",
            type: "project",
            title: "Plan",
            status: "active",
            due: "2026-07-01",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "project-1",
            type: "project",
            title: "Plan",
            status: "active",
            due: "2026-06-30",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Projects" }));

    const due = await screen.findByLabelText("Due for Plan");
    await user.clear(due);
    await user.type(due, "2026-07-01");
    await user.tab();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/project-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "Plan" })).not.toBeInTheDocument();
  });

  it("patches an inline event start edit without dropping the time", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/event-1") && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ scheduled: "2026-06-25T11:30:00Z" }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "active",
            scheduled: "2026-06-25T11:30:00Z",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "event-1",
            type: "event",
            title: "Review",
            status: "active",
            scheduled: "2026-06-24T10:00:00Z",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));

    const scheduled = await screen.findByLabelText("Starts At for Review");
    expect(scheduled).toHaveValue("2026-06-24T10:00");

    await user.clear(scheduled);
    await user.type(scheduled, "2026-06-25T11:30");
    await user.tab();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(screen.queryByRole("heading", { name: "Review" })).not.toBeInTheDocument();
  });

  it("patches inline event priority from a dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/event-1" && init?.method === "PATCH") {
        expect(init.body).toBe(JSON.stringify({ priority: 10 }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "active",
            priority: 10,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "event-1", type: "event", title: "Review", status: "active", priority: 1 },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Events" }));

    const priority = await screen.findByLabelText("Priority for Review");
    expect(priority.tagName).toBe("SELECT");
    await user.selectOptions(priority, "10");

    expect(priority).toHaveValue("10");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/event-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("reopens a completed task when inline status changes to active", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/reopen") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "completed",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const status = await screen.findByLabelText("Status for One");
    await user.selectOptions(status, "active");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1/reopen",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      fetchMock.mock.calls
        .filter(([, init]) => init?.method === "POST")
        .map(([url]) => url),
    ).toEqual(["/api/v1/todo/items/task-1/reopen"]);
  });

  it("archives an area from the inline status select", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/area-1/archive") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "area-1",
            type: "area",
            title: "Area",
            status: "archived",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "area-1",
            type: "area",
            title: "Area",
            status: "active",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    const status = await screen.findByLabelText("Status for Area");
    await user.selectOptions(status, "archived");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/area-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows stable status options for every item type", async () => {
    const user = userEvent.setup();
    const responses: Record<string, unknown[]> = {
      "/api/v1/todo/items?type=area": [
        { id: "area-1", type: "area", title: "Area", status: "active" },
      ],
      "/api/v1/todo/items?type=project": [
        {
          id: "project-1",
          type: "project",
          title: "Project without DoD",
          status: "active",
        },
        {
          id: "project-2",
          type: "project",
          title: "Project with DoD",
          status: "active",
          definition_of_done: "Done",
        },
      ],
      "/api/v1/todo/items?type=routine": [
        {
          id: "routine-1",
          type: "routine",
          title: "Routine without rule",
          status: "active",
        },
        {
          id: "routine-2",
          type: "routine",
          title: "Paused routine",
          status: "paused",
          recurrence_rule: "daily",
        },
      ],
      "/api/v1/todo/items?type=event": [
        {
          id: "event-1",
          type: "event",
          title: "Event without scheduled",
          status: "active",
        },
        {
          id: "event-2",
          type: "event",
          title: "Scheduled event",
          status: "active",
          scheduled: "2026-06-24T10:00:00Z",
        },
      ],
      "/api/v1/todo/items?type=goal": [
        { id: "goal-1", type: "goal", title: "Additional active goal", status: "active" },
        { id: "goal-2", type: "goal", title: "Secondary active goal", status: "active" },
        { id: "goal-3", type: "goal", title: "Active goal", status: "active" },
        { id: "goal-4", type: "goal", title: "Paused goal", status: "paused" },
        { id: "goal-5", type: "goal", title: "Waiting goal", status: "waiting" },
      ],
      "/api/v1/todo/items?type=task": [
        { id: "task-1", type: "task", title: "Additional active task", status: "active" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({ ok: true, json: async () => responses[url] ?? [] }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));

    await user.click(screen.getByRole("button", { name: "Projects" }));
    expect(await statusOptions("Project without DoD")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Project without DoD")).toHaveValue("active");
    expect(await statusOptions("Project with DoD")).toEqual(["active", "paused", "completed"]);

    await user.click(screen.getByRole("button", { name: "Routines" }));
    expect(await statusOptions("Routine without rule")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Routine without rule")).toHaveValue("active");
    expect(await statusOptions("Paused routine")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Paused routine")).toHaveValue("paused");

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(await statusOptions("Event without scheduled")).toEqual(["active", "paused", "completed"]);
    expect(await statusOptions("Scheduled event")).toEqual(["active", "paused", "completed"]);

    await user.click(screen.getByRole("button", { name: "Areas" }));
    expect(await statusOptions("Area")).toEqual(["active", "archived"]);

    await user.click(screen.getByRole("button", { name: "Goals" }));
    for (const title of [
      "Additional active goal",
      "Secondary active goal",
      "Active goal",
      "Paused goal",
    ]) {
      expect(await statusOptions(title)).toEqual(["active", "paused", "completed"]);
    }
    expect(screen.getByLabelText("Status for Additional active goal")).toHaveValue("active");
    expect(screen.getByLabelText("Status for Secondary active goal")).toHaveValue("active");
    expect(screen.getByLabelText("Status for Paused goal")).toHaveValue("paused");
    expect(await statusOptions("Waiting goal")).toEqual(["waiting", "active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Waiting goal")).toHaveValue("waiting");
    await user.click(screen.getByRole("cell", { name: "Additional active goal" }));
    expect(await statusOptions("Additional active goal")).toEqual(["active", "paused", "completed"]);
    expect(screen.getByLabelText("Status for Additional active goal")).toHaveValue("active");
    await user.click(screen.getByRole("button", { name: "< Back" }));

    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(await statusOptions("Additional active task")).toEqual(["active", "completed"]);
    expect(screen.getByLabelText("Status for Additional active task")).toHaveValue("active");
  });

  it("disables the relation placeholder for an existing relation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/items?type=area")) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: "area-1", type: "area", title: "Health", status: "active" }],
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "task-1",
              type: "task",
              title: "One",
              status: "active",
              area_id: "area-1",
            },
          ],
        });
      }),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const areaSelect = await screen.findByLabelText("Area for One");
    expect(within(areaSelect).getByRole("option", { name: "-" })).toBeDisabled();
  });

  it("does not PATCH a relation when the placeholder value is cleared", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/items/task-1") && init?.method === "PATCH") {
        expect(init.body).not.toBe(JSON.stringify({ area: "" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            area_id: "area-1",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "area-1",
            type: "area",
            title: "Health",
            status: "active",
          },
          {
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            area_id: "area-1",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    const areaSelect = await screen.findByLabelText("Area for One");
    fireEvent.change(areaSelect, { target: { value: "" } });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ area: "" }),
      }),
    );
  });

  it("appends Workspace pages and merges the same server group across the boundary", async () => {
    const user = userEvent.setup();
    const queries: Array<{ scope: string; offset: number }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string; offset: number };
        queries.push(body);
        if (body.scope === "workspace.task") {
          const title = body.offset === 0 ? "First page task" : "Second page task";
          return fixtureJson({
            items: [{
              key: `task-${body.offset}`,
              group_key: "active",
              group_label: "Active",
              record: fixtureWireRecord({ id: `task-${body.offset}`, type: "task", title, status: "active" } as WorkspaceItemModel),
            }],
            next_offset: body.offset === 0 ? 50 : null,
          });
        }
        return fixtureJson({ items: [], next_offset: null });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(await screen.findByText("First page task")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Second page task")).toBeInTheDocument();
    expect(screen.getAllByRole("rowgroup", { name: "Active group" })).toHaveLength(1);
    expect(queries.filter((query) => query.scope === "workspace.task").map((query) => query.offset)).toEqual([0, 50]);
  });

  it("retries a failed next Workspace page at the same offset before appending", async () => {
    const user = userEvent.setup();
    const offsets: number[] = [];
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string; offset: number };
        if (body.scope !== "workspace.task") return fixtureJson({ items: [], next_offset: null });
        offsets.push(body.offset);
        if (body.offset === 50 && !failed) {
          failed = true;
          return new Response(JSON.stringify({ message: "later" }), { status: 500, headers: { "content-type": "application/json" } });
        }
        const title = body.offset === 0 ? "Retry first" : "Retry second";
        return fixtureJson({
          items: [{ key: `retry-${body.offset}`, group_key: null, group_label: null, record: fixtureWireRecord({ id: `retry-${body.offset}`, type: "task", title, status: "active" } as WorkspaceItemModel) }],
          next_offset: body.offset === 0 ? 50 : null,
        });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load more rows.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Retry second")).toBeInTheDocument();
    expect(offsets).toEqual([0, 50, 50]);
  });

  it("does not activate linked paging until the five-row preview is expanded", async () => {
    type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];
    const observers: ObserverStub[] = [];
    class ObserverStub {
      active = true;
      target: Element | null = null;
      constructor(readonly callback: ObserverCallback) { observers.push(this); }
      observe(target: Element) { this.target = target; }
      disconnect() { this.active = false; }
      unobserve() {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    const user = userEvent.setup();
    const area = { id: "area-page", type: "area", title: "Paged area", status: "active" } as WorkspaceItemModel;
    const offsets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string; offset: number };
        if (body.scope === "workspace.area") return fixtureJson({
          items: [{ key: "area", group_key: null, group_label: null, record: fixtureWireRecord(area) }],
          next_offset: null,
        });
        if (body.scope === "linked.area.task") {
          offsets.push(body.offset);
          return fixtureJson({
            items: body.offset === 0 ? Array.from({ length: 50 }, (_, index) => ({
              key: `task-${index}`,
              group_key: null,
              group_label: null,
              record: fixtureWireRecord({
                id: `task-${index}`, type: "task", title: `Task ${index}`, status: "active",
                area_id: area.id,
              } as WorkspaceItemModel),
            })) : [],
            next_offset: body.offset === 0 ? 50 : null,
          });
        }
        return fixtureJson({ items: [], next_offset: null });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Paged area" }));
    const linked = await screen.findByRole("table", { name: "Tasks linked items" });
    await waitFor(() => expect(within(linked).getAllByRole("button", { name: /^Open Task \d+ details$/ })).toHaveLength(5));
    expect(within(linked).queryByRole("button", { name: "Load more" })).toBeNull();
    expect(observers.filter((observer) => observer.active && observer.target && linked.contains(observer.target))).toHaveLength(0);
    expect(offsets).toEqual([0]);

    await user.click(screen.getByRole("button", { name: "More (45) Tasks" }));
    const linkedObserver = await waitFor(() => {
      const observer = observers.find((candidate) =>
        candidate.active && candidate.target && linked.contains(candidate.target));
      expect(observer).toBeDefined();
      return observer!;
    });
    act(() => linkedObserver.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(offsets).toEqual([0, 50]));
  });

  it("shows a blocking retry for an initial Workspace page failure", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string };
        if (body.scope === "workspace.task") return new Response("{}", { status: 500 });
        return fixtureJson({ items: [], next_offset: null });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load rows.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No tasks found.")).toBeNull();
    expect(screen.queryByText("No items match this view.")).toBeNull();
  });

  it("does not leak legacy linked rows when the canonical initial page fails", async () => {
    const user = userEvent.setup();
    const area = { id: "area-error", type: "area", title: "Paged area", status: "active" } as WorkspaceItemModel;
    const legacy = { id: "legacy-task", type: "task", title: "Legacy leaked task", status: "active", area_id: area.id } as WorkspaceItemModel;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string };
        if (body.scope === "workspace.area") return fixtureJson({
          items: [{ key: "area", group_key: null, group_label: null, record: fixtureWireRecord(area) }],
          next_offset: null,
        });
        if (body.scope === "linked.area.task") return new Response("{}", { status: 500 });
        return fixtureJson({ items: [], next_offset: null });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      if (url === "/api/v1/todo/items") return fixtureJson([area, legacy]);
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Paged area" }));

    const linked = await screen.findByRole("table", { name: "Tasks linked items" });
    expect(within(linked).getByRole("alert")).toHaveTextContent("Could not load rows.");
    expect(within(linked).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(linked).queryByText("Legacy leaked task")).toBeNull();
    expect(within(linked).queryByText("No linked items match this view.")).toBeNull();
  });

  it("shows loading instead of a false no-match state for an initial linked page", async () => {
    const user = userEvent.setup();
    const area = { id: "area-loading", type: "area", title: "Loading area", status: "active" } as WorkspaceItemModel;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string };
        if (body.scope === "workspace.area") return Promise.resolve(fixtureJson({
          items: [{ key: "area-loading", group_key: null, group_label: null, record: fixtureWireRecord(area) }],
          next_offset: null,
        }));
        if (body.scope === "linked.area.task") return new Promise<Response>(() => {});
        return Promise.resolve(fixtureJson({ items: [], next_offset: null }));
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return Promise.resolve(fixtureJson({ items: [] }));
      return Promise.resolve(fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []));
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Loading area" }));

    const linked = await screen.findByRole("table", { name: "Tasks linked items" });
    expect(within(linked).getByText("Loading items...")).toBeInTheDocument();
    expect(within(linked).queryByText("No linked items match this view.")).toBeNull();
  });

  it("shows blocking retries instead of empty states for every Planner period", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/v1/todo/table/query") return new Response("{}", { status: 500 });
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));

    for (const [period, tableCount] of [["Yearly", 2], ["Monthly", 3], ["Weekly", 3], ["Daily", 3]] as const) {
      if (period !== "Yearly") await user.click(screen.getByRole("button", { name: period }));
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(tableCount));
      expect(screen.queryByText(/^No (?:goals|items|scheduled items)/i)).toBeNull();
      expect(screen.getAllByRole("alert").every((alert) => alert.textContent?.includes("Could not load rows."))).toBe(true);
    }
  });

  it("filters the deliberate rich reference set before Workspace, Planner, and linked group counts", async () => {
    const user = userEvent.setup();
    const area = { id: "area-rich", type: "area", title: "Rich area", status: "active" } as WorkspaceItemModel;
    const tasks = Array.from({ length: 51 }, (_, index) => ({
      id: `rich-task-${index}`,
      type: "task",
      title: `Rich task ${index}`,
      status: "active",
      area_id: area.id,
      scheduled: testToday(),
    } as WorkspaceItemModel));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string; filters: unknown[] };
        const record = body.scope === "workspace.area"
          ? area
          : body.filters.length > 0 ? tasks[50]! : tasks[0]!;
        return fixtureJson({
          items: [{ key: `${body.scope}-first`, group_key: null, group_label: null, record: fixtureWireRecord(record) }],
          next_offset: body.scope === "workspace.area" || body.filters.length > 0 ? null : 50,
        });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      if (url === "/api/v1/todo/items") return fixtureJson([area, ...tasks]);
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    const applyTitleFilter = async (filterButton: HTMLElement, dialogName: string) => {
      await user.click(filterButton);
      const dialog = await screen.findByRole("dialog", { name: dialogName });
      await user.click(within(dialog).getByRole("button", { name: "Add filter rule" }));
      await user.click(within(dialog).getByRole("option", { name: "Title" }));
      await user.type(within(dialog).getByLabelText("Filter value"), "Rich task 50");
    };
    const expectActiveCount = async (groupButton: HTMLElement, dialogName: string) => {
      await user.click(groupButton);
      const dialog = await screen.findByRole("dialog", { name: dialogName });
      await user.click(within(dialog).getByRole("button", { name: "Choose group property" }));
      await user.click(within(dialog).getByRole("option", { name: "Status" }));
      expect(within(dialog).getByRole("listitem")).toHaveTextContent(/^Active1/);
      await user.click(within(dialog).getByRole("button", { name: "Remove grouping" }));
      await user.keyboard("{Escape}");
    };
    const discardChangesIfPrompted = async () => {
      const discard = screen.queryByRole("button", { name: "Discard changes" });
      if (discard) await user.click(discard);
    };

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    await screen.findByText("Rich task 0");
    expect(within(screen.getByRole("table", { name: "Tasks items" })).queryByRole("rowheader")).toBeNull();
    await applyTitleFilter(screen.getByRole("button", { name: "Filter Tasks" }), "Filter Tasks");
    await expectActiveCount(screen.getByRole("button", { name: "Group Tasks" }), "Group Tasks");

    await user.click(screen.getByRole("button", { name: "Planner" }));
    await discardChangesIfPrompted();
    await user.click(screen.getByRole("button", { name: "Daily" }));
    expect((await screen.findAllByRole("button", { name: "Rich task 0" })).length).toBeGreaterThan(0);
    await applyTitleFilter(screen.getByRole("button", { name: "Filter Today" }), "Filter Today");
    await expectActiveCount(screen.getByRole("button", { name: "Group Today" }), "Group Today");

    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await discardChangesIfPrompted();
    if (!screen.queryByRole("button", { name: "Areas" })) {
      await user.click(screen.getByRole("button", { name: "Workspace" }));
      await discardChangesIfPrompted();
    }
    await user.click(screen.getByRole("button", { name: "Areas" }));
    await discardChangesIfPrompted();
    await user.click(await screen.findByRole("button", { name: "Open details for Rich area" }));
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Tasks linked items" })).queryByRole("rowheader")).toBeNull();
    await applyTitleFilter(screen.getByRole("button", { name: "Filter Tasks" }), "Filter Tasks");
    await expectActiveCount(screen.getByRole("button", { name: "Group Tasks" }), "Group Tasks");
  });

  it("initializes every Planner table through an independent offset-zero query", async () => {
    const user = userEvent.setup();
    const scopes = new Set<string>();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string; offset: number };
        if (body.scope.startsWith("planner.")) {
          expect(body.offset).toBe(0);
          scopes.add(body.scope);
        }
        return fixtureJson({ items: [], next_offset: null });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    await waitFor(() => expect(scopes.size).toBeGreaterThanOrEqual(2));
    for (const period of ["Monthly", "Weekly", "Daily"]) {
      await user.click(screen.getByRole("button", { name: period }));
    }
    await waitFor(() => expect([...scopes].sort()).toEqual([
      "planner.daily-overdue", "planner.daily-today", "planner.daily-unscheduled",
      "planner.monthly-calendar", "planner.monthly-period-goals", "planner.monthly-week-goals",
      "planner.weekly-day-grid", "planner.weekly-month-goals", "planner.weekly-week-goals",
      "planner.yearly-month-goals", "planner.yearly-period-goals",
    ]));
  });

  it("renders adjacent Planner periods and spillover days from bounded server ranges", async () => {
    const user = userEvent.setup();
    const today = testToday();
    const selectedYear = testYearStart(today);
    const previousYear = testYearStart(testAddDays(selectedYear, -1));
    const selectedMonth = testMonthStart(today);
    const previousMonth = testPreviousMonthStart(selectedMonth);
    const firstVisibleWeek = testWeekStart(selectedMonth);
    const visibleWeek = testWeekStart(today);
    const visibleMonth = testMonthStart(visibleWeek);
    const contexts = new Map<string, { from?: string; to?: string }>();
    const records: Record<string, WorkspaceItemModel[]> = {
      "planner.yearly-period-goals": [{
        id: "adjacent-year-goal", type: "goal", title: "Adjacent year goal", status: "active",
        scheduled: previousYear, horizon: "year",
      } as WorkspaceItemModel],
      "planner.monthly-period-goals": [{
        id: "adjacent-month-goal", type: "goal", title: "Adjacent month goal", status: "active",
        scheduled: previousMonth, horizon: "month",
      } as WorkspaceItemModel],
      "planner.monthly-calendar": [{
        id: "spillover-task", type: "task", title: "Spillover calendar task", status: "active",
        scheduled: firstVisibleWeek,
      } as WorkspaceItemModel],
      "planner.monthly-week-goals": [{
        id: "spillover-week-goal", type: "goal", title: "Spillover week goal", status: "active",
        scheduled: firstVisibleWeek, horizon: "week",
      } as WorkspaceItemModel],
      "planner.weekly-month-goals": [{
        id: "whole-month-goal", type: "goal", title: "Whole month goal", status: "active",
        scheduled: visibleMonth, horizon: "month",
      } as WorkspaceItemModel],
    };

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as {
          scope: string;
          context: { from?: string; to?: string };
        };
        contexts.set(body.scope, body.context);
        const items = (records[body.scope] ?? []).filter((item) =>
          (!body.context.from || (item.scheduled ?? "") >= body.context.from) &&
          (!body.context.to || (item.scheduled ?? "") <= body.context.to));
        return fixtureJson({
          items: items.map((item) => ({
            key: `${body.scope}:${item.id}`,
            group_key: null,
            group_label: null,
            record: fixtureWireRecord(item),
          })),
          next_offset: null,
        });
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Planner" }));
    expect(await screen.findByText("Adjacent year goal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(await screen.findByText("Adjacent month goal")).toBeInTheDocument();
    expect(await screen.findByText("Spillover calendar task")).toBeInTheDocument();
    expect(await screen.findByText("Spillover week goal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Weekly" }));
    expect(await screen.findByText("Whole month goal")).toBeInTheDocument();

    expect(contexts.get("planner.yearly-period-goals")).toMatchObject({
      from: previousYear,
      to: testAddDays(testNextYearStart(testNextYearStart(selectedYear)), -1),
    });
    expect(contexts.get("planner.monthly-period-goals")).toMatchObject({
      from: previousMonth,
      to: testMonthEnd(testNextMonthStart(selectedMonth)),
    });
    expect(contexts.get("planner.monthly-calendar")).toMatchObject({
      from: firstVisibleWeek,
      to: testAddDays(testWeekStart(testMonthEnd(selectedMonth)), 6),
    });
    expect(contexts.get("planner.monthly-week-goals")).toEqual(
      contexts.get("planner.monthly-calendar"),
    );
    expect(contexts.get("planner.weekly-month-goals")).toMatchObject({
      from: visibleMonth,
      to: testMonthEnd(visibleMonth),
    });
  });

  it("opens a linked page-two occurrence and refreshes offset zero after its mutation", async () => {
    const user = userEvent.setup();
    const linkedOffsets: number[] = [];
    let canonicalTitle = "Opaque page two";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body)) as { scope: string; offset: number };
        if (body.scope === "workspace.area") {
          return fixtureJson({ items: [{ key: "area", group_key: null, group_label: null, record: fixtureWireRecord({ id: "area-page", type: "area", title: "Paged area", status: "active" } as WorkspaceItemModel) }], next_offset: null });
        }
        if (body.scope === "linked.area.task") {
          linkedOffsets.push(body.offset);
          if (body.offset === 0) {
            return fixtureJson({ items: [{ key: "linked-first", group_key: null, group_label: null, record: fixtureWireRecord({ id: "linked-first", type: "task", title: "Opaque first", status: "active", area_id: "area-page" } as WorkspaceItemModel) }], next_offset: 50 });
          }
          return fixtureJson({ items: [{ key: "linked-second", group_key: null, group_label: null, record: fixtureWireRecord({ id: "linked-second", type: "task", title: canonicalTitle, status: "active", area_id: "area-page" } as WorkspaceItemModel) }], next_offset: null });
        }
        return fixtureJson({ items: [], next_offset: null });
      }
      if (url === "/api/v1/todo/items/linked-second" && init?.method === "PATCH") {
        canonicalTitle = "Canonical page two";
        return fixtureJson(fixtureWireRecord({ id: "linked-second", type: "task", title: canonicalTitle, status: "active", area_id: "area-page" } as WorkspaceItemModel));
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return fixtureJson({ items: [] });
      return fixtureJson(url.startsWith("/api/v1/preferences/") ? {} : []);
    }));

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(await screen.findByRole("button", { name: "Open details for Paged area" }));
    const tasks = await screen.findByRole("table", { name: "Tasks linked items" });
    await user.click(screen.getByRole("button", { name: "More Tasks" }));
    await user.click(within(tasks).getByRole("button", { name: "Load more" }));
    await user.click(await within(tasks).findByRole("button", { name: "Open Opaque page two details" }));
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Canonical page two");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Canonical page two" })).toBeInTheDocument();
    expect(linkedOffsets).toEqual([0, 50]);
    await user.click(screen.getByRole("button", { name: "< Back" }));
    await waitFor(() => expect(linkedOffsets).toEqual([0, 50, 0]));
  });

});

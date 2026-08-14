import {
  ArrowDownUp,
  Filter,
  GripVertical,
  Group,
  Plus,
  X,
} from "lucide-react";
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type {
  PlannerGroupCandidate,
  PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  effectivePlannerFilterRules,
  type PlannerFilterField,
  type PlannerFilterMode,
  type PlannerFilterOperator,
  type PlannerFilterRule,
  type PlannerFilterType,
  type PlannerFilterValue,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerSortRule,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";
import { PlannerGroupPanel } from "@/features/workbench/ui/PlannerGroupPanel";

export type Option<T extends string> = {
  value: T;
  label: string;
};

export type PlannerFilterOptionSet = {
  tags: Option<string>[];
  areas: Option<string>[];
  projects: Option<string>[];
  routines: Option<string>[];
  statuses: Option<string>[];
  priorities: Option<string>[];
  horizons: Option<string>[];
  parents: Option<string>[];
  materializationPolicies: Option<string>[];
  participants: Option<string>[];
};

export type PlannerFilterOptions = {
  tags: Option<string>[];
  daily: PlannerFilterOptionSet;
  storedRelationLabels?: Partial<
    Record<PlannerFilterField, Record<string, string>>
  >;
};

export type TableViewControlsAdapter = {
  scopeId: string;
  title: string;
  settings: PlannerTableSettings;
  filterFields: readonly PlannerFilterField[];
  sortFields: readonly PlannerSortBy[];
  groupOptions: Option<PlannerGroupBy>[];
  candidates: PlannerGroupCandidate[];
  filterOptions: PlannerFilterOptions;
  activeControlsAriaLabel?: string;
  dropdownIdPrefix: string;
  isDefaultSort(rules: PlannerSortRule[]): boolean;
  missSuccessFocusTarget?: string;
  update(
    updater: (settings: PlannerTableSettings) => PlannerTableSettings,
  ): void;
  add?: () => void;
};

type TableViewDropdownKind = "filter" | "sort" | "group";

type PlannerFilterFieldConfig = {
  field: PlannerFilterField;
  label: string;
  type: PlannerFilterType;
  options: Option<string>[];
};

type PlannerSortFieldOption = Option<PlannerSortBy>;

const emptyOperators = new Set<PlannerFilterOperator>(["is_empty", "is_not_empty"]);

export function TableViewControls({
  adapter,
}: {
  adapter: TableViewControlsAdapter;
}): React.ReactElement {
  const [openDropdown, setOpenDropdown] = React.useState<TableViewDropdownKind | null>(null);
  const visibleFilterRules = visibleTableViewFilterRules(adapter);
  const effectiveFilterRules = effectivePlannerFilterRules(
    adapter.settings.filterRules,
    adapter.filterFields,
  );
  const activeFilterCount = effectiveFilterRules.length;
  const groupBy = effectiveTableViewGroupValue(
    adapter.groupOptions,
    adapter.settings.groupSettings.groupBy,
  );
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const sortPanelRef = useRef<HTMLDivElement>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);
  const safeScopeId = adapter.scopeId.replaceAll(".", "-");
  const dropdownIds: Record<TableViewDropdownKind, string> = {
    filter: `${adapter.dropdownIdPrefix}-filter-dropdown-${safeScopeId}`,
    sort: `${adapter.dropdownIdPrefix}-sort-dropdown-${safeScopeId}`,
    group: `${adapter.dropdownIdPrefix}-group-dropdown-${safeScopeId}`,
  };
  const triggerRefs: Record<
    TableViewDropdownKind,
    React.RefObject<HTMLButtonElement>
  > = {
    filter: filterTriggerRef,
    sort: sortTriggerRef,
    group: groupTriggerRef,
  };
  const panelRefs: Record<
    TableViewDropdownKind,
    React.RefObject<HTMLDivElement>
  > = {
    filter: filterPanelRef,
    sort: sortPanelRef,
    group: groupPanelRef,
  };
  const showSort = !adapter.isDefaultSort(adapter.settings.sortRules);

  useEffect(() => {
    if (!openDropdown) return;
    const triggerRef = triggerRefs[openDropdown];
    const panelRef = panelRefs[openDropdown];

    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        event.target instanceof Node &&
        (panelRef.current?.contains(event.target) ||
          triggerRef.current?.contains(event.target))
      ) {
        return;
      }
      setOpenDropdown(null);
      if (event instanceof MouseEvent) {
        const pointerTarget = event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
        const nextInteractiveTarget = pointerTarget?.closest(
          "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
        );
        if (!nextInteractiveTarget) {
          requestAnimationFrame(() => triggerRef.current?.focus());
        }
      } else {
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [openDropdown]);

  function toggleDropdown(kind: TableViewDropdownKind) {
    setOpenDropdown((current) => (current === kind ? null : kind));
  }

  function updateGroupSettings(
    updater: (current: PlannerGroupSettings) => PlannerGroupSettings,
  ) {
    adapter.update((current) => ({
      ...current,
      groupSettings: updater(current.groupSettings),
    }));
  }

  return (
    <div
      className="table-view-controls planner-view-actions"
      role="group"
      aria-label={`${adapter.title} controls`}
    >
        <TableViewDropdownButton
          active={openDropdown === "filter" || activeFilterCount > 0}
          ariaLabel={`Filter ${adapter.title}`}
          title="Filter"
          onClick={() => toggleDropdown("filter")}
          buttonRef={filterTriggerRef}
          ariaExpanded={openDropdown === "filter"}
          ariaControls={dropdownIds.filter}
          missSuccessFocusTarget={adapter.missSuccessFocusTarget}
        >
          <Filter size={16} aria-hidden="true" />
        </TableViewDropdownButton>
        <TableViewDropdownButton
          active={openDropdown === "sort" || showSort}
          ariaLabel={`Sort ${adapter.title}`}
          title="Sort"
          onClick={() => toggleDropdown("sort")}
          buttonRef={sortTriggerRef}
          ariaExpanded={openDropdown === "sort"}
          ariaControls={dropdownIds.sort}
        >
          <ArrowDownUp size={16} aria-hidden="true" />
        </TableViewDropdownButton>
        <TableViewDropdownButton
          active={openDropdown === "group" || groupBy !== "none"}
          ariaLabel={`Group ${adapter.title}`}
          title="Group by"
          onClick={() => toggleDropdown("group")}
          buttonRef={groupTriggerRef}
          ariaExpanded={openDropdown === "group"}
          ariaControls={dropdownIds.group}
        >
          <Group size={16} aria-hidden="true" />
        </TableViewDropdownButton>
        {adapter.add ? (
          <button
            className="items-toolbar-button"
            type="button"
            aria-label={`Add to ${adapter.title}`}
            onClick={adapter.add}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        ) : null}
        {openDropdown === "filter" ? (
          <TableViewControlMenuPortal
            triggerRef={filterTriggerRef}
            panelRef={filterPanelRef}
          >
            {({ popoverRef, style }) => (
              <TableViewControlDropdown
                id={dropdownIds.filter}
                title={`Filter ${adapter.title}`}
                dropdownRef={popoverRef}
                style={style}
              >
                <TableViewFilterRulePanel
                  adapter={adapter}
                  rules={visibleFilterRules}
                />
              </TableViewControlDropdown>
            )}
          </TableViewControlMenuPortal>
        ) : null}
        {openDropdown === "sort" ? (
          <TableViewControlMenuPortal
            triggerRef={sortTriggerRef}
            panelRef={sortPanelRef}
          >
            {({ popoverRef, style }) => (
              <TableViewControlDropdown
                id={dropdownIds.sort}
                title={`Sort ${adapter.title}`}
                dropdownRef={popoverRef}
                style={style}
              >
                <TableViewSortPanel adapter={adapter} />
              </TableViewControlDropdown>
            )}
          </TableViewControlMenuPortal>
        ) : null}
        {openDropdown === "group" ? (
          <TableViewControlMenuPortal
            triggerRef={groupTriggerRef}
            panelRef={groupPanelRef}
          >
            {({ popoverRef, style }) => (
              <TableViewControlDropdown
                id={dropdownIds.group}
                title={`Group ${adapter.title}`}
                compact
                dropdownRef={popoverRef}
                style={style}
              >
                <PlannerGroupPanel
                  settings={{ ...adapter.settings.groupSettings, groupBy }}
                  candidates={adapter.candidates}
                  groupOptions={adapter.groupOptions}
                  onGroupByChange={(value) =>
                    updateGroupSettings((current) => ({ ...current, groupBy: value }))}
                  onSortChange={(value) =>
                    updateGroupSettings((current) => ({ ...current, sort: value }))}
                  onHideEmptyChange={(value) =>
                    updateGroupSettings((current) => ({ ...current, hideEmpty: value }))}
                  onVisibilityToggle={(key) => updateGroupSettings((current) => ({
                    ...current,
                    hiddenGroupKeys: current.hiddenGroupKeys.includes(key)
                      ? current.hiddenGroupKeys.filter((candidate) => candidate !== key)
                      : [...current.hiddenGroupKeys, key],
                  }))}
                  onAllVisibilityChange={(keys, visible) =>
                    updateGroupSettings((current) => ({
                      ...current,
                      hiddenGroupKeys: visible ? [] : keys,
                    }))}
                  onManualOrderChange={(keys) =>
                    updateGroupSettings((current) => ({ ...current, manualOrder: keys }))}
                  onRemove={() =>
                    updateGroupSettings((current) => ({ ...current, groupBy: "none" }))}
                  onRequestOuterClose={() => {
                    setOpenDropdown(null);
                    groupTriggerRef.current?.focus();
                  }}
                />
              </TableViewControlDropdown>
            )}
          </TableViewControlMenuPortal>
        ) : null}
    </div>
  );
}

export function TableViewActivePills({
  adapter,
}: {
  adapter: TableViewControlsAdapter;
}): React.ReactElement | null {
  const filterCount = effectivePlannerFilterRules(
    adapter.settings.filterRules,
    adapter.filterFields,
  ).length;
  const groupBy = effectiveTableViewGroupValue(
    adapter.groupOptions,
    adapter.settings.groupSettings.groupBy,
  );
  const showSort = !adapter.isDefaultSort(adapter.settings.sortRules);

  return (
    <TableViewActiveControlPills
      filterCount={filterCount}
      sortRules={adapter.settings.sortRules}
      groupBy={groupBy}
      showSort={showSort}
      ariaLabel={adapter.activeControlsAriaLabel}
    />
  );
}

function visibleTableViewFilterRules(
  adapter: Pick<
    TableViewControlsAdapter,
    "settings" | "filterFields" | "filterOptions"
  >,
): PlannerFilterRule[] {
  const fields = tableViewFilterFieldConfigs(
    adapter.filterOptions,
    adapter.filterFields,
  );
  return adapter.settings.filterRules.filter((rule) =>
    fields.some((field) => field.field === rule.field));
}

function TableViewDropdownButton({
  active,
  ariaLabel,
  title,
  onClick,
  children,
  buttonRef,
  ariaExpanded,
  ariaControls,
  missSuccessFocusTarget,
}: {
  active: boolean;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaExpanded?: boolean;
  ariaControls?: string;
  missSuccessFocusTarget?: string;
}) {
  return (
    <button
      ref={buttonRef}
      className="planner-view-icon-button"
      type="button"
      aria-label={ariaLabel}
      title={title}
      data-active={active}
      data-planner-miss-success-focus={missSuccessFocusTarget}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TableViewControlMenuPortal({
  triggerRef,
  panelRef,
  children,
}: {
  triggerRef: React.RefObject<HTMLButtonElement>;
  panelRef: React.Ref<HTMLDivElement>;
  children: (props: {
    popoverRef: React.Ref<HTMLDivElement>;
    style: React.CSSProperties | undefined;
  }) => React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>();

  React.useLayoutEffect(() => {
    function update() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      setStyle(tableViewControlDropdownStyle(trigger, popover));
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [triggerRef]);

  function setPopoverRef(element: HTMLDivElement | null) {
    popoverRef.current = element;
    if (typeof panelRef === "function") {
      panelRef(element);
      return;
    }
    if (panelRef) {
      (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
    }
  }

  return createPortal(children({ popoverRef: setPopoverRef, style }), document.body);
}

function TableViewControlDropdown({
  id,
  title,
  compact = false,
  dropdownRef,
  style,
  children,
}: {
  id?: string;
  title: string;
  compact?: boolean;
  dropdownRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={dropdownRef}
      id={id}
      className={`planner-control-dropdown${
        compact ? " planner-control-dropdown-compact" : ""
      }`}
      style={style}
      role="dialog"
      aria-label={title}
    >
      <div className="planner-control-dropdown-title">{title}</div>
      {children}
    </div>
  );
}

function TableViewActiveControlPills({
  filterCount,
  sortRules,
  groupBy,
  showSort,
  ariaLabel = "Active table view controls",
}: {
  filterCount: number;
  sortRules: PlannerSortRule[];
  groupBy: string;
  showSort: boolean;
  ariaLabel?: string;
}) {
  if (filterCount === 0 && groupBy === "none" && !showSort) return null;

  return (
    <div
      className="table-view-active-pills planner-active-control-row"
      aria-label={ariaLabel}
    >
      {filterCount > 0 ? (
        <span className="table-view-active-pill planner-active-pill">
          {filterCount} rules
        </span>
      ) : null}
      {showSort && sortRules.length > 0 ? (
        <span className="table-view-active-pill planner-active-pill">
          Sorted by {tableViewControlLabel(sortRules[0].field)}
          {sortRules.length > 1 ? ` +${sortRules.length - 1}` : ""}
        </span>
      ) : null}
      {groupBy !== "none" ? (
        <span className="table-view-active-pill planner-active-pill">
          Grouped by {tableViewControlLabel(groupBy)}
        </span>
      ) : null}
    </div>
  );
}

function TableViewFilterRulePanel({
  adapter,
  rules,
}: {
  adapter: TableViewControlsAdapter;
  rules: PlannerFilterRule[];
}) {
  const fields = tableViewFilterFieldConfigs(
    adapter.filterOptions,
    adapter.filterFields,
  );

  if (rules.length === 0) {
    return (
      <TableViewFilterFieldPicker
        fields={fields}
        onPick={(field) => addTableViewRule(adapter, field)}
      />
    );
  }

  return (
    <div className="planner-filter-rule-panel">
      {rules.length > 1 ? <TableViewFilterModeControl adapter={adapter} /> : null}
      {rules.map((rule, index) => (
        <TableViewAdvancedFilterRuleRow
          key={rule.id}
          adapter={adapter}
          fields={fields}
          rule={rule}
          prefix={index === 0
            ? "Where"
            : formatTableViewFilterMode(adapter.settings.filterMode)}
        />
      ))}
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Add filter rule"
        onClick={() => addTableViewRule(adapter, fields[0])}
      >
        + Add filter rule
      </button>
      <button
        type="button"
        className="planner-filter-action planner-filter-action-danger"
        onClick={() => adapter.update((current) => ({
          ...current,
          filterRules: [],
        }))}
      >
        Delete filter
      </button>
    </div>
  );
}

function TableViewSortPanel({
  adapter,
}: {
  adapter: TableViewControlsAdapter;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const rules = adapter.settings.sortRules;
  const fields = tableViewSortFieldOptions(adapter);

  if (rules.length === 0) {
    return (
      <TableViewSortFieldPicker
        fields={fields}
        onPick={(field) => {
          setTableViewSortRules(adapter, [newTableViewSortRule(field.value)]);
          setAddOpen(false);
        }}
      />
    );
  }

  function addSort(field: PlannerSortFieldOption) {
    setTableViewSortRules(adapter, [...rules, newTableViewSortRule(field.value)]);
    setAddOpen(false);
  }

  function updateRule(ruleId: string, patch: Partial<PlannerSortRule>) {
    setTableViewSortRules(
      adapter,
      rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    );
  }

  function removeRule(ruleId: string) {
    setTableViewSortRules(adapter, rules.filter((rule) => rule.id !== ruleId));
  }

  function moveRule(fromId: string, toId: string) {
    const from = rules.findIndex((rule) => rule.id === fromId);
    const to = rules.findIndex((rule) => rule.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rules];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTableViewSortRules(adapter, next);
  }

  return (
    <div className="planner-sort-panel">
      {rules.map((rule) => (
        <div
          className="planner-sort-row"
          draggable
          key={rule.id}
          onDragStart={(event) => event.dataTransfer.setData("text/plain", rule.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            moveRule(event.dataTransfer.getData("text/plain"), rule.id);
          }}
        >
          <span className="planner-sort-grip" aria-label="Drag sort rule">
            <GripVertical size={14} aria-hidden="true" />
          </span>
          <label className="planner-filter-select-label">
            <span>Sort field</span>
            <select
              aria-label="Sort field"
              value={rule.field}
              onChange={(event) =>
                updateRule(rule.id, { field: event.target.value as PlannerSortBy })}
            >
              {fields.map((field) => (
                <option value={field.value} key={field.value}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label className="planner-filter-select-label">
            <span>Sort direction</span>
            <select
              aria-label="Sort direction"
              value={rule.direction}
              onChange={(event) => updateRule(rule.id, {
                direction: event.target.value as PlannerSortRule["direction"],
              })}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button
            type="button"
            className="planner-sort-remove"
            aria-label="Remove sort rule"
            onClick={() => removeRule(rule.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Add sort"
        aria-expanded={addOpen}
        onClick={() => setAddOpen((current) => !current)}
      >
        + Add sort
      </button>
      {addOpen ? <TableViewSortFieldOptions fields={fields} onPick={addSort} /> : null}
      <button
        type="button"
        className="planner-filter-action planner-filter-action-danger"
        onClick={() => setTableViewSortRules(adapter, [])}
      >
        Delete sort
      </button>
    </div>
  );
}

function TableViewSortFieldPicker({
  fields,
  onPick,
}: {
  fields: PlannerSortFieldOption[];
  onPick: (field: PlannerSortFieldOption) => void;
}) {
  return (
    <div className="planner-sort-panel">
      <TableViewSortFieldOptions fields={fields} onPick={onPick} />
    </div>
  );
}

function TableViewSortFieldOptions({
  fields,
  onPick,
}: {
  fields: PlannerSortFieldOption[];
  onPick: (field: PlannerSortFieldOption) => void;
}) {
  return (
    <div className="planner-filter-field-options" role="listbox" aria-label="Sort fields">
      {fields.map((field) => (
        <button
          type="button"
          role="option"
          aria-selected="false"
          key={field.value}
          onClick={() => onPick(field)}
        >
          {field.label}
        </button>
      ))}
    </div>
  );
}

function TableViewFilterFieldPicker({
  fields,
  onPick,
}: {
  fields: PlannerFilterFieldConfig[];
  onPick: (field: PlannerFilterFieldConfig) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="planner-filter-field-picker">
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Add filter rule"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        + Add filter rule
      </button>
      {open ? (
        <div className="planner-filter-field-options" role="listbox" aria-label="Filter fields">
          {fields.map((field) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={field.field}
              onClick={() => onPick(field)}
            >
              {field.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TableViewFilterModeControl({
  adapter,
}: {
  adapter: TableViewControlsAdapter;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="planner-filter-mode-menu">
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Filter mode"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Mode: {formatTableViewFilterMode(adapter.settings.filterMode)}
      </button>
      {open ? (
        <div className="planner-filter-field-options" role="listbox" aria-label="Filter mode options">
          {(["and", "or"] as const).map((mode) => (
            <button
              type="button"
              role="option"
              aria-selected={mode === adapter.settings.filterMode}
              key={mode}
              onClick={() => {
                adapter.update((current) => ({ ...current, filterMode: mode }));
                setOpen(false);
              }}
            >
              {formatTableViewFilterMode(mode)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TableViewAdvancedFilterRuleRow({
  adapter,
  fields,
  rule,
  prefix,
}: {
  adapter: TableViewControlsAdapter;
  fields: PlannerFilterFieldConfig[];
  rule: PlannerFilterRule;
  prefix: string;
}) {
  const baseField = fields.find((option) => option.field === rule.field) ?? fields[0];
  const field = tableViewFilterFieldWithStoredOptions(
    adapter.filterOptions,
    baseField,
    rule,
  );

  return (
    <div className="planner-advanced-filter-row">
      <span className="planner-filter-token">{prefix}</span>
      <label className="planner-filter-select-label">
        <span>Field</span>
        <select
          aria-label="Filter field"
          value={field.field}
          onChange={(event) => {
            const nextField = fields.find((option) => option.field === event.target.value);
            if (nextField) {
              updateTableViewRule(
                adapter,
                rule.id,
                ruleForField(rule.id, nextField),
              );
            }
          }}
        >
          {fields.map((option) => (
            <option value={option.field} key={option.field}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="planner-filter-select-label">
        <span>Operator</span>
        <select
          aria-label={`Operator for ${field.label}`}
          value={rule.operator}
          onChange={(event) => updateTableViewRule(adapter, rule.id, {
            operator: event.target.value as PlannerFilterOperator,
            value: emptyOperators.has(event.target.value as PlannerFilterOperator)
              ? null
              : rule.value,
          })}
        >
          {operatorsForFilterType(field.type).map((operator) => (
            <option value={operator} key={operator}>
              {operatorLabel(operator)}
            </option>
          ))}
        </select>
      </label>
      <TableViewFilterValueEditor
        rule={rule}
        field={field}
        onChange={(value) => updateTableViewRule(adapter, rule.id, { value })}
      />
    </div>
  );
}

function TableViewFilterValueEditor({
  rule,
  field,
  onChange,
}: {
  rule: PlannerFilterRule;
  field: PlannerFilterFieldConfig;
  onChange: (value: PlannerFilterValue) => void;
}) {
  if (rule.operator === "is_empty" || rule.operator === "is_not_empty") return null;
  if (field.type === "text") {
    return (
      <input
        aria-label="Filter value"
        value={String(rule.value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "date") {
    return (
      <input
        aria-label="Filter date value"
        type="date"
        value={String(rule.value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        aria-label="Filter number value"
        type="number"
        value={String(rule.value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return <TableViewFilterOptionDropdown field={field} rule={rule} onChange={onChange} />;
}

function TableViewFilterOptionDropdown({
  field,
  rule,
  onChange,
}: {
  field: PlannerFilterFieldConfig;
  rule: PlannerFilterRule;
  onChange: (value: PlannerFilterValue) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedValues = new Set(Array.isArray(rule.value) ? rule.value : []);
  const selectedOptions = field.options.filter((option) =>
    selectedValues.has(option.value));

  function toggleValue(optionValue: string) {
    onChange(
      selectedValues.has(optionValue)
        ? [...selectedValues].filter((value) => value !== optionValue)
        : [...selectedValues, optionValue],
    );
  }

  return (
    <div className="planner-filter-value" role="group" aria-label={`Filter by ${field.label}`}>
      <button
        type="button"
        className="planner-filter-value-trigger"
        aria-label={`Select ${field.label} filter values`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((option) => (
            <span className="planner-filter-chip" key={option.value}>
              {option.label}
            </span>
          ))
        ) : (
          <span className="planner-filter-placeholder">Select...</span>
        )}
      </button>
      {open ? (
        <div className="planner-filter-option-list">
          {field.options.length > 0 ? (
            field.options.map((option) => (
              <label
                className="planner-filter-option"
                data-selected={selectedValues.has(option.value)}
                key={option.value}
              >
                <input
                  type="checkbox"
                  checked={selectedValues.has(option.value)}
                  onChange={() => toggleValue(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))
          ) : (
            <span className="planner-filter-empty">No options</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function tableViewFilterFieldConfigs(
  filterOptions: PlannerFilterOptions,
  allowedFields: readonly PlannerFilterField[],
): PlannerFilterFieldConfig[] {
  const configs: Record<PlannerFilterField, PlannerFilterFieldConfig> = {
    title: { field: "title", label: "Title", type: "text", options: [] },
    date: { field: "date", label: "Date", type: "date", options: [] },
    content: { field: "content", label: "Content", type: "text", options: [] },
    entry_type: {
      field: "entry_type",
      label: "Type",
      type: "select",
      options: filterOptions.daily.statuses,
    },
    account: {
      field: "account",
      label: "Account",
      type: "relation",
      options: filterOptions.daily.areas,
    },
    category: {
      field: "category",
      label: "Category",
      type: "relation",
      options: filterOptions.daily.projects,
    },
    amount: { field: "amount", label: "Amount", type: "number", options: [] },
    name: { field: "name", label: "Name", type: "text", options: [] },
    account_type: {
      field: "account_type",
      label: "Type",
      type: "relation",
      options: filterOptions.daily.areas,
    },
    currency: {
      field: "currency",
      label: "Currency",
      type: "relation",
      options: filterOptions.daily.projects,
    },
    current_balance: {
      field: "current_balance",
      label: "Current balance",
      type: "number",
      options: [],
    },
    kind: {
      field: "kind",
      label: "Kind",
      type: "select",
      options: filterOptions.daily.statuses,
    },
    status: {
      field: "status",
      label: "Status",
      type: "select",
      options: filterOptions.daily.statuses,
    },
    tags: {
      field: "tags",
      label: "Tags",
      type: "multiSelect",
      options: filterOptions.daily.tags,
    },
    area: {
      field: "area",
      label: "Area",
      type: "relation",
      options: filterOptions.daily.areas,
    },
    project: {
      field: "project",
      label: "Project",
      type: "relation",
      options: filterOptions.daily.projects,
    },
    routine: {
      field: "routine",
      label: "Routine",
      type: "relation",
      options: filterOptions.daily.routines,
    },
    scheduled: { field: "scheduled", label: "Scheduled", type: "date", options: [] },
    due: { field: "due", label: "Due", type: "date", options: [] },
    priority: {
      field: "priority",
      label: "Priority",
      type: "select",
      options: filterOptions.daily.priorities,
    },
    recurrence_rule: {
      field: "recurrence_rule",
      label: "Recurrence Rule",
      type: "text",
      options: [],
    },
    materialization_policy: {
      field: "materialization_policy",
      label: "Materialization Policy",
      type: "select",
      options: filterOptions.daily.materializationPolicies,
    },
    location: { field: "location", label: "Location", type: "text", options: [] },
    participants: {
      field: "participants",
      label: "Participants",
      type: "multiSelect",
      options: filterOptions.daily.participants,
    },
    commitment_type: {
      field: "commitment_type",
      label: "Commitment Type",
      type: "text",
      options: [],
    },
    description: { field: "description", label: "Description", type: "text", options: [] },
    note: { field: "note", label: "Note", type: "text", options: [] },
    horizon: {
      field: "horizon",
      label: "Horizon",
      type: "select",
      options: filterOptions.daily.horizons,
    },
    parent: {
      field: "parent",
      label: "Parent",
      type: "relation",
      options: filterOptions.daily.parents,
    },
  };

  return allowedFields.map((field) => configs[field]);
}

function tableViewFilterFieldWithStoredOptions(
  filterOptions: PlannerFilterOptions,
  field: PlannerFilterFieldConfig,
  rule: PlannerFilterRule,
): PlannerFilterFieldConfig {
  if (field.type !== "select" && field.type !== "multiSelect" && field.type !== "relation") {
    return field;
  }

  const availableValues = new Set(field.options.map((option) => option.value));
  const storedValues = (Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")])
    .filter(Boolean);
  const unavailableOptions = storedValues
    .filter((value) => !availableValues.has(value))
    .map((value) => ({
      value,
      label: filterOptions.storedRelationLabels?.[field.field]?.[value] ?? value,
    }));

  return unavailableOptions.length === 0
    ? field
    : { ...field, options: [...field.options, ...unavailableOptions] };
}

function addTableViewRule(
  adapter: TableViewControlsAdapter,
  field: PlannerFilterFieldConfig | undefined,
) {
  if (!field) return;
  adapter.update((current) => ({
    ...current,
    filterRules: [
      ...current.filterRules,
      ruleForField(
        `filter-${field.field}-${current.filterRules.length}-${Date.now()}`,
        field,
      ),
    ],
  }));
}

function updateTableViewRule(
  adapter: TableViewControlsAdapter,
  ruleId: string,
  patch: Partial<PlannerFilterRule>,
) {
  adapter.update((current) => ({
    ...current,
    filterRules: current.filterRules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...patch } : rule),
  }));
}

function ruleForField(
  id: string,
  field: PlannerFilterFieldConfig,
): PlannerFilterRule {
  return {
    id,
    field: field.field,
    type: field.type,
    operator: defaultOperatorForFilterType(field.type),
    value: defaultValueForFilterType(field.type),
  };
}

function defaultOperatorForFilterType(
  type: PlannerFilterType,
): PlannerFilterOperator {
  if (type === "text" || type === "multiSelect") return "contains";
  return "is";
}

function defaultValueForFilterType(type: PlannerFilterType): PlannerFilterValue {
  if (type === "select" || type === "multiSelect" || type === "relation") return [];
  return "";
}

function operatorsForFilterType(
  type: PlannerFilterType,
): PlannerFilterOperator[] {
  if (type === "date") {
    return [
      "is",
      "is_not",
      "is_before",
      "is_after",
      "is_on_or_before",
      "is_on_or_after",
      "is_empty",
      "is_not_empty",
    ];
  }
  if (type === "number") {
    return ["is", "is_not", "greater_than", "less_than", "is_empty", "is_not_empty"];
  }
  if (type === "text") {
    return [
      "contains",
      "does_not_contain",
      "is",
      "is_not",
      "starts_with",
      "ends_with",
      "is_empty",
      "is_not_empty",
    ];
  }
  return [
    "is",
    "is_not",
    "contains",
    "does_not_contain",
    "is_empty",
    "is_not_empty",
  ];
}

function operatorLabel(operator: PlannerFilterOperator): string {
  return operator.replaceAll("_", " ");
}

function formatTableViewFilterMode(mode: PlannerFilterMode): string {
  return mode === "and" ? "And" : "Or";
}

function setTableViewSortRules(
  adapter: TableViewControlsAdapter,
  rules: PlannerSortRule[],
) {
  adapter.update((current) => ({ ...current, sortRules: rules }));
}

function newTableViewSortRule(field: PlannerSortBy): PlannerSortRule {
  return {
    id: `sort-${field}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    field,
    direction: "asc",
  };
}

function tableViewSortFieldOptions(
  adapter: Pick<
    TableViewControlsAdapter,
    "filterFields" | "sortFields" | "filterOptions"
  >,
): PlannerSortFieldOption[] {
  const fields: PlannerSortFieldOption[] = tableViewFilterFieldConfigs(
    adapter.filterOptions,
    adapter.filterFields,
  ).map((field) => ({
    value: field.field as PlannerSortBy,
    label: field.label,
  }));
  const seen = new Set<PlannerSortBy>();
  const allFields: PlannerSortFieldOption[] = [
    ...fields,
    { value: "updated", label: "Updated" },
  ];

  return allFields.filter((field) => {
    if (!adapter.sortFields.includes(field.value)) return false;
    if (seen.has(field.value)) return false;
    seen.add(field.value);
    return true;
  });
}

function effectiveTableViewGroupValue(
  groupOptions: Option<PlannerGroupBy>[],
  value: PlannerGroupBy,
): PlannerGroupBy {
  return groupOptions.some((option) => option.value === value) ? value : "none";
}

function tableViewControlLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function tableViewControlDropdownStyle(
  trigger: HTMLElement,
  popover: HTMLElement,
): React.CSSProperties {
  const viewportMargin = 16;
  const offset = 4;
  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const width = Math.min(
    popoverRect.width || 320,
    Math.max(0, window.innerWidth - viewportMargin * 2),
  );
  const popoverHeight = popoverRect.height || popover.scrollHeight || 0;
  const belowSpace = Math.max(
    0,
    window.innerHeight - viewportMargin - triggerRect.bottom - offset,
  );
  const aboveSpace = Math.max(0, triggerRect.top - viewportMargin - offset);
  const placeAbove = belowSpace < popoverHeight && aboveSpace > belowSpace;
  const availableHeight = placeAbove ? aboveSpace : belowSpace;
  const renderedHeight = Math.min(
    popoverHeight,
    Math.max(1, availableHeight || popoverHeight),
  );
  const maxLeft = Math.max(
    viewportMargin,
    window.innerWidth - viewportMargin - width,
  );
  const left = Math.min(Math.max(triggerRect.left, viewportMargin), maxLeft);
  const rawTop = placeAbove
    ? triggerRect.top - offset - renderedHeight
    : triggerRect.bottom + offset;
  const maxTop = Math.max(
    viewportMargin,
    window.innerHeight - viewportMargin - renderedHeight,
  );
  const top = Math.min(Math.max(rawTop, viewportMargin), maxTop);
  const roundedWidth = `${Math.round(width)}px`;

  return {
    position: "fixed",
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: roundedWidth,
    minWidth: roundedWidth,
    maxWidth: roundedWidth,
    maxHeight: `${Math.max(0, Math.round(availableHeight))}px`,
    overflowY: "auto",
  };
}

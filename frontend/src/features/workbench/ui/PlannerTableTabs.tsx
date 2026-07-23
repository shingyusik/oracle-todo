import { Ellipsis, Plus } from "lucide-react";
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { PlannerTableId } from "@/features/workbench/model/planner-model";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

type NameEditor = {
  kind: "add" | "rename";
  tabId?: string;
  value: string;
  error: string | null;
};

export function PlannerTableTabs({
  controller,
  tableId,
  title,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  title: string;
}): React.JSX.Element {
  const tableTabs = controller.plannerTableTabs(tableId);
  const isDirty = controller.plannerTableIsDirty(tableId);
  const [focusedTabId, setFocusedTabId] = React.useState(tableTabs.activeTabId);
  const [openMenuTabId, setOpenMenuTabId] = React.useState<string | null>(null);
  const [nameEditor, setNameEditor] = React.useState<NameEditor | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const renameTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const focusActionsOnOpenRef = useRef(false);
  const focusCreatedTabRef = useRef(false);
  const focusRenamedTabRef = useRef<string | null>(null);
  const [overlayStyle, setOverlayStyle] = React.useState<React.CSSProperties | null>(null);
  const openMenuTab = tableTabs.tabs.find((tab) => tab.id === openMenuTabId);
  const overlayOpen = openMenuTab !== undefined || nameEditor !== null;
  const actionsId = `planner-table-tab-actions-${tableId.replaceAll(".", "-")}`;

  useEffect(() => {
    if (tableTabs.tabs.some((tab) => tab.id === focusedTabId)) return;
    setFocusedTabId(tableTabs.activeTabId);
  }, [focusedTabId, tableTabs.activeTabId, tableTabs.tabs]);

  useLayoutEffect(() => {
    if (!nameEditor) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [nameEditor?.kind, nameEditor?.tabId]);

  useLayoutEffect(() => {
    if (!focusCreatedTabRef.current) return;
    focusCreatedTabRef.current = false;
    setFocusedTabId(tableTabs.activeTabId);
    tabRefs.current.get(tableTabs.activeTabId)?.focus();
  }, [tableTabs.activeTabId]);

  useLayoutEffect(() => {
    const tabId = focusRenamedTabRef.current;
    if (!tabId) return;
    focusRenamedTabRef.current = null;
    setFocusedTabId(tabId);
    tabRefs.current.get(tabId)?.focus();
  }, [tableTabs.tabs]);

  useLayoutEffect(() => {
    if (!focusActionsOnOpenRef.current || !openMenuTabId) return;
    focusActionsOnOpenRef.current = false;
    overlayRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [openMenuTabId]);

  useLayoutEffect(() => {
    if (!overlayOpen) {
      setOverlayStyle(null);
      return;
    }

    function updateOverlayPosition() {
      const trigger = nameEditor?.kind === "add"
        ? addTriggerRef.current
        : openMenuTabId
          ? menuTriggerRefs.current.get(openMenuTabId)
          : null;
      const overlay = overlayRef.current;
      if (!trigger || !overlay) return;
      setOverlayStyle(plannerTableOverlayStyle(trigger, overlay));
    }

    updateOverlayPosition();
    window.addEventListener("resize", updateOverlayPosition);
    window.addEventListener("scroll", updateOverlayPosition, true);
    return () => {
      window.removeEventListener("resize", updateOverlayPosition);
      window.removeEventListener("scroll", updateOverlayPosition, true);
    };
  }, [
    nameEditor?.error,
    nameEditor?.kind,
    nameEditor?.tabId,
    openMenuTabId,
    overlayOpen,
  ]);

  useEffect(() => {
    if (openMenuTabId && !openMenuTab) {
      setOpenMenuTabId(null);
      setNameEditor(null);
    }
  }, [openMenuTab, openMenuTabId]);

  useEffect(() => {
    if (!openMenuTabId || nameEditor?.kind === "rename") return;
    const menuTabId = openMenuTabId;

    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        event.target instanceof Node &&
        (rootRef.current?.contains(event.target) ||
          overlayRef.current?.contains(event.target))
      ) {
        return;
      }
      if (event instanceof MouseEvent && controller.plannerTabConfirmation) return;

      const trigger = menuTriggerRefs.current.get(menuTabId);
      setOpenMenuTabId(null);
      if (event instanceof KeyboardEvent) {
        trigger?.focus();
      }
    }

    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [controller.plannerTabConfirmation, nameEditor?.kind, openMenuTabId]);

  function focusTabAt(index: number) {
    const tabs = tableTabs.tabs;
    if (tabs.length === 0) return;
    const nextTab = tabs[(index + tabs.length) % tabs.length];
    setFocusedTabId(nextTab.id);
    tabRefs.current.get(nextTab.id)?.focus();
  }

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
    index: number,
  ) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusTabAt(index + (event.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFocusedTabId(tabId);
      controller.selectPlannerTableTab(tableId, tabId);
    }
  }

  function openAddEditor() {
    setOpenMenuTabId(null);
    setNameEditor({
      kind: "add",
      value: "새 보기",
      error: null,
    });
  }

  function openRenameEditor(tabId: string) {
    const tab = tableTabs.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    setNameEditor({
      kind: "rename",
      tabId,
      value: tab.name,
      error: null,
    });
  }

  function cancelNameEditor() {
    const editor = nameEditor;
    setNameEditor(null);
    if (editor?.kind === "rename") {
      if (editor.tabId) renameTriggerRefs.current.get(editor.tabId)?.focus();
    } else {
      addTriggerRef.current?.focus();
    }
  }

  function submitNameEditor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameEditor) return;
    if (nameEditor.value.trim().length === 0) {
      setNameEditor({ ...nameEditor, error: "View name is required." });
      return;
    }

    const saved = nameEditor.kind === "add"
      ? controller.createPlannerTableTab(tableId, nameEditor.value)
      : controller.renamePlannerTableTab(tableId, nameEditor.tabId ?? "", nameEditor.value);
    if (!saved) {
      setNameEditor({ ...nameEditor, error: "View name is required." });
      return;
    }

    if (nameEditor.kind === "add") {
      focusCreatedTabRef.current = true;
    } else if (nameEditor.tabId) {
      focusRenamedTabRef.current = nameEditor.tabId;
    }
    setNameEditor(null);
    setOpenMenuTabId(null);
  }

  return (
    <>
      <div
        ref={rootRef}
        className="planner-table-tabs"
        role="tablist"
        aria-label={`${title} views`}
        data-planner-table-id={tableId}
      >
        {tableTabs.tabs.map((tab, index) => {
          const isActive = tab.id === tableTabs.activeTabId;
          const tabIsDirty = isActive && isDirty;
          const menuOpen = openMenuTabId === tab.id;
          return (
            <div className="planner-table-tab-item" key={tab.id}>
              <button
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.id, element);
                  else tabRefs.current.delete(tab.id);
                }}
                className="planner-table-tab"
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={tabIsDirty
                  ? `${tab.name}, 저장되지 않은 변경사항`
                  : tab.name}
                tabIndex={focusedTabId === tab.id ? 0 : -1}
                onClick={() => {
                  setFocusedTabId(tab.id);
                  controller.selectPlannerTableTab(tableId, tab.id);
                }}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id, index)}
              >
                <span>{tab.name}</span>
                {tabIsDirty ? (
                  <span className="planner-table-tab-dirty" aria-hidden="true">•</span>
                ) : null}
              </button>
              <button
                ref={(element) => {
                  if (element) menuTriggerRefs.current.set(tab.id, element);
                  else menuTriggerRefs.current.delete(tab.id);
                }}
                className="planner-table-tab-menu-trigger"
                type="button"
                aria-label={`Open ${tab.name} view menu`}
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? actionsId : undefined}
                onClick={() => {
                  setNameEditor(null);
                  setOpenMenuTabId((current) => {
                    focusActionsOnOpenRef.current = current !== tab.id;
                    return current === tab.id ? null : tab.id;
                  });
                }}
              >
                <Ellipsis size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <div className="planner-table-tab-add">
          <button
            ref={addTriggerRef}
            className="planner-table-tab-add-trigger"
            type="button"
            aria-label={`Add ${title} view`}
            aria-haspopup="dialog"
            aria-expanded={nameEditor?.kind === "add"}
            onClick={openAddEditor}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {overlayOpen
        ? createPortal(
            <div
              ref={overlayRef}
              className="planner-table-tab-overlay"
              style={overlayStyle ?? undefined}
            >
              {openMenuTab ? (
                <div
                  id={actionsId}
                  className="planner-table-tab-menu"
                  role="group"
                  aria-label={`${openMenuTab.name} view actions`}
                >
                  {openMenuTab.id === tableTabs.activeTabId ? (
                    <button
                      type="button"
                      disabled={!isDirty}
                      onClick={() => {
                        controller.savePlannerTableTab(tableId);
                        setOpenMenuTabId(null);
                        menuTriggerRefs.current.get(openMenuTab.id)?.focus();
                      }}
                    >
                      Save current settings
                    </button>
                  ) : null}
                  <button
                    ref={(element) => {
                      if (element) renameTriggerRefs.current.set(openMenuTab.id, element);
                      else renameTriggerRefs.current.delete(openMenuTab.id);
                    }}
                    type="button"
                    onClick={() => openRenameEditor(openMenuTab.id)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={tableTabs.tabs.length <= 1}
                    onClick={() =>
                      controller.requestDeletePlannerTableTab(tableId, openMenuTab.id)
                    }
                  >
                    Delete
                  </button>
                </div>
              ) : null}
              {nameEditor ? (
                <NameEditorForm
                  editor={nameEditor}
                  errorId={`planner-table-tab-name-error-${tableId.replaceAll(".", "-")}`}
                  inputRef={nameInputRef}
                  onChange={(value) => setNameEditor({ ...nameEditor, value, error: null })}
                  onCancel={cancelNameEditor}
                  onSubmit={submitNameEditor}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function plannerTableOverlayStyle(
  trigger: HTMLElement,
  overlay: HTMLElement,
): React.CSSProperties {
  const viewportMargin = 8;
  const offset = 4;
  const triggerRect = trigger.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const width = Math.min(
    overlayRect.width || 220,
    Math.max(0, window.innerWidth - viewportMargin * 2),
  );
  const height = overlayRect.height || overlay.scrollHeight || 0;
  const belowSpace = Math.max(
    0,
    window.innerHeight - viewportMargin - triggerRect.bottom - offset,
  );
  const aboveSpace = Math.max(0, triggerRect.top - viewportMargin - offset);
  const placeAbove = belowSpace < height && aboveSpace > belowSpace;
  const availableHeight = placeAbove ? aboveSpace : belowSpace;
  const renderedHeight = Math.min(height, Math.max(1, availableHeight || height));
  const maxLeft = Math.max(viewportMargin, window.innerWidth - viewportMargin - width);
  const left = Math.min(Math.max(triggerRect.left, viewportMargin), maxLeft);
  const rawTop = placeAbove
    ? triggerRect.top - offset - renderedHeight
    : triggerRect.bottom + offset;
  const maxTop = Math.max(
    viewportMargin,
    window.innerHeight - viewportMargin - renderedHeight,
  );
  const top = Math.min(Math.max(rawTop, viewportMargin), maxTop);

  return {
    position: "fixed",
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.max(0, Math.round(availableHeight))}px`,
    overflowY: "auto",
  };
}

function NameEditorForm({
  editor,
  errorId,
  inputRef,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: NameEditor;
  errorId: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className="planner-table-tab-name-editor"
      role="dialog"
      aria-label={editor.kind === "add" ? "Add view" : "Rename view"}
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <label>
        <span>View name</span>
        <input
          ref={inputRef}
          value={editor.value}
          aria-invalid={editor.error ? "true" : undefined}
          aria-describedby={editor.error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {editor.error ? (
        <p id={errorId} className="planner-table-tab-name-error">
          {editor.error}
        </p>
      ) : null}
      <div className="planner-table-tab-name-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit">{editor.kind === "add" ? "Add" : "Rename"}</button>
      </div>
    </form>
  );
}

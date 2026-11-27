import { IconCalendar, IconDatabase } from "@tabler/icons-react";
import React from "react";

import { workbenchCopy } from "@/design/copy";
import { workbenchLayout } from "@/design/layout";
import {
  useGoogleCalendarRedirect,
  type GoogleCalendarRedirectResult,
} from "@/features/workbench/hooks/useGoogleCalendar";
import type {
  TableViewTarget,
  WorkbenchController,
} from "@/features/workbench/model/workbench-model";
import { GoogleCalendarDialog } from "@/features/workbench/ui/GoogleCalendarDialog";
import { MainPanel } from "@/features/workbench/ui/MainPanel";
import {
  TableViewTabConfirmationDialog,
  type TableViewTabConfirmationDialogAdapter,
} from "@/features/workbench/ui/TableViewTabConfirmationDialog";
import { RetentionSettingsDialog } from "@/features/workbench/ui/RetentionSettingsDialog";
import { SidebarVersion } from "@/features/workbench/ui/SidebarVersion";
import { TreeSidebar } from "@/features/workbench/ui/TreeSidebar";
import {
  focusFirst,
  useModalIsolation,
} from "@/features/workbench/ui/modal-lifecycle";

type WorkbenchWireframeProps = {
  controller: WorkbenchController;
};

export function WorkbenchWireframe({ controller }: WorkbenchWireframeProps) {
  const [navigationOpen, setNavigationOpen] = React.useState(false);
  const mobile = useMobileNavigation();
  const navigationRef = React.useRef<HTMLElement>(null);
  const navigationToggleRef = React.useRef<HTMLButtonElement>(null);
  const [retentionOpen, setRetentionOpen] = React.useState(false);
  const retentionButtonRef = React.useRef<HTMLButtonElement>(null);
  const retentionReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const [googleCalendar, setGoogleCalendar] = React.useState<{
    redirectResult: GoogleCalendarRedirectResult | null;
  } | null>(null);
  const googleCalendarButtonRef = React.useRef<HTMLButtonElement>(null);
  const googleCalendarReturnFocusRef = React.useRef<HTMLElement | null>(null);
  useModalIsolation(navigationRef, mobile && navigationOpen, "shell");
  useGoogleCalendarRedirect((redirectResult) => {
    googleCalendarReturnFocusRef.current = mobile
      ? navigationToggleRef.current
      : googleCalendarButtonRef.current;
    setGoogleCalendar({ redirectResult });
  });
  const confirmationAdapter: TableViewTabConfirmationDialogAdapter<TableViewTarget> = {
    confirmation: controller.tableViewTabConfirmation,
    confirm: controller.confirmTableViewTabAction,
    cancel: controller.cancelTableViewTabAction,
    isDirty: (target) => target.surface === "planner"
      ? controller.plannerTableIsDirty(target.scope)
      : controller.workspaceTableIsDirty(target.scope),
    activeTabId: (target) => target.surface === "planner"
      ? controller.plannerTableTabs(target.scope).activeTabId
      : controller.workspaceTableTabs(target.scope).activeTabId,
  };

  React.useLayoutEffect(() => {
    if (mobile && navigationOpen && navigationRef.current) {
      focusFirst(navigationRef.current);
    }
  }, [mobile, navigationOpen]);

  function closeNavigation(restoreFocus = true) {
    setNavigationOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => navigationToggleRef.current?.focus());
    }
  }

  function openRetention() {
    // The drawer traps focus, so close it before the dialog takes over and return focus to
    // the drawer toggle afterwards.
    retentionReturnFocusRef.current = mobile
      ? navigationToggleRef.current
      : retentionButtonRef.current;
    if (mobile) closeNavigation(false);
    setRetentionOpen(true);
  }

  function openGoogleCalendar() {
    googleCalendarReturnFocusRef.current = mobile
      ? navigationToggleRef.current
      : googleCalendarButtonRef.current;
    if (mobile) closeNavigation(false);
    setGoogleCalendar({ redirectResult: null });
  }

  function handleNavigationKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigation();
      return;
    }
    if (event.key !== "Tab" || !navigationRef.current) return;
    const focusable = Array.from(
      navigationRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (!event.shiftKey && index === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    } else if (event.shiftKey && index === 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    }
  }

  return (
    <div className="workbench-shell">
      {mobile ? (
        <button
          ref={navigationToggleRef}
          type="button"
          className="workbench-nav-toggle"
          aria-label={workbenchCopy.navigation.openLabel}
          aria-controls="raven-navigation-drawer"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(true)}
        >
          Menu
        </button>
      ) : null}
      {mobile && navigationOpen ? (
        <div
          className="workbench-nav-overlay"
          role="presentation"
          aria-hidden="true"
          onClick={() => closeNavigation()}
        />
      ) : null}
      <aside
        ref={navigationRef}
        id="raven-navigation-drawer"
        className="workbench-nav"
        data-open={!mobile || navigationOpen}
        aria-hidden={mobile && !navigationOpen ? true : undefined}
        role={mobile && navigationOpen ? "dialog" : undefined}
        aria-modal={mobile && navigationOpen ? true : undefined}
        aria-label={mobile && navigationOpen
          ? workbenchCopy.navigation.drawerLabel
          : undefined}
        onKeyDown={handleNavigationKeyDown}
      >
        <div className="workbench-logo">
          <img
            className="workbench-logo-image"
            src="/raven-mark.png"
            alt={workbenchCopy.logoAlt}
          />
          <div className="workbench-logo-copy">
            <span className="workbench-logo-wordmark">
              {workbenchCopy.logoWordmark}
            </span>
          </div>
          {mobile ? (
            <button
              type="button"
              className="workbench-nav-close"
              aria-label={workbenchCopy.navigation.closeLabel}
              onClick={() => closeNavigation()}
            >
              Close
            </button>
          ) : null}
        </div>
        <TreeSidebar
          controller={controller}
          mobile={mobile}
          ariaLabel={workbenchCopy.navigation.shellLabel}
          onNavigate={mobile ? () => closeNavigation() : undefined}
        />
        <div className="sidebar-footer">
          <button
            ref={retentionButtonRef}
            type="button"
            className="sidebar-footer-item"
            onClick={openRetention}
          >
            <IconDatabase size={14} aria-hidden="true" />
            Data retention
          </button>
          <button
            ref={googleCalendarButtonRef}
            type="button"
            className="sidebar-footer-item"
            onClick={openGoogleCalendar}
          >
            <IconCalendar size={14} aria-hidden="true" />
            Google Calendar
          </button>
          <SidebarVersion />
        </div>
      </aside>
      <MainPanel controller={controller} />
      {retentionOpen ? (
        <RetentionSettingsDialog
          returnFocusRef={retentionReturnFocusRef}
          onClose={() => setRetentionOpen(false)}
        />
      ) : null}
      {googleCalendar ? (
        <GoogleCalendarDialog
          returnFocusRef={googleCalendarReturnFocusRef}
          redirectResult={googleCalendar.redirectResult}
          onClose={() => setGoogleCalendar(null)}
        />
      ) : null}
      <TableViewTabConfirmationDialog adapter={confirmationAdapter} />
    </div>
  );
}

const mobileNavigationQuery =
  `(max-width: ${workbenchLayout.mobileBreakpointPx - 1}px)`;

function useMobileNavigation(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = mobileMediaQuery();
      if (!query) return () => undefined;
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => mobileMediaQuery()?.matches ?? false,
    () => false,
  );
}

function mobileMediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(mobileNavigationQuery)
    : null;
}

import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RetentionSettingsDialog } from "@/features/workbench/ui/RetentionSettingsDialog";

const statusPath = "/api/v1/maintenance/retention";
const previewPath = "/api/v1/maintenance/retention/preview";
const runPath = "/api/v1/maintenance/retention/run";

const lastRun = {
  run_id: "run-1",
  trigger: "scheduled",
  started_at: "2026-11-18T03:00:00Z",
  finished_at: "2026-11-18T03:00:05Z",
  outcome: "partial",
  domains: {
    todo: { status: "ok", purged: { todo_item: 4 }, skipped: { referenced: 1 } },
    ledger: { status: "failed", purged: {}, skipped: {} },
    health: { status: "ok", purged: { health_diet: 2, health_media: 1 }, skipped: {} },
  },
  backup: { name: "20261118T030000Z" },
  media_cleanup_pending: 2,
};

function statusBody(overrides: Record<string, unknown> = {}) {
  return {
    settings: { enabled: true, retention_days: 30, backup_keep: 3 },
    env_override: null,
    schedule: {
      interval_hours: 24,
      scheduler_active: true,
      next_run_at: "2026-11-20T03:00:00Z",
    },
    last_run: lastRun,
    ...overrides,
  };
}

function previewBody() {
  return {
    cutoff: "2026-10-20T00:00:00Z",
    retention_days: 30,
    domains: {
      todo: {
        status: "ok",
        counts: { todo_item: 3 },
        skipped: { routine_anchor: 1 },
        items: [
          { kind: "todo_item", id: "a", label: "Old task", archived_at: "2026-09-01T00:00:00Z" },
          { kind: "todo_item", id: "b", label: "Dropped plan", archived_at: "2026-09-02T00:00:00Z" },
        ],
        truncated: true,
      },
      ledger: { status: "not_initialized", counts: {}, skipped: {}, items: [], truncated: false },
      health: { status: "unavailable", counts: {}, skipped: {}, items: [], truncated: false },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(code: string, status: number, fields: Record<string, string[]> = {}): Response {
  return json({
    code,
    message: "server message",
    fields,
    request_id: "00000000-0000-4000-8000-000000000001",
  }, status);
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function serve(handler: Handler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof serve>, path: string, method = "GET") {
  return fetchMock.mock.calls.filter(([input, init]) =>
    String(input).split("?")[0] === path && (init?.method ?? "GET") === method);
}

function renderDialog() {
  const returnFocusRef = React.createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(<RetentionSettingsDialog onClose={onClose} returnFocusRef={returnFocusRef} />);
  return { onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RetentionSettingsDialog", () => {
  it("loads and renders settings, schedule, and the last run", async () => {
    serve(() => json(statusBody()));
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Data retention" });
    expect(await within(dialog).findByRole("checkbox", { name: "Delete archived data automatically" }))
      .toBeChecked();
    expect(within(dialog).getByRole("spinbutton", { name: "Retention days" })).toHaveValue(30);

    const last = within(dialog).getByRole("region", { name: "Last run" });
    expect(within(last).getByText("Partially completed")).toBeInTheDocument();
    expect(within(last).getByText("4 ToDo items")).toBeInTheDocument();
    expect(within(last).getByText("1 skipped: still referenced")).toBeInTheDocument();
    expect(within(last).getByText("Failed")).toBeInTheDocument();
    expect(within(last).getByText("2 diet records, 1 media file")).toBeInTheDocument();
    expect(within(dialog).getByText(/2 media files are waiting for cleanup/))
      .toBeInTheDocument();
    expect(within(dialog).getByText("Next run")).toBeInTheDocument();
  });

  it("shows a never-run state", async () => {
    serve(() => json(statusBody({ last_run: null })));
    renderDialog();
    expect(await screen.findByText("Retention has not run yet.")).toBeInTheDocument();
  });

  it("saves the toggle and days with a PUT", async () => {
    const user = userEvent.setup();
    const fetchMock = serve((url, init) => {
      if (url === statusPath && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        return json(statusBody({
          settings: { enabled: body.enabled, retention_days: body.retention_days, backup_keep: 3 },
        }));
      }
      return json(statusBody());
    });
    renderDialog();

    const toggle = await screen.findByRole("checkbox", { name: "Delete archived data automatically" });
    await user.click(toggle);
    const days = screen.getByRole("spinbutton", { name: "Retention days" });
    await user.clear(days);
    await user.type(days, "45");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Retention settings saved.");
    const puts = callsTo(fetchMock, statusPath, "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String(puts[0]![1]!.body))).toEqual({ enabled: false, retention_days: 45 });
    expect(new Headers(puts[0]![1]!.headers).get("content-type")).toBe("application/json");
  });

  it.each(["6", "3651", "12.5", ""])("rejects %j retention days without a request", async (value) => {
    const user = userEvent.setup();
    const fetchMock = serve(() => json(statusBody()));
    renderDialog();

    const days = await screen.findByRole("spinbutton", { name: "Retention days" });
    await user.clear(days);
    if (value) await user.type(days, value);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a whole number of days from 7 to 3650."))
      .toBeInTheDocument();
    expect(days).toHaveAttribute("aria-invalid", "true");
    expect(callsTo(fetchMock, statusPath, "PUT")).toHaveLength(0);
  });

  it("shows server validation errors from a rejected save", async () => {
    const user = userEvent.setup();
    serve((url, init) => init?.method === "PUT"
      ? apiError("validation_failed", 422, { retention_days: ["must be at least 7"] })
      : json(statusBody()));
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save retention settings.");
  });

  it("disables controls when the environment turns retention off", async () => {
    serve(() => json(statusBody({ env_override: "disabled" })));
    renderDialog();

    expect(await screen.findByText(/turned off by the RAVEN_RETENTION environment setting/))
      .toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Delete archived data automatically" }))
      .toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Retention days" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
  });

  it("previews counts, a truncated item list, and unavailable domains", async () => {
    const user = userEvent.setup();
    const fetchMock = serve((url) => url.startsWith(previewPath)
      ? json(previewBody())
      : json(statusBody()));
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Preview" }));
    const preview = await screen.findByRole("region", { name: "Preview" });

    expect(within(preview).getByText(/before/)).toBeInTheDocument();
    const todo = within(preview).getByRole("group", { name: "ToDo" });
    expect(within(todo).getByText("3 ToDo items")).toBeInTheDocument();
    expect(within(todo).getByText("1 skipped: routine anchor")).toBeInTheDocument();
    const table = within(todo).getByRole("table", { name: "ToDo records due for deletion" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "Old task" })).toBeInTheDocument();
    expect(within(table).getAllByRole("cell", { name: "ToDo item" })).toHaveLength(2);
    expect(within(todo).getByText("and 1 more")).toBeInTheDocument();

    expect(within(within(preview).getByRole("group", { name: "Ledger" }))
      .getByText("Not set up yet.")).toBeInTheDocument();
    expect(within(within(preview).getByRole("group", { name: "Health Journal" }))
      .getByText("Couldn't read this store.")).toBeInTheDocument();

    const previewCalls = callsTo(fetchMock, previewPath);
    expect(previewCalls).toHaveLength(1);
    expect(String(previewCalls[0]![0])).toBe(`${previewPath}?limit=50`);
  });

  it("shows when a preview finds nothing due", async () => {
    const user = userEvent.setup();
    serve((url) => url.startsWith(previewPath)
      ? json({
        ...previewBody(),
        domains: {
          todo: { status: "ok", counts: {}, skipped: {}, items: [], truncated: false },
        },
      })
      : json(statusBody()));
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Preview" }));
    const todo = await screen.findByRole("group", { name: "ToDo" });
    expect(within(todo).getByText("Nothing due.")).toBeInTheDocument();
  });

  it("confirms Run now and POSTs with the maintenance header", async () => {
    const user = userEvent.setup();
    const fetchMock = serve((url, init) => url === runPath
      ? json({ last_run: { ...lastRun, run_id: "run-2", outcome: "ok" } })
      : json(statusBody()));
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Run now" }));
    const confirm = screen.getByRole("dialog", { name: "Permanently delete archived data?" });
    expect(confirm).toHaveTextContent(/backs up/);
    expect(confirm).toHaveTextContent(/permanently deletes/);
    expect(confirm).toHaveTextContent(/30 days/);
    expect(callsTo(fetchMock, runPath, "POST")).toHaveLength(0);

    await user.click(within(confirm).getByRole("button", { name: "Back up and delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "Permanently delete archived data?",
    })).toBeNull());
    const posts = callsTo(fetchMock, runPath, "POST");
    expect(posts).toHaveLength(1);
    expect(new Headers(posts[0]![1]!.headers).get("X-Raven-Maintenance")).toBe("1");
    expect(await screen.findByRole("status")).toHaveTextContent("Retention run finished: Completed.");
  });

  it("explains an already running retention (409)", async () => {
    const user = userEvent.setup();
    serve((url) => url === runPath
      ? apiError("retention_in_progress", 409)
      : json(statusBody()));
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Run now" }));
    const confirm = screen.getByRole("dialog", { name: "Permanently delete archived data?" });
    await user.click(within(confirm).getByRole("button", { name: "Back up and delete" }));

    expect(await within(confirm).findByRole("alert"))
      .toHaveTextContent("A retention run is already in progress.");
  });

  it.each([403, 421])("explains a refused run request (%i)", async (status) => {
    const user = userEvent.setup();
    serve((url) => url === runPath ? apiError("forbidden", status) : json(statusBody()));
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Run now" }));
    const confirm = screen.getByRole("dialog", { name: "Permanently delete archived data?" });
    await user.click(within(confirm).getByRole("button", { name: "Back up and delete" }));

    expect(await within(confirm).findByRole("alert"))
      .toHaveTextContent("Raven refused the request from this page. Reload the page and try again.");
  });

  it("shows a load error with retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    serve(() => fail ? apiError("internal", 500) : json(statusBody()));
    renderDialog();

    expect(await screen.findByText("Couldn't load retention settings.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("spinbutton", { name: "Retention days" })).toHaveValue(30);
  });

  it("closes on Escape and Close", async () => {
    const user = userEvent.setup();
    serve(() => json(statusBody()));
    const { onClose } = renderDialog();

    await screen.findByRole("spinbutton", { name: "Retention days" });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reloadRavenSession } from "@/features/workbench/api/system-update";
import {
  healthPollIntervalMs,
  healthPollTimeoutMs,
  pendingUpdateStorageKey,
  versionRefreshIntervalMs,
} from "@/features/workbench/hooks/useSystemUpdate";
import { SidebarVersion, updateUnsupportedHint } from "@/features/workbench/ui/SidebarVersion";

vi.mock("@/features/workbench/api/system-update", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/workbench/api/system-update")>(),
  reloadRavenSession: vi.fn(),
}));

type VersionBody = {
  current_version: string;
  ui_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  update_supported: boolean;
  checked_at: string | null;
  check_error: null | "unavailable";
  release_url: string | null;
};

function versionBody(overrides: Partial<VersionBody> = {}): VersionBody {
  return {
    current_version: "0.5.0",
    ui_version: "0.5.0",
    latest_version: "0.5.0",
    update_available: false,
    update_supported: true,
    checked_at: "2026-11-19T01:00:00Z",
    check_error: null,
    release_url: null,
    ...overrides,
  };
}

const available = versionBody({
  latest_version: "0.6.0",
  update_available: true,
  release_url: "https://example.invalid/releases/v0.6.0",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(code: string, status: number): Response {
  return json({
    code,
    message: "server message",
    fields: {},
    request_id: "00000000-0000-4000-8000-000000000001",
  }, status);
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function installFetch(handler: Handler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function urls(fetchMock: ReturnType<typeof installFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

let activeFetch: ReturnType<typeof installFetch> | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(reloadRavenSession).mockReset();
});

afterEach(() => {
  if (activeFetch) {
    expect(urls(activeFetch).some((url) => url.includes("github.com"))).toBe(false);
    for (const url of urls(activeFetch)) {
      expect(url.startsWith("/")).toBe(true);
    }
  }
  activeFetch = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function serve(handler: Handler) {
  activeFetch = installFetch(handler);
  return activeFetch;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("SidebarVersion", () => {
  it("shows the installed version without an update button when up to date", async () => {
    const fetchMock = serve(() => json(versionBody()));
    render(<SidebarVersion />);

    expect(await screen.findByText("Raven v0.5.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Update/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
    expect(screen.queryByText("Couldn't check for updates")).toBeNull();
    expect(urls(fetchMock)).toEqual(["/api/v1/system/version"]);
  });

  it("offers an update button when a newer release is available", async () => {
    serve(() => json(available));
    render(<SidebarVersion />);

    expect(await screen.findByRole("button", { name: "Update to v0.6.0" })).toBeEnabled();
    expect(screen.getByText("Raven v0.5.0")).toBeInTheDocument();
  });

  it("never offers a version that is not newer than the installed one", async () => {
    serve(() => json(versionBody({ latest_version: "0.5.0", update_available: true })));
    render(<SidebarVersion />);

    await screen.findByText("Raven v0.5.0");
    expect(screen.queryByRole("button", { name: /Update/ })).toBeNull();
  });

  it("forces a re-check with refresh=1 when Check now is pressed", async () => {
    const fetchMock = serve((url) => json(url.includes("refresh=1") ? available : versionBody()));
    render(<SidebarVersion />);
    await screen.findByText("Raven v0.5.0");

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(await screen.findByRole("button", { name: "Update to v0.6.0" })).toBeInTheDocument();
    expect(urls(fetchMock)).toEqual([
      "/api/v1/system/version",
      "/api/v1/system/version?refresh=1",
    ]);
  });

  it("disables the update button with a wrapper hint when updates are unsupported", async () => {
    serve(() => json({ ...available, update_supported: false }));
    render(<SidebarVersion />);

    const button = await screen.findByRole("button", { name: "Update to v0.6.0" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(updateUnsupportedHint);
    expect(button.parentElement).toHaveAttribute("title", updateUnsupportedHint);
    expect(updateUnsupportedHint).toBe("Restart Raven through the npm wrapper to enable updates");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a disabled update control when unsupported even without a newer release", async () => {
    serve(() => json(versionBody({ update_supported: false })));
    render(<SidebarVersion />);

    const button = await screen.findByRole("button", { name: "Update" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(updateUnsupportedHint);
  });

  it("keeps the version visible with a quiet hint when the check failed", async () => {
    serve(() => json(versionBody({ latest_version: null, check_error: "unavailable", checked_at: null })));
    render(<SidebarVersion />);

    expect(await screen.findByText("Raven v0.5.0")).toBeInTheDocument();
    expect(screen.getByText("Couldn't check for updates")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Update/ })).toBeNull();
  });

  it("shows the hint when the version endpoint itself is unreachable", async () => {
    serve(() => {
      throw new TypeError("network down");
    });
    render(<SidebarVersion />);

    expect(await screen.findByText("Couldn't check for updates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
  });

  it("refreshes the version every 6 hours", async () => {
    vi.useFakeTimers();
    const fetchMock = serve(() => json(versionBody()));
    render(<SidebarVersion />);
    await flush();
    expect(urls(fetchMock)).toEqual(["/api/v1/system/version"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(versionRefreshIntervalMs - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(urls(fetchMock)).toEqual(["/api/v1/system/version", "/api/v1/system/version"]);
  });

  it("closes the confirmation without posting on Cancel", async () => {
    const fetchMock = serve(() => json(available));
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    const dialog = screen.getByRole("dialog", { name: "Update Raven to v0.6.0?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("posts the update, shows the overlay and reloads once Raven is back", async () => {
    let healthCalls = 0;
    const fetchMock = serve((url) => {
      if (url === "/api/v1/system/update") {
        return json({ status: "restarting", target_version: "0.6.0" }, 202);
      }
      if (url === "/healthz") {
        healthCalls += 1;
        if (healthCalls === 1) throw new TypeError("connection refused");
        if (healthCalls === 2) return new Response("bad gateway", { status: 502 });
        return json({ status: "ok", version: "0.6.0" });
      }
      return json(available);
    });
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    const dialog = screen.getByRole("dialog", { name: "Update Raven to v0.6.0?" });
    vi.useFakeTimers();
    fireEvent.click(within(dialog).getByRole("button", { name: "Update and restart" }));
    await flush();

    const post = fetchMock.mock.calls.find(([input]) => String(input) === "/api/v1/system/update");
    expect(post).toBeDefined();
    const init = post![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ target_version: "0.6.0" });
    const headers = new Headers(init.headers);
    expect(headers.get("X-Raven-Update")).toBe("1");
    expect(headers.get("content-type")).toBe("application/json");
    expect(init.credentials).toBe("same-origin");

    expect(screen.queryByRole("dialog", { name: "Update Raven to v0.6.0?" })).toBeNull();
    const overlay = screen.getByRole("alertdialog", { name: "Updating to v0.6.0" });
    expect(within(overlay).getByRole("heading", { name: "Updating to v0.6.0…" })).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem(pendingUpdateStorageKey)!))
      .toEqual({ from: "0.5.0", target: "0.6.0" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(healthPollIntervalMs * 2);
    });
    expect(healthCalls).toBe(2);
    expect(reloadRavenSession).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(healthPollIntervalMs);
    });
    expect(healthCalls).toBe(3);
    expect(reloadRavenSession).toHaveBeenCalledTimes(1);
  });

  it("reloads when Raven answers with a different version even without an observed outage", async () => {
    serve((url) => {
      if (url === "/api/v1/system/update") {
        return json({ status: "restarting", target_version: "0.6.0" }, 202);
      }
      if (url === "/healthz") return json({ status: "ok", version: "0.6.0" });
      return json(available);
    });
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(healthPollIntervalMs);
    });

    expect(reloadRavenSession).toHaveBeenCalledTimes(1);
  });

  it("reports a failure when Raven does not come back within 3 minutes", async () => {
    let healthCalls = 0;
    serve((url) => {
      if (url === "/api/v1/system/update") {
        return json({ status: "restarting", target_version: "0.6.0" }, 202);
      }
      if (url === "/healthz") {
        healthCalls += 1;
        return json({ status: "ok", version: "0.5.0" });
      }
      return json(available);
    });
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    await flush();
    expect(screen.getByRole("alertdialog", { name: "Updating to v0.6.0" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(healthPollTimeoutMs - healthPollIntervalMs);
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(healthPollIntervalMs * 2);
    });
    expect(healthCalls).toBe(healthPollTimeoutMs / healthPollIntervalMs);
    expect(reloadRavenSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Update failed, still on v0.5.0");
    expect(window.sessionStorage.getItem(pendingUpdateStorageKey)).toBeNull();
  });

  it("reports a timeout when Raven never answers", async () => {
    serve((url) => {
      if (url === "/api/v1/system/update") {
        return json({ status: "restarting", target_version: "0.6.0" }, 202);
      }
      if (url === "/healthz") throw new TypeError("connection refused");
      return json(available);
    });
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Update and restart" }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(healthPollTimeoutMs + healthPollIntervalMs);
    });

    expect(reloadRavenSession).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Update failed: Raven did not come back within 3 minutes.",
    );
  });

  it.each([
    [409, "update_in_progress", "An update is already in progress."],
    [422, "update_not_available", "This version is no longer available. Check for updates again."],
    [501, "update_unsupported", "Restart Raven through the npm wrapper to enable updates."],
    [403, "forbidden", "Raven refused the update request from this page. Reload the page and try again."],
    [401, "unauthorized", "Raven refused the update request from this page. Reload the page and try again."],
    [500, "internal", "Couldn't start the update. Try again."],
  ])("shows a %i update error inline in the dialog", async (status, code, message) => {
    serve((url) => url === "/api/v1/system/update" ? apiError(code, status) : json(available));
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    const dialog = screen.getByRole("dialog", { name: "Update Raven to v0.6.0?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update and restart" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.sessionStorage.getItem(pendingUpdateStorageKey)).toBeNull();
    expect(reloadRavenSession).not.toHaveBeenCalled();
  });

  it.each([
    // The UI authority layer rejects a wrong Origin/Host with an empty 421.
    [421, "Raven refused the update request from this page. Reload the page and try again."],
    [502, "Couldn't start the update. Try again."],
  ])("shows a bodiless %i update error inline in the dialog", async (status, message) => {
    serve((url) => url === "/api/v1/system/update"
      ? new Response(null, { status })
      : json(available));
    render(<SidebarVersion />);

    fireEvent.click(await screen.findByRole("button", { name: "Update to v0.6.0" }));
    const dialog = screen.getByRole("dialog", { name: "Update Raven to v0.6.0?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update and restart" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.sessionStorage.getItem(pendingUpdateStorageKey)).toBeNull();
    expect(reloadRavenSession).not.toHaveBeenCalled();
  });

  it("shows the successful result after the post-update reload", async () => {
    window.sessionStorage.setItem(
      pendingUpdateStorageKey,
      JSON.stringify({ from: "0.5.0", target: "0.6.0" }),
    );
    serve(() => json(versionBody({ current_version: "0.6.0", latest_version: "0.6.0" })));
    render(<SidebarVersion />);

    expect(await screen.findByRole("status")).toHaveTextContent("Updated to v0.6.0");
    expect(screen.getByText("Raven v0.6.0")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(pendingUpdateStorageKey)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss update message" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the failed result when the reload still runs the old version", async () => {
    window.sessionStorage.setItem(
      pendingUpdateStorageKey,
      JSON.stringify({ from: "0.5.0", target: "0.6.0" }),
    );
    serve(() => json(available));
    render(<SidebarVersion />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Update failed, still on v0.5.0");
    expect(window.sessionStorage.getItem(pendingUpdateStorageKey)).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Update to v0.6.0" })).toBeEnabled());
  });
});

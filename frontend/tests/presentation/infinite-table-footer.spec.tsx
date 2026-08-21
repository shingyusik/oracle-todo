import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InfiniteTableFooter } from "@/features/workbench/ui/InfiniteTableFooter";

type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];

class ObserverStub {
  static instances: ObserverStub[] = [];

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds = [0];

  constructor(
    private readonly callback: ObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? "0px";
    ObserverStub.instances.push(this);
  }

  intersect(isIntersecting = true) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function renderFooter(
  props: Partial<React.ComponentProps<typeof InfiniteTableFooter>> = {},
) {
  const defaults: React.ComponentProps<typeof InfiniteTableFooter> = {
    nextOffset: 50,
    status: "idle",
    error: null,
    loadMore: vi.fn(),
    columnCount: 6,
  };

  return render(<table>{<InfiniteTableFooter {...defaults} {...props} />}</table>);
}

describe("InfiniteTableFooter", () => {
  beforeEach(() => {
    ObserverStub.instances = [];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads when the footer enters the viewport and latches repeated intersections", () => {
    const loadMore = vi.fn();
    renderFooter({ loadMore });

    const observer = ObserverStub.instances[0];
    expect(observer?.rootMargin).toBe("240px");
    expect(observer?.observe).toHaveBeenCalledOnce();

    observer?.intersect();
    observer?.intersect();
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("does not load from a stale observer callback after status becomes loading", () => {
    const loadMore = vi.fn();
    const view = renderFooter({ loadMore });
    const observer = ObserverStub.instances[0];
    observer?.intersect();

    view.rerender(
      <table>
        <InfiniteTableFooter
          nextOffset={50}
          status="loading"
          error={null}
          loadMore={loadMore}
          columnCount={6}
        />
      </table>,
    );
    observer?.intersect();

    expect(loadMore).toHaveBeenCalledOnce();
    expect(observer?.disconnect).toHaveBeenCalledOnce();
  });

  it("supports button clicks and native keyboard activation", async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    const view = renderFooter({ loadMore });

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalledOnce();

    view.rerender(
      <table>
        <InfiniteTableFooter
          nextOffset={100}
          status="idle"
          error={null}
          loadMore={loadMore}
          columnCount={6}
        />
      </table>,
    );
    screen.getByRole("button", { name: "Load more" }).focus();
    await user.keyboard("{Enter}");
    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  it("shows a retry action and accessible safe error without replacing table rows", async () => {
    const user = userEvent.setup();
    const loadMore = vi.fn();
    render(
      <table>
        <tbody><tr><td>Existing row</td></tr></tbody>
        <InfiniteTableFooter
          nextOffset={50}
          status="error"
          error="Could not load more rows."
          loadMore={loadMore}
          columnCount={1}
        />
      </table>,
    );

    expect(screen.getByText("Existing row")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load more rows.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("renders nothing and creates no observer at the end", () => {
    const { container } = renderFooter({ nextOffset: null });

    expect(container.querySelector("tfoot")).toBeNull();
    expect(ObserverStub.instances).toHaveLength(0);
  });

  it("keeps the load button usable when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const user = userEvent.setup();
    const loadMore = vi.fn();

    renderFooter({ loadMore });
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("renders a non-interactive loading status with the requested span", () => {
    const { container } = renderFooter({ status: "loading", columnCount: 8 });

    expect(screen.getByRole("status")).toHaveTextContent("Loading more");
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("td")).toHaveAttribute("colspan", "8");
  });

  it("reconnects for new pages and disconnects on unmount", () => {
    const loadMore = vi.fn();
    const view = renderFooter({ loadMore });
    const first = ObserverStub.instances[0];

    view.rerender(
      <table>
        <InfiniteTableFooter
          nextOffset={100}
          status="idle"
          error={null}
          loadMore={loadMore}
          columnCount={6}
        />
      </table>,
    );

    expect(first?.disconnect).toHaveBeenCalledOnce();
    expect(ObserverStub.instances).toHaveLength(2);
    first?.intersect();
    expect(loadMore).not.toHaveBeenCalled();
    const second = ObserverStub.instances[1];
    view.unmount();
    expect(second?.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps its observer when only loadMore identity changes and calls the latest function", () => {
    const firstLoadMore = vi.fn();
    const latestLoadMore = vi.fn();
    const view = renderFooter({ loadMore: firstLoadMore });
    const observer = ObserverStub.instances[0];

    view.rerender(
      <table>
        <InfiniteTableFooter
          nextOffset={50}
          status="idle"
          error={null}
          loadMore={latestLoadMore}
          columnCount={6}
        />
      </table>,
    );
    observer?.intersect();

    expect(ObserverStub.instances).toHaveLength(1);
    expect(firstLoadMore).not.toHaveBeenCalled();
    expect(latestLoadMore).toHaveBeenCalledOnce();
  });

  it("ignores non-intersecting observations", () => {
    const loadMore = vi.fn();
    renderFooter({ loadMore });
    ObserverStub.instances[0]?.intersect(false);
    expect(loadMore).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useDataChanges } from "@/lib/data-changes";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  changes(domains: string[]) {
    this.dispatchEvent(new MessageEvent("changes", { data: JSON.stringify({ domains }) }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instances = [];
});

it("shares one connection, filters domains, uses current callback and closes after last unmount", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const todo = vi.fn();
  const ledger = vi.fn();
  const updated = vi.fn();
  const first = renderHook(({ callback }) => useDataChanges("todo", callback), { initialProps: { callback: todo } });
  const second = renderHook(() => useDataChanges("ledger", ledger));
  expect(FakeEventSource.instances).toHaveLength(1);
  const source = FakeEventSource.instances[0];
  expect(source.url).toBe("/api/v1/changes");
  await act(async () => source.changes(["todo"]));
  expect(todo).toHaveBeenCalledOnce();
  expect(ledger).not.toHaveBeenCalled();
  first.rerender({ callback: updated });
  await act(async () => source.changes(["todo", "ledger", "health"]));
  expect(updated).toHaveBeenCalledOnce();
  expect(ledger).toHaveBeenCalledOnce();
  first.unmount();
  expect(source.close).not.toHaveBeenCalled();
  second.unmount();
  expect(source.close).toHaveBeenCalledOnce();
});

it("coalesces changes during a refresh and ignores malformed messages", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  let finish!: () => void;
  const callback = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useDataChanges("health", callback));
  const source = FakeEventSource.instances[0];
  await act(async () => {
    source.dispatchEvent(new MessageEvent("changes", { data: "invalid" }));
    source.dispatchEvent(new MessageEvent("changes", { data: JSON.stringify({ domains: "health" }) }));
    source.changes(["health"]);
    source.changes(["health"]);
    source.changes(["health"]);
  });
  expect(callback).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(callback).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it("does not run a queued refresh after unmount", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  let finish!: () => void;
  const callback = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useDataChanges("todo", callback));
  await act(async () => {
    FakeEventSource.instances[0].changes(["todo"]);
    FakeEventSource.instances[0].changes(["todo"]);
  });
  hook.unmount();
  await act(async () => finish());
  expect(callback).toHaveBeenCalledOnce();
});

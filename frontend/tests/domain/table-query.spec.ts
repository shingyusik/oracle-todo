import { describe, expect, it } from "vitest";

import { tableFilterValue } from "@/features/workbench/model/table-query";

describe("tableFilterValue", () => {
  it("preserves every table filter wire shape", () => {
    expect(tableFilterValue(null, "is_empty")).toEqual({ empty: true });
    expect(tableFilterValue(["a", "b"], "is")).toEqual({ list: ["a", "b"] });
    expect(tableFilterValue({ start: "2026-08-01", end: "2026-08-21" }, "is_between"))
      .toEqual({ range: { start: "2026-08-01", end: "2026-08-21" } });
    expect(tableFilterValue({ amount: "2", unit: "week" }, "is_relative_to_today"))
      .toEqual({ relative: { amount: "2", unit: "week" } });
    expect(tableFilterValue("Lunch", "contains")).toEqual({ text: "Lunch" });
  });
});

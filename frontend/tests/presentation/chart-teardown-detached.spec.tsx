import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChartDonut } from "@/lib/chart-ui";
import { teardownErrors } from "../chart-teardown";

afterEach(() => { cleanup(); });

// Alone in its file: no other test may render a chart into the document first.
it("settles Recharts notifications from a chart rendered outside the document before teardown", async () => {
  render(<ChartDonut data={[{ label: "Only", value: 1, color: "green" }]} center={<span>1</span>} />,
    { container: document.createElement("div") });
  expect(await teardownErrors()).toEqual([]);
});

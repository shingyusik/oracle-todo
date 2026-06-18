import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("frontend package scripts", () => {
  it("defines the required local verification commands", () => {
    expect(packageJson.scripts).toMatchObject({
      dev: "next dev",
      build: "next build",
      test: "vitest run --no-file-parallelism",
      typecheck: "tsc --noEmit",
    });
  });
});

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";

import packageJson from "../../package.json";

describe("frontend package scripts", () => {
  it("defines the required local verification commands", () => {
    expect(packageJson.name).toBe("raven-frontend");
    expect(packageJson.scripts).toMatchObject({
      dev: "next dev",
      build: "next build",
      test: "vitest run --no-file-parallelism",
      typecheck: "tsc --noEmit",
    });
    expect(packageJson.scripts).not.toHaveProperty("dev:with-api");
  });

  it("documents only active Raven runtime environment names", async () => {
    const example = await fs.readFile("../.env.example", "utf8");

    expect(example).toContain("RAVEN_HOME=/path/to/raven-data");
    expect(example).toContain("RAVEN_CONSOLE_LOG=info");
    expect(example).not.toContain("TODO_ENGINE_");
    expect(example).not.toContain("DEV_UI_PORT");
    expect(example).not.toContain("DEV_API_PORT");
  });
});

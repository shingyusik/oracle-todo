import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";

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

  it("defines a dev command that runs the Rust API from the workspace root", async () => {
    expect(packageJson.scripts).toMatchObject({
      "dev:with-api": "node scripts/dev-with-api.mjs",
    });

    const source = await fs.readFile("scripts/dev-with-api.mjs", "utf8");

    expect(source).toContain("workspaceRoot");
    expect(source).toContain("apiAvailable");
    expect(source).toContain('start("cargo", ["run", "-p", "todo-engine", "--", "api"]');
    expect(source).toContain("cwd: workspaceRoot");
  });
});

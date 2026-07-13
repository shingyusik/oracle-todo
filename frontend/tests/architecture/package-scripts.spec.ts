import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    expect(source).toContain('start("cargo", ["run", "-p", "todo-engine", "--", "api"');
    expect(source).toContain("cwd: workspaceRoot");
  });

  it("keeps development ports separate from the packaged oracle-todo runtime", async () => {
    const source = await fs.readFile("scripts/dev-with-api.mjs", "utf8");

    expect(source).toContain("loadDevEnvironment(workspaceRoot, process.env)");
    expect(source).toContain('"--port", apiPort');
    expect(source).toContain('"--port", uiPort');
    expect(source).toContain('TODO_ENGINE_API_URL: `http://127.0.0.1:${apiPort}`');
  });

  it("loads dev ports from the workspace .env while preserving shell overrides", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-dev-env-"));
    await fs.writeFile(
      path.join(workspace, ".env"),
      [
        "TODO_ENGINE_DEV_UI_PORT=3201",
        "TODO_ENGINE_DEV_API_PORT=3202",
        "TODO_ENGINE_HOME=/tmp/oracle-todo-dev",
      ].join("\n"),
    );
    const { loadDevEnvironment } = await import(
      pathToFileURL(path.join(process.cwd(), "scripts/dev-env.mjs")).href
    );

    const fromDotEnv = loadDevEnvironment(workspace, {});
    const withShellOverride = loadDevEnvironment(workspace, {
      TODO_ENGINE_DEV_UI_PORT: "3301",
    });

    expect(fromDotEnv.TODO_ENGINE_DEV_UI_PORT).toBe("3201");
    expect(fromDotEnv.TODO_ENGINE_DEV_API_PORT).toBe("3202");
    expect(fromDotEnv.TODO_ENGINE_HOME).toBe("/tmp/oracle-todo-dev");
    expect(withShellOverride.TODO_ENGINE_DEV_UI_PORT).toBe("3301");
    expect(withShellOverride.TODO_ENGINE_DEV_API_PORT).toBe("3202");
  });
});

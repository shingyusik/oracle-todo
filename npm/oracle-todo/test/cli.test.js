const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { writeMetadata } = require("../src/cache");
const { main } = require("../src/cli");

test("dispatches install", async () => {
  const calls = [];
  await main(["install"], {
    installBundle: async () => calls.push("install"),
    log: () => {},
  });
  assert.deepEqual(calls, ["install"]);
});

test("dispatches update", async () => {
  const calls = [];
  await main(["update"], {
    updateBundle: async () => calls.push("update"),
    log: () => {},
  });
  assert.deepEqual(calls, ["update"]);
});

test("prints wrapper and installed engine version", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath: path.join(cacheRoot, "bin", "todo-engine"),
    uiVersion: "0.2.0",
    uiPath: path.join(cacheRoot, "ui"),
  });
  const lines = [];

  const code = await main(["version"], {
    env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, ["@shings/oracle-todo wrapper", "todo-engine 0.2.0", "oracle-todo-ui 0.2.0"]);
});

test("reports not installed version state", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  const lines = [];

  const code = await main(["version"], {
    env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, ["@shings/oracle-todo wrapper", "todo-engine not installed", "oracle-todo-ui not installed"]);
});

test("doctor reports the active binary path", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  const binaryPath = path.join(cacheRoot, "bin", "todo-engine");
  const uiPath = path.join(cacheRoot, "ui");
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath,
    uiPath,
  });
  const lines = [];

  const code = await main(["doctor"], {
    env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, [`cache ok: ${binaryPath}`, `ui ok: ${uiPath}`]);
});

test("doctor requires an installed engine", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));

  await assert.rejects(
    () =>
      main(["doctor"], {
        env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
        log: () => {},
      }),
    /todo-engine is not installed; run install first/
  );
});

test("doctor requires an installed ui", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath: path.join(cacheRoot, "bin", "todo-engine"),
  });

  await assert.rejects(
    () =>
      main(["doctor"], {
        env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
        log: () => {},
      }),
    /oracle-todo-ui is not installed; run install first/
  );
});

test("dispatches ui without forwarding to the engine command runner", async () => {
  const calls = [];
  const code = await main(["--home", "/tmp/todo", "ui", "--no-open"], {
    installBundle: async () => {
      calls.push(["installBundle"]);
      return { binaryPath: "/tmp/todo-engine", uiPath: "/tmp/ui", installedVersion: "0.3.0", uiVersion: "0.3.0" };
    },
    runUi: async (args) => {
      calls.push(["ui", args]);
      return 0;
    },
    runEngine: async () => {
      throw new Error("engine runner should not be called");
    },
    log: () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [["ui", ["--home", "/tmp/todo", "ui", "--no-open"]]]);
});

test("forwards normal engine commands after ensuring install", async () => {
  const calls = [];
  const code = await main(["today"], {
    installEngine: async () => calls.push(["install"]),
    runEngine: async (args) => {
      calls.push(["run", args]);
      return 4;
    },
    log: () => {},
  });

  assert.equal(code, 4);
  assert.deepEqual(calls, [["install"], ["run", ["today"]]]);
});

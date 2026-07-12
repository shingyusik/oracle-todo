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
    installEngine: async () => calls.push("install"),
    log: () => {},
  });
  assert.deepEqual(calls, ["install"]);
});

test("dispatches update", async () => {
  const calls = [];
  await main(["update"], {
    updateEngine: async () => calls.push("update"),
    log: () => {},
  });
  assert.deepEqual(calls, ["update"]);
});

test("prints wrapper and installed engine version", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath: path.join(cacheRoot, "bin", "todo-engine"),
  });
  const lines = [];

  const code = await main(["version"], {
    env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, ["@shings/oracle-todo wrapper", "todo-engine 0.2.0"]);
});

test("reports not installed version state", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  const lines = [];

  const code = await main(["version"], {
    env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, ["@shings/oracle-todo wrapper", "todo-engine not installed"]);
});

test("doctor reports the active binary path", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cli-"));
  const binaryPath = path.join(cacheRoot, "bin", "todo-engine");
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath,
  });
  const lines = [];

  const code = await main(["doctor"], {
    env: { ORACLE_TODO_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, [`cache ok: ${binaryPath}`]);
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

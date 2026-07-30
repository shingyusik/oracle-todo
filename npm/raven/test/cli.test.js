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
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath: path.join(cacheRoot, "bin", "raven"),
    uiVersion: "0.2.0",
    uiPath: path.join(cacheRoot, "ui"),
  });
  const lines = [];

  const code = await main(["version"], {
    env: { RAVEN_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, ["@shings/raven wrapper", "raven 0.2.0", "raven-ui 0.2.0"]);
});

test("reports not installed version state", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));
  const lines = [];

  const code = await main(["version"], {
    env: { RAVEN_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, ["@shings/raven wrapper", "raven not installed", "raven-ui not installed"]);
});

test("doctor reports the active binary path", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));
  const binaryPath = path.join(cacheRoot, "bin", "raven");
  const uiPath = path.join(cacheRoot, "ui");
  await fs.mkdir(path.dirname(binaryPath), { recursive: true });
  await fs.writeFile(binaryPath, "#!/bin/sh\n", { mode: 0o755 });
  await fs.mkdir(uiPath, { recursive: true });
  await fs.writeFile(path.join(uiPath, "index.html"), "<!doctype html>");
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath,
    uiPath,
  });
  const lines = [];

  const code = await main(["doctor"], {
    env: { RAVEN_CACHE_DIR: cacheRoot },
    log: (line) => lines.push(line),
  });

  assert.equal(code, 0);
  assert.deepEqual(lines, [`cache ok: ${binaryPath}`, `ui ok: ${uiPath}`]);
});

test("doctor requires an installed engine", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));

  await assert.rejects(
    () =>
      main(["doctor"], {
        env: { RAVEN_CACHE_DIR: cacheRoot },
        log: () => {},
      }),
    /raven is not installed; run install first/
  );
});

test("doctor requires an installed ui", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));
  const binaryPath = path.join(cacheRoot, "bin", "raven");
  await fs.mkdir(path.dirname(binaryPath), { recursive: true });
  await fs.writeFile(binaryPath, "#!/bin/sh\n", { mode: 0o755 });
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath,
  });

  await assert.rejects(
    () =>
      main(["doctor"], {
        env: { RAVEN_CACHE_DIR: cacheRoot },
        log: () => {},
      }),
    /raven-ui is not installed; run install first/
  );
});

test("doctor rejects stale binary metadata", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));
  const uiPath = path.join(cacheRoot, "ui");
  await fs.mkdir(uiPath, { recursive: true });
  await fs.writeFile(path.join(uiPath, "index.html"), "<!doctype html>");
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath: path.join(cacheRoot, "bin", "missing-raven"),
    uiVersion: "0.2.0",
    uiPath,
  });

  await assert.rejects(
    () => main(["doctor"], {
      env: { RAVEN_CACHE_DIR: cacheRoot },
      log: () => {},
    }),
    /raven binary is missing or unusable; run install first/
  );
});

test("doctor rejects a missing UI index", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-cli-"));
  const binaryPath = path.join(cacheRoot, "bin", "raven");
  const uiPath = path.join(cacheRoot, "ui");
  await fs.mkdir(path.dirname(binaryPath), { recursive: true });
  await fs.writeFile(binaryPath, "#!/bin/sh\n", { mode: 0o755 });
  await fs.mkdir(uiPath, { recursive: true });
  await writeMetadata(cacheRoot, {
    installedVersion: "0.2.0",
    binaryPath,
    uiVersion: "0.2.0",
    uiPath,
  });

  await assert.rejects(
    () => main(["doctor"], {
      env: { RAVEN_CACHE_DIR: cacheRoot },
      log: () => {},
    }),
    /raven-ui is missing or unusable; run install first/
  );
});

test("dispatches ui to the native Raven UI launcher", async () => {
  const calls = [];
  const code = await main(["--home", "/tmp/todo", "ui", "--no-open"], {
    installBundle: async () => {
      calls.push(["installBundle"]);
      return { binaryPath: "/tmp/raven", uiPath: "/tmp/ui", installedVersion: "0.3.0", uiVersion: "0.3.0" };
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

test("forwards ui values in domain commands without starting the UI", async () => {
  const calls = [];
  const code = await main(["todo", "task", "create", "--title", "ui"], {
    installEngine: async () => {
      calls.push(["install"]);
      return { binaryPath: "/tmp/raven" };
    },
    runUi: async () => {
      throw new Error("UI runtime should not be called");
    },
    runEngine: async (args, { binaryPath }) => {
      calls.push(["run", args, binaryPath]);
      return 0;
    },
    log: () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [["install"], ["run", ["todo", "task", "create", "--title", "ui"], "/tmp/raven"]]);
});

test("forwards Raven domain arguments unchanged after ensuring install", async () => {
  const calls = [];
  const code = await main(["ledger", "entry", "list"], {
    installEngine: async () => calls.push(["install"]),
    runEngine: async (args) => {
      calls.push(["run", args]);
      return 4;
    },
    log: () => {},
  });

  assert.equal(code, 4);
  assert.deepEqual(calls, [["install"], ["run", ["ledger", "entry", "list"]]]);
});

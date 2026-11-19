const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runUi } = require("../src/ui-command");

const OLD = { binaryPath: "/tmp/raven", uiPath: "/tmp/raven-ui/0.3.0", installedVersion: "0.3.0", uiVersion: "0.3.0" };
const NEW = { binaryPath: "/tmp/raven", uiPath: "/tmp/raven-ui/0.4.0", installedVersion: "0.4.0", uiVersion: "0.4.0" };

async function tempCache(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raven-ui-supervisor-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function readStatus(cacheRoot) {
  return JSON.parse(await fs.readFile(path.join(cacheRoot, "update-status.json"), "utf8"));
}

function scriptedEngine(codes, calls) {
  return async (args, options) => {
    calls.push({ args, binaryPath: options.binaryPath, env: options.env });
    return codes.shift();
  };
}

function fakeSpawn(calls, exitCode = 0) {
  return (command, args) => {
    calls.push([command, ...args]);
    const child = new EventEmitter();
    setImmediate(() => child.emit("close", exitCode));
    return child;
  };
}

function supervisorOptions(cacheRoot, overrides = {}) {
  return {
    env: {},
    cacheRoot,
    log: () => {},
    platform: "darwin",
    getuid: () => 501,
    spawnImpl: () => {
      throw new Error("launchctl must not run");
    },
    signalSource: new EventEmitter(),
    now: () => new Date("2026-11-19T00:00:00.000Z"),
    installBundle: async () => OLD,
    ...overrides,
  };
}

test("delegates UI startup to the native raven ui command", async () => {
  const calls = [];
  const code = await runUi(["--home", "/tmp/raven-home", "ui", "--no-open"], {
    env: { PATH: "/usr/bin" },
    signalSource: new EventEmitter(),
    installBundle: async () => OLD,
    runEngine: scriptedEngine([7], calls),
  });

  assert.equal(code, 7);
  assert.deepEqual(calls, [{
    args: ["--home", "/tmp/raven-home", "ui", "--ui-path", OLD.uiPath, "--no-open"],
    binaryPath: "/tmp/raven",
    env: {
      PATH: "/usr/bin",
      RAVEN_UPDATE_SUPERVISOR: "1",
      RAVEN_BUNDLE_VERSION: "0.3.0",
      RAVEN_UI_VERSION: "0.3.0",
    },
  }]);
});

test("preserves an explicit native UI artifact path", async () => {
  const calls = [];
  await runUi(["ui", "--ui-path=/tmp/custom-ui", "--port", "3102"], {
    env: {},
    signalSource: new EventEmitter(),
    installBundle: async () => OLD,
    runEngine: scriptedEngine([0], calls),
  });

  assert.deepEqual(calls[0].args, ["ui", "--ui-path=/tmp/custom-ui", "--port", "3102"]);
  assert.equal(calls[0].env.RAVEN_UI_VERSION, undefined);
  assert.equal(calls[0].env.RAVEN_BUNDLE_VERSION, "0.3.0");
});

test("does not mistake a spaced home value named ui for the subcommand", async () => {
  const calls = [];
  await runUi(["--home", "ui", "ui", "--no-open"], {
    env: {},
    signalSource: new EventEmitter(),
    installBundle: async () => OLD,
    runEngine: scriptedEngine([0], calls),
  });

  assert.deepEqual(calls[0].args, ["--home", "ui", "ui", "--ui-path", OLD.uiPath, "--no-open"]);
});

test("requires a native ui subcommand", async () => {
  await assert.rejects(
    () => runUi(["ledger", "entry", "list"], {
      installBundle: async () => OLD,
      runEngine: async () => 0,
    }),
    /native raven ui command/
  );
});

test("exit 75 updates the bundle and relaunches with the new UI path", async (t) => {
  const cacheRoot = await tempCache(t);
  const calls = [];
  const updates = [];
  const launchctl = [];
  const code = await runUi(["ui", "--no-open"], supervisorOptions(cacheRoot, {
    env: { RAVEN_UPDATE_RESTART_LABELS: " com.raven.mcp, ,com.raven.other " },
    spawnImpl: fakeSpawn(launchctl),
    updateBundle: async (options) => {
      updates.push(options);
      assert.deepEqual(launchctl, [], "services restart only after the update succeeds");
      return { status: "installed", ...NEW };
    },
    runEngine: scriptedEngine([75, 0], calls),
  }));

  assert.equal(code, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].requireNewer, true);
  assert.equal(updates[0].cacheRoot, cacheRoot);
  assert.deepEqual(calls.map((call) => call.args), [
    ["ui", "--ui-path", OLD.uiPath, "--no-open"],
    ["ui", "--ui-path", NEW.uiPath, "--no-open"],
  ]);
  assert.equal(calls[1].env.RAVEN_BUNDLE_VERSION, "0.4.0");
  assert.equal(calls[1].env.RAVEN_UI_VERSION, "0.4.0");
  assert.deepEqual(launchctl, [
    ["launchctl", "kickstart", "-k", "gui/501/com.raven.mcp"],
    ["launchctl", "kickstart", "-k", "gui/501/com.raven.other"],
  ]);
  assert.deepEqual(await readStatus(cacheRoot), {
    at: "2026-11-19T00:00:00.000Z",
    from: "0.3.0",
    to: "0.4.0",
    ok: true,
    error: null,
  });
});

test("failed update logs, records status, and relaunches the old version", async (t) => {
  const cacheRoot = await tempCache(t);
  const calls = [];
  const lines = [];
  const code = await runUi(["ui"], supervisorOptions(cacheRoot, {
    env: { RAVEN_UPDATE_RESTART_LABELS: "com.raven.mcp" },
    log: (line) => lines.push(line),
    updateBundle: async () => {
      throw new Error("Checksum mismatch for raven-ui-0.4.0.tar.gz");
    },
    runEngine: scriptedEngine([75, 3], calls),
  }));

  assert.equal(code, 3);
  assert.deepEqual(calls.map((call) => call.args), [
    ["ui", "--ui-path", OLD.uiPath],
    ["ui", "--ui-path", OLD.uiPath],
  ]);
  assert.equal(calls[1].env.RAVEN_BUNDLE_VERSION, "0.3.0");
  assert.ok(lines.some((line) => /update failed, relaunching 0\.3\.0/.test(line)));
  assert.deepEqual(await readStatus(cacheRoot), {
    at: "2026-11-19T00:00:00.000Z",
    from: "0.3.0",
    to: null,
    ok: false,
    error: "Checksum mismatch for raven-ui-0.4.0.tar.gz",
  });
});

test("an update that finds no newer release relaunches the old version", async (t) => {
  const cacheRoot = await tempCache(t);
  const calls = [];
  await runUi(["ui"], supervisorOptions(cacheRoot, {
    env: { RAVEN_UPDATE_RESTART_LABELS: "com.raven.mcp" },
    updateBundle: async () => ({ status: "up-to-date", ...OLD }),
    runEngine: scriptedEngine([75, 0], calls),
  }));

  assert.equal(calls[1].args[2], OLD.uiPath);
  const status = await readStatus(cacheRoot);
  assert.equal(status.ok, false);
  assert.match(status.error, /no release newer than 0\.3\.0/);
});

test("explicit --ui-path is preserved across an update relaunch", async (t) => {
  const cacheRoot = await tempCache(t);
  const calls = [];
  await runUi(["ui", "--ui-path", "/tmp/custom-ui"], supervisorOptions(cacheRoot, {
    updateBundle: async () => ({ status: "installed", ...NEW }),
    runEngine: scriptedEngine([75, 0], calls),
  }));

  assert.deepEqual(calls.map((call) => call.args), [
    ["ui", "--ui-path", "/tmp/custom-ui"],
    ["ui", "--ui-path", "/tmp/custom-ui"],
  ]);
  assert.equal(calls[1].env.RAVEN_BUNDLE_VERSION, "0.4.0");
});

test("non-75 exit codes pass through without updating", async (t) => {
  const cacheRoot = await tempCache(t);
  for (const exitCode of [0, 1, 74, 76]) {
    const calls = [];
    const code = await runUi(["ui"], supervisorOptions(cacheRoot, {
      updateBundle: async () => {
        throw new Error("must not update");
      },
      runEngine: scriptedEngine([exitCode], calls),
    }));
    assert.equal(code, exitCode);
    assert.equal(calls.length, 1);
  }
  await assert.rejects(() => fs.access(path.join(cacheRoot, "update-status.json")));
});

test("restart labels are skipped off darwin", async (t) => {
  const cacheRoot = await tempCache(t);
  const launchctl = [];
  const lines = [];
  await runUi(["ui"], supervisorOptions(cacheRoot, {
    env: { RAVEN_UPDATE_RESTART_LABELS: "com.raven.mcp" },
    platform: "linux",
    log: (line) => lines.push(line),
    spawnImpl: fakeSpawn(launchctl),
    updateBundle: async () => ({ status: "installed", ...NEW }),
    runEngine: scriptedEngine([75, 0], []),
  }));

  assert.deepEqual(launchctl, []);
  assert.ok(lines.some((line) => /skipping service restart on linux/.test(line)));
});

test("restart failures are logged and never fatal", async (t) => {
  const cacheRoot = await tempCache(t);
  const launchctl = [];
  const lines = [];
  const calls = [];
  const code = await runUi(["ui"], supervisorOptions(cacheRoot, {
    env: { RAVEN_UPDATE_RESTART_LABELS: "com.raven.mcp,bad label;rm" },
    log: (line) => lines.push(line),
    spawnImpl: fakeSpawn(launchctl, 113),
    updateBundle: async () => ({ status: "installed", ...NEW }),
    runEngine: scriptedEngine([75, 0], calls),
  }));

  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(launchctl, [["launchctl", "kickstart", "-k", "gui/501/com.raven.mcp"]]);
  assert.ok(lines.some((line) => /failed to restart com\.raven\.mcp/.test(line)));
  assert.ok(lines.some((line) => /skipping invalid launchd label/.test(line)));
});

test("termination signals are forwarded to the child and end the loop", async (t) => {
  const cacheRoot = await tempCache(t);
  const signals = new EventEmitter();
  const killed = [];
  let spawns = 0;
  const code = await runUi(["ui"], supervisorOptions(cacheRoot, {
    signalSource: signals,
    updateBundle: async () => {
      throw new Error("must not update after a signal");
    },
    runEngine: async (_args, { onSpawn }) => {
      spawns += 1;
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = (signal) => killed.push(signal);
      onSpawn(child);
      signals.emit("SIGTERM");
      return 75;
    },
  }));

  assert.equal(code, 75);
  assert.equal(spawns, 1);
  assert.deepEqual(killed, ["SIGTERM"]);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    assert.equal(signals.listenerCount(signal), 0);
  }
});

test("a signal during the update finishes it without relaunching", async (t) => {
  const cacheRoot = await tempCache(t);
  const signals = new EventEmitter();
  const calls = [];
  const code = await runUi(["ui"], supervisorOptions(cacheRoot, {
    signalSource: signals,
    updateBundle: async () => {
      signals.emit("SIGINT");
      return { status: "installed", ...NEW };
    },
    runEngine: scriptedEngine([75, 0], calls),
  }));

  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal((await readStatus(cacheRoot)).ok, true);
});

test("forwards SIGTERM to a real native child process", async (t) => {
  const cacheRoot = await tempCache(t);
  const { runEngine } = require("../src/runner");
  const engine = path.join(cacheRoot, "engine.js");
  await fs.writeFile(engine, "setInterval(() => {}, 1000); process.on('SIGTERM', () => process.exit(75));");
  const signals = new EventEmitter();
  const code = await runUi(["ui"], supervisorOptions(cacheRoot, {
    signalSource: signals,
    installBundle: async () => ({ ...OLD, binaryPath: process.execPath, uiPath: engine }),
    updateBundle: async () => {
      throw new Error("must not update after a signal");
    },
    runEngine: (args, options) => {
      setTimeout(() => signals.emit("SIGTERM"), 100);
      // Run `node <engine>` by dropping the wrapper-injected `ui --ui-path` prefix.
      return runEngine([args[2]], { ...options, stdio: "ignore" });
    },
  }));

  assert.equal(code, 75);
});

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { parseUiArgs, runUi } = require("../src/ui-command");

test("parses ui ports and browser option while preserving engine args", () => {
  assert.deepEqual(parseUiArgs(["--home", "/tmp/todo", "ui", "--no-open", "--ui-port", "3101", "--api-port", "3102"]), {
    engineArgs: ["--home", "/tmp/todo"],
    uiPort: 3101,
    apiPort: 3102,
    openBrowser: false,
  });
});

test("uses default ui command ports", () => {
  assert.deepEqual(parseUiArgs(["ui"]), {
    engineArgs: [],
    uiPort: 3001,
    apiPort: 3002,
    openBrowser: true,
  });
});

function createChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0);
  };
  return child;
}

function createServer() {
  const server = new EventEmitter();
  server.closed = false;
  server.listen = (_port, _host, callback) => callback();
  server.close = (callback) => {
    server.closed = true;
    callback();
  };
  return server;
}

function runtimeOptions({ child = createChild(), server = createServer(), openBrowser } = {}) {
  return {
    installBundle: async () => ({ binaryPath: "/tmp/todo-engine", uiPath: "/tmp/ui" }),
    spawnApi: () => child,
    createUiServer: () => server,
    waitForPort: async () => {},
    openBrowser,
    log: () => {},
  };
}

test("opens the browser by default", async () => {
  const child = createChild();
  const server = createServer();
  const opened = [];
  const running = runUi(["ui"], runtimeOptions({ child, server, openBrowser: async (url) => opened.push(url) }));

  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 0);
  await running;

  assert.deepEqual(opened, ["http://127.0.0.1:3001"]);
});

test("does not open the browser with --no-open", async () => {
  const child = createChild();
  const server = createServer();
  let opened = false;
  const running = runUi(["ui", "--no-open"], runtimeOptions({ child, server, openBrowser: async () => { opened = true; } }));

  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 0);
  await running;

  assert.equal(opened, false);
});

test("closes the UI server and API process when the API exits", async () => {
  const child = createChild();
  const server = createServer();
  const running = runUi(["ui", "--no-open"], runtimeOptions({ child, server }));

  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 0);
  await running;

  assert.equal(server.closed, true);
  assert.equal(child.killed, false);
});

test("stops the API process when the UI server fails to listen", async () => {
  const child = createChild();
  const server = new EventEmitter();
  server.listen = () => server.emit("error", new Error("address in use"));
  server.close = (callback) => callback();

  await assert.rejects(
    runUi(["ui", "--no-open"], runtimeOptions({ child, server })),
    /address in use/,
  );

  assert.equal(child.killed, true);
});

test("rejects and cleans up when the API process emits a spawn error", async () => {
  const child = createChild();
  const options = runtimeOptions({ child });
  delete options.waitForPort;
  options.spawnApi = () => {
    process.nextTick(() => child.emit("error", new Error("spawn failed")));
    return child;
  };

  await assert.rejects(runUi(["ui", "--no-open"], options), /spawn failed/);

  assert.equal(child.killed, true);
});

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createUiServer } = require("../src/ui-server");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function read(url) {
  const response = await fetch(url);
  return { status: response.status, text: await response.text() };
}

test("serves static ui files and falls back to index", async () => {
  const uiPath = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-ui-server-"));
  await fs.mkdir(path.join(uiPath, "_next"), { recursive: true });
  await fs.writeFile(path.join(uiPath, "index.html"), "<!doctype html><main>Workbench</main>");
  await fs.writeFile(path.join(uiPath, "_next", "app.js"), "console.log('app')");

  const server = createUiServer({ uiPath, apiPort: 1 });
  const port = await listen(server);
  try {
    assert.deepEqual(await read(`http://127.0.0.1:${port}/_next/app.js`), { status: 200, text: "console.log('app')" });
    assert.deepEqual(await read(`http://127.0.0.1:${port}/workspace`), { status: 200, text: "<!doctype html><main>Workbench</main>" });
  } finally {
    await close(server);
  }
});

test("proxies todo-engine requests to the api server", async () => {
  const api = http.createServer((request, response) => {
    assert.equal(request.url, "/items?type=task");
    response.end("api ok");
  });
  const apiPort = await listen(api);
  const uiPath = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-ui-server-"));
  await fs.writeFile(path.join(uiPath, "index.html"), "<!doctype html>");
  const server = createUiServer({ uiPath, apiPort });
  const port = await listen(server);
  try {
    assert.deepEqual(await read(`http://127.0.0.1:${port}/todo-engine/items?type=task`), { status: 200, text: "api ok" });
  } finally {
    await close(server);
    await close(api);
  }
});

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runEngine } = require("../src/runner");

test("forwards arguments to an engine binary and returns its exit code", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raven-runner-"));
  const engine = path.join(dir, "engine.js");
  const output = path.join(dir, "args.txt");
  await fs.writeFile(engine, `require("node:fs").writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2))); process.exit(7);`);

  const args = ["todo", "list", "--format", "json", "a value with spaces"];
  const code = await runEngine([engine, ...args], { binaryPath: process.execPath, stdio: "ignore" });
  assert.equal(code, 7);
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), args);
});

test("passes an explicit environment and exposes the spawned child", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raven-runner-"));
  const engine = path.join(dir, "engine.js");
  const output = path.join(dir, "env.txt");
  await fs.writeFile(engine, `require("node:fs").writeFileSync(${JSON.stringify(output)}, process.env.RAVEN_UPDATE_SUPERVISOR || "unset"); process.exit(75);`);

  let spawned = null;
  const code = await runEngine([engine], {
    binaryPath: process.execPath,
    stdio: "ignore",
    env: { RAVEN_UPDATE_SUPERVISOR: "1" },
    onSpawn: (child) => { spawned = child; },
  });
  assert.equal(code, 75);
  assert.equal(typeof spawned.kill, "function");
  assert.equal(await fs.readFile(output, "utf8"), "1");
});

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runEngine } = require("../src/runner");

test("forwards arguments to an engine binary and returns its exit code", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "raven-runner-"));
  const engine = path.join(dir, "raven");
  const output = path.join(dir, "args.txt");
  await fs.writeFile(engine, `#!/bin/sh\necho "$@" > "${output}"\nexit 7\n`, { mode: 0o755 });

  const code = await runEngine(["today", "--json"], { binaryPath: engine, stdio: "ignore" });
  assert.equal(code, 7);
  assert.equal((await fs.readFile(output, "utf8")).trim(), "today --json");
});

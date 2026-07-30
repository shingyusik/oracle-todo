const assert = require("node:assert/strict");
const test = require("node:test");

const pkg = require("../package.json");

test("package exposes only the raven command", () => {
  assert.equal(pkg.name, "@shings/raven");
  assert.deepEqual(pkg.bin, { raven: "bin/raven.js" });
  assert.equal(pkg.engines.node, ">=18");
  assert.equal(pkg.repository.url, "git+https://github.com/shingyusik/oracle-todo.git");
  assert.equal(pkg.repository.directory, "npm/raven");
});

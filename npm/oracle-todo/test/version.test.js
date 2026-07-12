const assert = require("node:assert/strict");
const test = require("node:test");

const { compareVersions, normalizeVersion } = require("../src/version");

test("normalizes optional v prefix", () => {
  assert.equal(normalizeVersion("v0.2.0"), "0.2.0");
  assert.equal(normalizeVersion("0.2.0"), "0.2.0");
});

test("compares semantic versions", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareVersions("0.2.9", "0.3.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
});

const assert = require("node:assert/strict");
const test = require("node:test");

const path = require("node:path");

const { cacheDir, DEFAULT_CACHE_DIR, GITHUB_REPOSITORY, PACKAGE_NAME } = require("../src/config");

test("uses the published package name and source GitHub repository", () => {
  assert.equal(PACKAGE_NAME, "@shings/raven");
  assert.equal(GITHUB_REPOSITORY, "shingyusik/raven");
});

test("uses the Raven cache namespace and override", () => {
  assert.equal(path.basename(DEFAULT_CACHE_DIR), "raven");
  assert.equal(cacheDir({ RAVEN_CACHE_DIR: "/tmp/raven-cache" }), "/tmp/raven-cache");
});

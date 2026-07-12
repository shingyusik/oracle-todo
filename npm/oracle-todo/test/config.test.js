const assert = require("node:assert/strict");
const test = require("node:test");

const { GITHUB_REPOSITORY, PACKAGE_NAME } = require("../src/config");

test("uses the published package name and source GitHub repository", () => {
  assert.equal(PACKAGE_NAME, "@shings/oracle-todo");
  assert.equal(GITHUB_REPOSITORY, "shingyusik/oracle-todo");
});

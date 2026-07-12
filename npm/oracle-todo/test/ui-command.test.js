const assert = require("node:assert/strict");
const test = require("node:test");

const { parseUiArgs } = require("../src/ui-command");

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

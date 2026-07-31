const assert = require("node:assert/strict");
const test = require("node:test");

const { runUi } = require("../src/ui-command");

test("delegates UI startup to the native raven ui command", async () => {
  const calls = [];
  const code = await runUi(["--home", "/tmp/raven-home", "ui", "--no-open"], {
    installBundle: async () => ({
      binaryPath: "/tmp/raven",
      uiPath: "/tmp/raven-ui",
    }),
    runEngine: async (args, options) => {
      calls.push([args, options]);
      return 7;
    },
  });

  assert.equal(code, 7);
  assert.deepEqual(calls, [[
    ["--home", "/tmp/raven-home", "ui", "--ui-path", "/tmp/raven-ui", "--no-open"],
    { binaryPath: "/tmp/raven" },
  ]]);
});

test("preserves an explicit native UI artifact path", async () => {
  const calls = [];
  await runUi(["ui", "--ui-path=/tmp/custom-ui", "--port", "3102"], {
    installBundle: async () => ({
      binaryPath: "/tmp/raven",
      uiPath: "/tmp/raven-ui",
    }),
    runEngine: async (args) => {
      calls.push(args);
      return 0;
    },
  });

  assert.deepEqual(calls, [["ui", "--ui-path=/tmp/custom-ui", "--port", "3102"]]);
});

test("does not mistake a spaced home value named ui for the subcommand", async () => {
  const calls = [];
  await runUi(["--home", "ui", "ui", "--no-open"], {
    installBundle: async () => ({
      binaryPath: "/tmp/raven",
      uiPath: "/tmp/raven-ui",
    }),
    runEngine: async (args) => {
      calls.push(args);
      return 0;
    },
  });

  assert.deepEqual(calls, [["--home", "ui", "ui", "--ui-path", "/tmp/raven-ui", "--no-open"]]);
});

test("requires a native ui subcommand", async () => {
  await assert.rejects(
    () => runUi(["ledger", "entry", "list"], {
      installBundle: async () => ({ binaryPath: "/tmp/raven", uiPath: "/tmp/raven-ui" }),
      runEngine: async () => 0,
    }),
    /native raven ui command/
  );
});

const { runEngine } = require("./runner");
const { topLevelCommandIndex } = require("./command-index");

async function runUi(args, options = {}) {
  const uiIndex = topLevelCommandIndex(args);
  if (args[uiIndex] !== "ui") throw new Error("Expected native raven ui command");

  const installed = await options.installBundle({ env: options.env || process.env });
  const uiArgs = args.slice(uiIndex + 1);
  const hasUiPath = uiArgs.some((arg) => arg === "--ui-path" || arg.startsWith("--ui-path="));
  const nativeArgs = hasUiPath
    ? args
    : [...args.slice(0, uiIndex + 1), "--ui-path", installed.uiPath, ...uiArgs];
  return (options.runEngine || runEngine)(nativeArgs, { binaryPath: installed.binaryPath });
}

module.exports = { runUi };

const { readMetadata } = require("./cache");
const { cacheDir, PACKAGE_NAME } = require("./config");
const { installBundle, installEngine, updateBundle } = require("./install");
const { runEngine } = require("./runner");
const { runUi } = require("./ui-command");

async function main(args, options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;
  const install = options.installEngine || installEngine;
  const installAll = options.installBundle || installBundle;
  const updateAll = options.updateBundle || updateBundle;
  const run = options.runEngine || runEngine;
  const ui = options.runUi || runUi;
  const command = wrapperCommand(args);

  if (command === "install") {
    const result = await installAll({ env });
    log(`${PACKAGE_NAME}: ${result.status || "installed"} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "update") {
    const result = await updateAll({ env });
    log(`${PACKAGE_NAME}: ${result.status || "installed"} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "ui") {
    return ui(args, { env, installBundle: installAll, log });
  }

  if (command === "version") {
    const metadata = await readMetadata(cacheDir(env));
    log(`${PACKAGE_NAME} wrapper`);
    log(`todo-engine ${metadata ? metadata.installedVersion : "not installed"}`);
    log(`oracle-todo-ui ${metadata && metadata.uiVersion ? metadata.uiVersion : "not installed"}`);
    return 0;
  }

  if (command === "doctor") {
    const metadata = await readMetadata(cacheDir(env));
    if (!metadata) throw new Error("todo-engine is not installed; run install first");
    if (!metadata.uiPath) throw new Error("oracle-todo-ui is not installed; run install first");
    log(`cache ok: ${metadata.binaryPath}`);
    log(`ui ok: ${metadata.uiPath}`);
    return 0;
  }

  const installed = await install({ env });
  const binaryPath = installed.binaryPath;
  const exitCode = await run(args, { binaryPath });
  return exitCode;
}

function wrapperCommand(args) {
  let index = 0;
  while (args[index] === "--home" || args[index]?.startsWith("--home=")) {
    index += args[index] === "--home" ? 2 : 1;
  }
  return args[index];
}

module.exports = { main };

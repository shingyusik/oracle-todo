const path = require("node:path");

const { isUsableFile, readMetadata } = require("./cache");
const { topLevelCommandIndex } = require("./command-index");
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
  const command = args[topLevelCommandIndex(args)];

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
    log(`raven ${metadata ? metadata.installedVersion : "not installed"}`);
    log(`raven-ui ${metadata && metadata.uiVersion ? metadata.uiVersion : "not installed"}`);
    return 0;
  }

  if (command === "doctor") {
    const metadata = await readMetadata(cacheDir(env));
    if (!metadata) throw new Error("raven is not installed; run install first");
    if (!(await isUsableFile(metadata.binaryPath, true))) {
      throw new Error("raven binary is missing or unusable; run install first");
    }
    if (!metadata.uiPath) throw new Error("raven-ui is not installed; run install first");
    if (!(await isUsableFile(path.join(metadata.uiPath, "index.html")))) {
      throw new Error("raven-ui is missing or unusable; run install first");
    }
    log(`cache ok: ${metadata.binaryPath}`);
    log(`ui ok: ${metadata.uiPath}`);
    return 0;
  }

  const installed = await install({ env });
  const binaryPath = installed.binaryPath;
  const exitCode = await run(args, { binaryPath });
  return exitCode;
}

module.exports = { main };

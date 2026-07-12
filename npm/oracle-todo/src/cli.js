const { readMetadata } = require("./cache");
const { cacheDir, PACKAGE_NAME } = require("./config");
const { installEngine, updateEngine } = require("./install");
const { runEngine } = require("./runner");

async function main(args, options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;
  const install = options.installEngine || installEngine;
  const update = options.updateEngine || updateEngine;
  const run = options.runEngine || runEngine;
  const command = args[0];

  if (command === "install") {
    const result = await install({ env });
    log(`${PACKAGE_NAME}: ${result.status} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "update") {
    const result = await update({ env });
    log(`${PACKAGE_NAME}: ${result.status} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "version") {
    const metadata = await readMetadata(cacheDir(env));
    log(`${PACKAGE_NAME} wrapper`);
    log(`todo-engine ${metadata ? metadata.installedVersion : "not installed"}`);
    return 0;
  }

  if (command === "doctor") {
    const metadata = await readMetadata(cacheDir(env));
    if (!metadata) throw new Error("todo-engine is not installed; run install first");
    log(`cache ok: ${metadata.binaryPath}`);
    return 0;
  }

  const installed = await install({ env });
  const binaryPath = installed.binaryPath;
  const exitCode = await run(args, { binaryPath });
  return exitCode;
}

module.exports = { main };

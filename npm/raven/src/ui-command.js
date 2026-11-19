const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { runEngine } = require("./runner");
const { topLevelCommandIndex } = require("./command-index");
const { cacheDir } = require("./config");

// Exit code the native UI uses to ask the wrapper for a bundle update.
const UPDATE_EXIT_CODE = 75;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function nativeUiArgs(args, uiIndex, hasUiPath, uiPath) {
  if (hasUiPath) return args;
  return [...args.slice(0, uiIndex + 1), "--ui-path", uiPath, ...args.slice(uiIndex + 1)];
}

function childEnv(env, installed, hasUiPath) {
  const next = { ...env, RAVEN_UPDATE_SUPERVISOR: "1" };
  delete next.RAVEN_BUNDLE_VERSION;
  delete next.RAVEN_UI_VERSION;
  if (installed.installedVersion) next.RAVEN_BUNDLE_VERSION = installed.installedVersion;
  // A user-supplied --ui-path serves an artifact of unknown version.
  if (installed.uiVersion && !hasUiPath) next.RAVEN_UI_VERSION = installed.uiVersion;
  return next;
}

async function writeUpdateStatus(cacheRoot, status) {
  await fs.mkdir(cacheRoot, { recursive: true });
  const target = path.join(cacheRoot, "update-status.json");
  const staging = `${target}.${process.pid}.tmp`;
  await fs.writeFile(staging, `${JSON.stringify(status, null, 2)}\n`);
  await fs.rename(staging, target);
}

function restartLabels(env) {
  return String(env.RAVEN_UPDATE_RESTART_LABELS || "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function runCommand(spawnImpl, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function restartServices(env, options, log) {
  const labels = restartLabels(env);
  if (labels.length === 0) return;
  const platform = options.platform || process.platform;
  if (platform !== "darwin") {
    log(`raven: skipping service restart on ${platform}: ${labels.join(", ")}`);
    return;
  }
  const uid = options.getuid ? options.getuid() : process.getuid();
  const spawnImpl = options.spawnImpl || spawn;
  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      log(`raven: skipping invalid launchd label ${JSON.stringify(label)}`);
      continue;
    }
    try {
      await runCommand(spawnImpl, "launchctl", ["kickstart", "-k", `gui/${uid}/${label}`]);
      log(`raven: restarted ${label}`);
    } catch (error) {
      log(`raven: failed to restart ${label}: ${error.message}`);
    }
  }
}

async function applyUpdate(installed, env, cacheRoot, options, log) {
  const from = installed.installedVersion || null;
  const now = options.now || (() => new Date());
  let next = null;
  let error = null;
  try {
    const result = await options.updateBundle({ env, cacheRoot, requireNewer: true });
    if (result.status === "up-to-date") {
      error = `no release newer than ${from} is available`;
    } else if (!result.binaryPath || !result.uiPath) {
      error = "update did not produce a complete bundle";
    } else {
      next = result;
    }
  } catch (caught) {
    error = caught && caught.message ? caught.message : String(caught);
  }

  try {
    await writeUpdateStatus(cacheRoot, {
      at: now().toISOString(),
      from,
      to: next ? next.installedVersion : null,
      ok: Boolean(next),
      error,
    });
  } catch (statusError) {
    log(`raven: failed to write update status: ${statusError.message}`);
  }

  if (!next) {
    log(`raven: update failed, relaunching ${from}: ${error}`);
    return installed;
  }
  log(`raven: updated ${from} -> ${next.installedVersion}`);
  await restartServices(env, options, log);
  return next;
}

async function runUi(args, options = {}) {
  const uiIndex = topLevelCommandIndex(args);
  if (args[uiIndex] !== "ui") throw new Error("Expected native raven ui command");

  const env = options.env || process.env;
  const log = options.log || console.log;
  const run = options.runEngine || runEngine;
  const cacheRoot = options.cacheRoot || cacheDir(env);
  const signals = options.signalSource || process;
  const hasUiPath = args
    .slice(uiIndex + 1)
    .some((arg) => arg === "--ui-path" || arg.startsWith("--ui-path="));

  let installed = await options.installBundle({ env });
  let child = null;
  let stopSignal = null;
  const listeners = FORWARDED_SIGNALS.map((signal) => {
    const listener = () => {
      stopSignal = signal;
      if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    signals.on(signal, listener);
    return [signal, listener];
  });

  try {
    for (;;) {
      const code = await run(nativeUiArgs(args, uiIndex, hasUiPath, installed.uiPath), {
        binaryPath: installed.binaryPath,
        env: childEnv(env, installed, hasUiPath),
        onSpawn: (spawned) => {
          child = spawned;
        },
      });
      child = null;
      if (code !== UPDATE_EXIT_CODE || stopSignal || !options.updateBundle) return code;
      installed = await applyUpdate(installed, env, cacheRoot, options, log);
      if (stopSignal) return 0;
    }
  } finally {
    for (const [signal, listener] of listeners) signals.removeListener(signal, listener);
  }
}

module.exports = { runUi, UPDATE_EXIT_CODE };

import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDevEnvironment } from "./dev-env.mjs";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(frontendDir, "..");
const env = loadDevEnvironment(workspaceRoot, process.env);
const uiPort = env.TODO_ENGINE_DEV_UI_PORT || "3101";
const apiPort = env.TODO_ENGINE_DEV_API_PORT || "3102";
const children = [];
let stopping = false;

function start(command, args, options) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  children.push(child);
  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }

    stopAll();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function stopAll() {
  stopping = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(143);
});

if (!(await apiAvailable(apiPort))) {
  start("cargo", ["run", "-p", "todo-engine", "--", "api", "--port", apiPort], {
    cwd: workspaceRoot,
  });
}
start("npm", ["run", "dev", "--", "--port", uiPort], {
  cwd: frontendDir,
  env: {
    ...env,
    TODO_ENGINE_API_URL: `http://127.0.0.1:${apiPort}`,
  },
});

function apiAvailable(port) {
  return new Promise((resolveAvailable) => {
    const socket = net.connect(Number(port), "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
      resolveAvailable(true);
    });
    socket.once("error", () => resolveAvailable(false));
  });
}

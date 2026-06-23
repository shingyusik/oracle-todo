import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(frontendDir, "..");
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

start("cargo", ["run", "-p", "todo-engine", "--", "api"], {
  cwd: workspaceRoot,
});
start("npm", ["run", "dev", "--", "--port", "3001"], { cwd: frontendDir });

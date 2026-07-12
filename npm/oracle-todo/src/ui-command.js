const { spawn } = require("node:child_process");
const net = require("node:net");

const { createUiServer } = require("./ui-server");

function parseUiArgs(args) {
  const uiIndex = args.indexOf("ui");
  const engineArgs = uiIndex < 0 ? [] : args.slice(0, uiIndex);
  const uiArgs = uiIndex < 0 ? args : args.slice(uiIndex + 1);
  const result = { engineArgs, uiPort: 3001, apiPort: 3002, openBrowser: true };

  for (let index = 0; index < uiArgs.length; index += 1) {
    const arg = uiArgs[index];
    if (arg === "--no-open") {
      result.openBrowser = false;
    } else if (arg === "--ui-port") {
      result.uiPort = parsePort(uiArgs[++index], "--ui-port");
    } else if (arg === "--api-port") {
      result.apiPort = parsePort(uiArgs[++index], "--api-port");
    } else {
      throw new Error(`Unknown ui option: ${arg}`);
    }
  }
  return result;
}

function parsePort(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} requires a port between 1 and 65535`);
  }
  return port;
}

async function runUi(args, options = {}) {
  const parsed = parseUiArgs(args);
  const install = options.installBundle;
  const installed = await install({ env: options.env || process.env });
  const api = spawn(installed.binaryPath, [...parsed.engineArgs, "api", "--host", "127.0.0.1", "--port", String(parsed.apiPort)], {
    stdio: "inherit",
  });
  await waitForPort(parsed.apiPort, api);

  const server = createUiServer({ uiPath: installed.uiPath, apiPort: parsed.apiPort });
  await listen(server, parsed.uiPort);
  const url = `http://127.0.0.1:${parsed.uiPort}`;
  (options.log || console.log)(`oracle-todo ui: ${url}`);
  if (parsed.openBrowser) {
    await openBrowser(url, options).catch(() => (options.log || console.log)(`open ${url}`));
  }
  await waitForExit(api, server);
  return 0;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function waitForPort(port, child) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        clearInterval(timer);
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        if (Date.now() - started > 10_000) {
          clearInterval(timer);
          reject(new Error(`todo-engine api did not become reachable on 127.0.0.1:${port}`));
        }
      });
    }, 100);
    child.once("exit", (code) => {
      clearInterval(timer);
      reject(new Error(`todo-engine api exited before startup with code ${code}`));
    });
  });
}

function openBrowser(url, options = {}) {
  const opener = options.spawnImpl || spawn;
  const platform = options.platform || process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve, reject) => {
    const child = opener(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
  });
}

function waitForExit(child, server) {
  return new Promise((resolve) => {
    const stop = () => {
      server.close(() => resolve());
      if (!child.killed) child.kill();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("exit", () => server.close(() => resolve()));
  });
}

module.exports = {
  parseUiArgs,
  runUi,
};

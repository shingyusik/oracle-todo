const { spawn } = require("node:child_process");

function runEngine(args, { binaryPath, stdio = "inherit" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio });
    child.on("error", reject);
    child.on("close", (code) => resolve(code || 0));
  });
}

module.exports = { runEngine };

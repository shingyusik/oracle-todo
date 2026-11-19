const { spawn } = require("node:child_process");

function runEngine(args, { binaryPath, stdio = "inherit", env, onSpawn, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binaryPath, args, env ? { stdio, env } : { stdio });
    if (onSpawn) onSpawn(child);
    child.on("error", reject);
    child.on("close", (code) => resolve(code || 0));
  });
}

module.exports = { runEngine };

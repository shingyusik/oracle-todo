const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function downloadFile(url, destination, { fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) throw new Error("Download requires Node.js 18 or newer with global fetch support");
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, buffer);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function extractArchive(archivePath, destination, { platform = process.platform } = {}) {
  await fs.mkdir(destination, { recursive: true });
  if (archivePath.endsWith(".tar.gz")) {
    await run("tar", ["-xzf", archivePath, "-C", destination]);
    return;
  }
  if (archivePath.endsWith(".zip")) {
    if (platform === "win32") {
      await run("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force ${JSON.stringify(archivePath)} ${JSON.stringify(destination)}`]);
      return;
    }
    await run("unzip", ["-q", "-o", archivePath, "-d", destination]);
    return;
  }
  throw new Error(`Unsupported archive format: ${archivePath}`);
}

async function verifyChecksum(archivePath, checksumsText, expectedName) {
  const line = checksumsText
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(` ${expectedName}`) || entry.endsWith(` *${expectedName}`));
  if (!line) {
    throw new Error(`Checksum entry not found for ${expectedName}`);
  }

  const expected = line.split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(await fs.readFile(archivePath)).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${expectedName}`);
  }
}

async function findExtractedBinary(directory, binaryName) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === binaryName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      try {
        const found = await findExtractedBinary(entryPath, binaryName);
        if (found) return found;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return null;
}

async function activateBinary(paths, binaryName) {
  await fs.mkdir(paths.binDir, { recursive: true });
  let source = paths.versionedBinary;
  try {
    await fs.access(source);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    source = await findExtractedBinary(paths.versionDir, binaryName);
    if (!source) throw error;
  }
  await fs.copyFile(source, paths.activeBinary);
  if (!binaryName.endsWith(".exe")) {
    await fs.chmod(paths.activeBinary, 0o755);
  }
}

module.exports = {
  activateBinary,
  downloadFile,
  extractArchive,
  verifyChecksum,
};

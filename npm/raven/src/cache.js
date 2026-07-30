const fs = require("node:fs/promises");
const path = require("node:path");

function pathsFor(root, version, binaryName) {
  const binDir = path.join(root, "bin");
  const versionsDir = path.join(root, "versions");
  const versionDir = path.join(versionsDir, version);
  return {
    root,
    binDir,
    versionsDir,
    versionDir,
    metadataPath: path.join(root, "metadata.json"),
    activeBinary: path.join(binDir, binaryName),
    versionedBinary: path.join(versionDir, binaryName),
  };
}

function uiPathsFor(root, version) {
  const uiDir = path.join(root, "ui");
  const uiVersionDir = path.join(uiDir, version);
  return {
    uiDir,
    uiVersionDir,
    uiIndexPath: path.join(uiVersionDir, "index.html"),
  };
}

async function readMetadata(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, "metadata.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeMetadata(root, metadata) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function isUsableFile(filePath, executable = false) {
  if (!filePath) return false;
  try {
    if (!(await fs.stat(filePath)).isFile()) return false;
    const mode = fs.constants.R_OK | (executable && process.platform !== "win32" ? fs.constants.X_OK : 0);
    await fs.access(filePath, mode);
    return true;
  } catch (error) {
    if (["EACCES", "ENOENT", "ENOTDIR"].includes(error.code)) return false;
    throw error;
  }
}

module.exports = {
  isUsableFile,
  pathsFor,
  readMetadata,
  uiPathsFor,
  writeMetadata,
};

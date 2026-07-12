const fs = require("node:fs/promises");
const path = require("node:path");

const { downloadFile, extractArchive, verifyChecksum } = require("./archive");
const { uiPathsFor } = require("./cache");
const { selectAsset } = require("./github");

function uiAssetName(version) {
  return `oracle-todo-ui-${version}.tar.gz`;
}

async function findIndexRoot(directory) {
  const indexPath = path.join(directory, "index.html");
  try {
    await fs.access(indexPath);
    return directory;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findIndexRoot(path.join(directory, entry.name));
    if (found) return found;
  }
  return null;
}

async function installUiArtifact(options) {
  const expectedAsset = uiAssetName(options.version);
  const asset = selectAsset(options.release, expectedAsset);
  const checksumAsset = (options.release.assets || []).find((candidate) => candidate.name === "SHA256SUMS");
  const paths = uiPathsFor(options.cacheRoot, options.version);
  const archivePath = path.join(paths.uiVersionDir, expectedAsset);
  const checksumPath = path.join(paths.uiVersionDir, "SHA256SUMS");

  await fs.rm(paths.uiVersionDir, { recursive: true, force: true });
  await fs.mkdir(paths.uiVersionDir, { recursive: true });
  await (options.downloadFileImpl || downloadFile)(asset.browser_download_url, archivePath, { fetchImpl: options.fetchImpl });
  if (checksumAsset) {
    await (options.downloadFileImpl || downloadFile)(checksumAsset.browser_download_url, checksumPath, { fetchImpl: options.fetchImpl });
    await verifyChecksum(archivePath, await fs.readFile(checksumPath, "utf8"), expectedAsset);
  }
  await (options.extractArchiveImpl || extractArchive)(archivePath, paths.uiVersionDir, { platform: process.platform });

  const root = await findIndexRoot(paths.uiVersionDir);
  if (!root) {
    throw new Error(`UI artifact is missing index.html: ${expectedAsset}`);
  }
  if (root !== paths.uiVersionDir) {
    const stagingDir = `${paths.uiVersionDir}.staging`;
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.rename(root, stagingDir);
    await fs.rm(paths.uiVersionDir, { recursive: true, force: true });
    await fs.rename(stagingDir, paths.uiVersionDir);
  }

  return {
    uiVersion: options.version,
    uiAssetName: expectedAsset,
    uiPath: paths.uiVersionDir,
  };
}

module.exports = {
  installUiArtifact,
  uiAssetName,
};

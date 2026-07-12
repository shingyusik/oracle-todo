const fs = require("node:fs/promises");
const path = require("node:path");

const { downloadFile, extractArchive, activateBinary, verifyChecksum } = require("./archive");
const { pathsFor, readMetadata, writeMetadata } = require("./cache");
const { cacheDir, GITHUB_REPOSITORY } = require("./config");
const { fetchRelease, selectAsset } = require("./github");
const { assetName, resolvePlatform } = require("./platform");
const { installUiArtifact } = require("./ui-artifact");
const { compareVersions, normalizeVersion } = require("./version");

async function fetchRequestedRelease(options, env) {
  return (options.fetchReleaseImpl || fetchRelease)({
    repository: options.repository || GITHUB_REPOSITORY,
    version: env.ORACLE_TODO_VERSION,
    token: env.ORACLE_TODO_GITHUB_TOKEN,
    fetchImpl: options.fetchImpl,
  });
}

async function installBundle(options = {}) {
  const env = options.env || process.env;
  const cacheRoot = options.cacheRoot || cacheDir(env);
  const platformInfo = options.platformInfo || resolvePlatform();
  const metadata = await readMetadata(cacheRoot);
  const release = await fetchRequestedRelease(options, env);
  const version = normalizeVersion(release.tag_name);

  if (metadata && metadata.installedVersion === version && metadata.uiVersion === version) {
    return { status: "already-installed", ...metadata };
  }

  const engine = await installRelease({
    ...options,
    cacheRoot,
    platformInfo,
    release,
    version,
    activate: false,
    writeMetadata: false,
  });
  const ui = await installUiArtifact({ ...options, cacheRoot, release, version });
  await activateBinary(pathsFor(cacheRoot, version, platformInfo.binaryName), platformInfo.binaryName);
  const metadataNext = {
    ...engine,
    uiVersion: ui.uiVersion,
    uiAssetName: ui.uiAssetName,
    uiPath: ui.uiPath,
  };
  await writeMetadata(cacheRoot, metadataNext);
  return metadataNext;
}

async function updateBundle(options = {}) {
  return installBundle(options);
}

async function installEngine(options = {}) {
  const env = options.env || process.env;
  const cacheRoot = options.cacheRoot || cacheDir(env);
  const platformInfo = options.platformInfo || resolvePlatform();
  const metadata = await readMetadata(cacheRoot);
  const requestedVersion = env.ORACLE_TODO_VERSION;

  if (metadata && !requestedVersion) {
    return { status: "already-installed", ...metadata };
  }

  const release = await (options.fetchReleaseImpl || fetchRelease)({
    repository: options.repository || GITHUB_REPOSITORY,
    version: requestedVersion,
    token: env.ORACLE_TODO_GITHUB_TOKEN,
    fetchImpl: options.fetchImpl,
  });

  const version = normalizeVersion(release.tag_name);
  if (metadata && metadata.installedVersion === version) {
    return { status: "already-installed", ...metadata };
  }

  return installRelease({ ...options, cacheRoot, platformInfo, release, version });
}

async function updateEngine(options = {}) {
  const env = options.env || process.env;
  const cacheRoot = options.cacheRoot || cacheDir(env);
  const platformInfo = options.platformInfo || resolvePlatform();
  const metadata = await readMetadata(cacheRoot);
  const release = await (options.fetchReleaseImpl || fetchRelease)({
    repository: options.repository || GITHUB_REPOSITORY,
    version: env.ORACLE_TODO_VERSION,
    token: env.ORACLE_TODO_GITHUB_TOKEN,
    fetchImpl: options.fetchImpl,
  });
  const version = normalizeVersion(release.tag_name);

  if (metadata && compareVersions(version, metadata.installedVersion) <= 0) {
    return { status: "up-to-date", ...metadata };
  }

  return installRelease({ ...options, cacheRoot, platformInfo, release, version });
}

async function installRelease(options) {
  const expectedAsset = assetName(options.version, options.platformInfo.target);
  const asset = selectAsset(options.release, expectedAsset);
  const checksumAsset = (options.release.assets || []).find((candidate) => candidate.name === "SHA256SUMS");
  const paths = pathsFor(options.cacheRoot, options.version, options.platformInfo.binaryName);
  const archivePath = path.join(paths.versionDir, expectedAsset);
  const checksumPath = path.join(paths.versionDir, "SHA256SUMS");

  await fs.rm(paths.versionDir, { recursive: true, force: true });
  await fs.mkdir(paths.versionDir, { recursive: true });
  await (options.downloadFileImpl || downloadFile)(asset.browser_download_url, archivePath, { fetchImpl: options.fetchImpl });
  if (checksumAsset) {
    await (options.downloadFileImpl || downloadFile)(checksumAsset.browser_download_url, checksumPath, { fetchImpl: options.fetchImpl });
    await verifyChecksum(archivePath, await fs.readFile(checksumPath, "utf8"), expectedAsset);
  }
  await (options.extractArchiveImpl || extractArchive)(archivePath, paths.versionDir, { platform: process.platform });
  if (options.activate !== false) {
    await activateBinary(paths, options.platformInfo.binaryName);
  }

  const metadata = {
    installedVersion: options.version,
    assetName: expectedAsset,
    binaryPath: paths.activeBinary,
    installedAt: (options.now || (() => new Date()))().toISOString(),
  };
  if (options.writeMetadata !== false) {
    await writeMetadata(options.cacheRoot, metadata);
  }
  return { status: "installed", ...metadata };
}

module.exports = {
  installBundle,
  installEngine,
  updateBundle,
  updateEngine,
};

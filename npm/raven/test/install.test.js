const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installBundle, installEngine, updateBundle, updateEngine } = require("../src/install");
const { readMetadata, writeMetadata } = require("../src/cache");

const ARCHIVE_BYTES = Buffer.from("archive");
const ARCHIVE_DIGEST = crypto.createHash("sha256").update(ARCHIVE_BYTES).digest("hex");

function signedAssets(...assets) {
  return [...assets, { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" }];
}

async function fakeDownload(url, destination) {
  if (url.endsWith("SHA256SUMS")) {
    const version = path.basename(path.dirname(destination));
    return fs.writeFile(
      destination,
      `${ARCHIVE_DIGEST}  raven-${version}-aarch64-apple-darwin.tar.gz\n${ARCHIVE_DIGEST}  raven-ui-${version}.tar.gz\n`
    );
  }
  return fs.writeFile(destination, ARCHIVE_BYTES);
}

async function fakeExtractor(archivePath, destination) {
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "raven"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
}

async function fakeNestedExtractor(_archivePath, destination) {
  const releaseRoot = path.join(destination, "raven-0.2.0-aarch64-apple-darwin");
  await fs.mkdir(releaseRoot, { recursive: true });
  await fs.writeFile(path.join(releaseRoot, "raven"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
}

test("reinstalls when cached binary metadata is stale", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-install-"));
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.writeFile(path.join(cacheRoot, "metadata.json"), JSON.stringify({
    installedVersion: "0.2.0",
    binaryPath: path.join(cacheRoot, "bin", "missing-raven"),
  }));

  const result = await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: signedAssets(
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.status, "installed");
  assert.equal(await fs.readFile(result.binaryPath, "utf8"), "#!/bin/sh\necho fake engine\n");
});

test("rejects engine releases without SHA256SUMS", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-checksum-"));
  await assert.rejects(
    () => installEngine({
      cacheRoot,
      platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
      fetchReleaseImpl: async () => ({
        tag_name: "v0.2.0",
        assets: [{ name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
      }),
      downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
      extractArchiveImpl: fakeExtractor,
    }),
    /Release asset not found: SHA256SUMS/
  );
});

test("rejects SHA256SUMS without the exact engine asset", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-checksum-"));
  await assert.rejects(
    () => installEngine({
      cacheRoot,
      platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
      fetchReleaseImpl: async () => ({
        tag_name: "v0.2.0",
        assets: [
          { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
          { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
        ],
      }),
      downloadFileImpl: async (url, destination) => fs.writeFile(
        destination,
        url.endsWith("SHA256SUMS") ? `${"0".repeat(64)}  other.tar.gz\n` : "archive"
      ),
      extractArchiveImpl: fakeExtractor,
    }),
    /Checksum entry not found for raven-0\.2\.0-aarch64-apple-darwin\.tar\.gz/
  );
});

test("installs engine and matching ui artifact as a bundle", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-bundle-"));
  const result = await installBundle({
    cacheRoot,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.3.0",
      assets: signedAssets(
        { name: "raven-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
        { name: "raven-ui-0.3.0.tar.gz", browser_download_url: "https://example.test/ui" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: async (_archivePath, destination) => {
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, "raven"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
      await fs.writeFile(path.join(destination, "index.html"), "<!doctype html>");
    },
  });

  assert.equal(result.installedVersion, "0.3.0");
  assert.equal(result.uiVersion, "0.3.0");
  assert.equal((await readMetadata(cacheRoot)).uiVersion, "0.3.0");
});

test("reinstalls a matching bundle when the UI index is missing", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-bundle-"));
  const binaryPath = path.join(cacheRoot, "bin", "raven");
  const uiPath = path.join(cacheRoot, "ui", "0.3.0");
  await fs.mkdir(path.dirname(binaryPath), { recursive: true });
  await fs.writeFile(binaryPath, "#!/bin/sh\n", { mode: 0o755 });
  await fs.mkdir(uiPath, { recursive: true });
  await writeMetadata(cacheRoot, {
    installedVersion: "0.3.0",
    binaryPath,
    uiVersion: "0.3.0",
    uiPath,
  });

  const result = await installBundle({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.3.0",
      assets: signedAssets(
        { name: "raven-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
        { name: "raven-ui-0.3.0.tar.gz", browser_download_url: "https://example.test/ui" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: async (archivePath, destination) => {
      await fs.mkdir(destination, { recursive: true });
      if (path.basename(archivePath).startsWith("raven-ui-")) {
        await fs.writeFile(path.join(destination, "index.html"), "<!doctype html>");
      } else {
        await fs.writeFile(path.join(destination, "raven"), "#!/bin/sh\n", { mode: 0o755 });
      }
    },
  });

  assert.equal(result.status, "installed");
  assert.equal(await fs.readFile(path.join(result.uiPath, "index.html"), "utf8"), "<!doctype html>");
});

test("keeps the previous bundle metadata when UI installation fails", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-bundle-"));
  const platformInfo = { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" };
  const releaseFor = (version) => ({
    tag_name: `v${version}`,
    assets: signedAssets(
      { name: `raven-${version}-aarch64-apple-darwin.tar.gz`, browser_download_url: `https://example.test/engine-${version}` },
      { name: `raven-ui-${version}.tar.gz`, browser_download_url: `https://example.test/ui-${version}` }
    ),
  });
  const extract = async (archivePath, destination) => {
    const version = archivePath.includes("0.2.0") ? "0.2.0" : "0.3.0";
    await fs.mkdir(destination, { recursive: true });
    if (path.basename(archivePath).startsWith("raven-ui-")) {
      await fs.writeFile(path.join(destination, "index.html"), `<title>${version}</title>`);
    } else {
      await fs.writeFile(path.join(destination, "raven"), `engine ${version}`, { mode: 0o755 });
    }
  };

  await installBundle({
    cacheRoot,
    platformInfo,
    fetchReleaseImpl: async () => releaseFor("0.2.0"),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: extract,
  });
  const previousMetadata = await readMetadata(cacheRoot);
  const previousBinary = await fs.readFile(previousMetadata.binaryPath, "utf8");

  await assert.rejects(
    () => installBundle({
      cacheRoot,
      platformInfo,
      fetchReleaseImpl: async () => releaseFor("0.3.0"),
      downloadFileImpl: async (url, destination) => {
        if (url.endsWith("ui-0.3.0")) throw new Error("UI download failed");
        return fakeDownload(url, destination);
      },
      extractArchiveImpl: extract,
    }),
    /UI download failed/
  );

  assert.deepEqual(await readMetadata(cacheRoot), previousMetadata);
  assert.equal(await fs.readFile(previousMetadata.binaryPath, "utf8"), previousBinary);
});

test("installs the latest compatible engine", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-install-"));
  const result = await installEngine({
    cacheRoot,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: signedAssets(
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.installedVersion, "0.2.0");
  assert.equal((await readMetadata(cacheRoot)).installedVersion, "0.2.0");
});

test("installs binaries extracted under a release archive root directory", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-install-"));
  const result = await installEngine({
    cacheRoot,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: signedAssets(
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeNestedExtractor,
  });

  assert.equal(result.installedVersion, "0.2.0");
  assert.equal(await fs.readFile(result.binaryPath, "utf8"), "#!/bin/sh\necho fake engine\n");
});

test("skips install when the requested version is already active", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-install-"));
  await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: signedAssets(
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeExtractor,
  });

  const result = await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => {
      throw new Error("release lookup should not be needed");
    },
  });

  assert.equal(result.status, "already-installed");
});

test("updates when the latest release is newer", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-update-"));
  await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: signedAssets(
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeExtractor,
  });

  const result = await updateEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.3.0",
      assets: signedAssets(
        { name: "raven-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.installedVersion, "0.3.0");
});

test("rejects checksum mismatches and keeps previous metadata", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-checksum-"));
  await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: signedAssets(
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }
      ),
    }),
    downloadFileImpl: fakeDownload,
    extractArchiveImpl: fakeExtractor,
  });

  await assert.rejects(
    () =>
      updateEngine({
        cacheRoot,
        platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
        fetchReleaseImpl: async () => ({
          tag_name: "v0.3.0",
          assets: [
            { name: "raven-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
            { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
          ],
        }),
        downloadFileImpl: async (url, destination) => {
          if (url.endsWith("SHA256SUMS")) {
            return fs.writeFile(destination, `${"0".repeat(64)}  raven-0.3.0-aarch64-apple-darwin.tar.gz\n`);
          }
          return fs.writeFile(destination, "new archive");
        },
        extractArchiveImpl: fakeExtractor,
      }),
    /Checksum mismatch/
  );

  assert.equal((await readMetadata(cacheRoot)).installedVersion, "0.2.0");
});

test("accepts matching checksums when SHA256SUMS is present", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "raven-checksum-"));
  const archiveBytes = Buffer.from("archive");
  const digest = crypto.createHash("sha256").update(archiveBytes).digest("hex");

  const result = await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "raven" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [
        { name: "raven-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
        { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
      ],
    }),
    downloadFileImpl: async (url, destination) => {
      if (url.endsWith("SHA256SUMS")) {
        return fs.writeFile(destination, `${digest}  raven-0.2.0-aarch64-apple-darwin.tar.gz\n`);
      }
      return fs.writeFile(destination, archiveBytes);
    },
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.installedVersion, "0.2.0");
});

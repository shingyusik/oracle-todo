const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installBundle, installEngine, updateBundle, updateEngine } = require("../src/install");
const { readMetadata } = require("../src/cache");

async function fakeExtractor(archivePath, destination) {
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "todo-engine"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
}

async function fakeNestedExtractor(_archivePath, destination) {
  const releaseRoot = path.join(destination, "todo-engine-0.2.0-aarch64-apple-darwin");
  await fs.mkdir(releaseRoot, { recursive: true });
  await fs.writeFile(path.join(releaseRoot, "todo-engine"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
}

test("installs engine and matching ui artifact as a bundle", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-bundle-"));
  const result = await installBundle({
    cacheRoot,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.3.0",
      assets: [
        { name: "todo-engine-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
        { name: "oracle-todo-ui-0.3.0.tar.gz", browser_download_url: "https://example.test/ui" },
      ],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: async (_archivePath, destination) => {
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, "todo-engine"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
      await fs.writeFile(path.join(destination, "index.html"), "<!doctype html>");
    },
  });

  assert.equal(result.installedVersion, "0.3.0");
  assert.equal(result.uiVersion, "0.3.0");
  assert.equal((await readMetadata(cacheRoot)).uiVersion, "0.3.0");
});

test("keeps the previous bundle metadata when UI installation fails", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-bundle-"));
  const platformInfo = { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" };
  const releaseFor = (version) => ({
    tag_name: `v${version}`,
    assets: [
      { name: `todo-engine-${version}-aarch64-apple-darwin.tar.gz`, browser_download_url: `https://example.test/engine-${version}` },
      { name: `oracle-todo-ui-${version}.tar.gz`, browser_download_url: `https://example.test/ui-${version}` },
    ],
  });
  const extract = async (archivePath, destination) => {
    const version = archivePath.includes("0.2.0") ? "0.2.0" : "0.3.0";
    await fs.mkdir(destination, { recursive: true });
    if (archivePath.includes("engine-")) {
      await fs.writeFile(path.join(destination, "todo-engine"), `engine ${version}`, { mode: 0o755 });
    } else {
      await fs.writeFile(path.join(destination, "index.html"), `<title>${version}</title>`);
    }
  };

  await installBundle({
    cacheRoot,
    platformInfo,
    fetchReleaseImpl: async () => releaseFor("0.2.0"),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
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
        return fs.writeFile(destination, "archive");
      },
      extractArchiveImpl: extract,
    }),
    /UI download failed/
  );

  assert.deepEqual(await readMetadata(cacheRoot), previousMetadata);
  assert.equal(await fs.readFile(previousMetadata.binaryPath, "utf8"), previousBinary);
});

test("installs the latest compatible engine", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-install-"));
  const result = await installEngine({
    cacheRoot,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [{ name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.installedVersion, "0.2.0");
  assert.equal((await readMetadata(cacheRoot)).installedVersion, "0.2.0");
});

test("installs binaries extracted under a release archive root directory", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-install-"));
  const result = await installEngine({
    cacheRoot,
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [{ name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeNestedExtractor,
  });

  assert.equal(result.installedVersion, "0.2.0");
  assert.equal(await fs.readFile(result.binaryPath, "utf8"), "#!/bin/sh\necho fake engine\n");
});

test("skips install when the requested version is already active", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-install-"));
  await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [{ name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeExtractor,
  });

  const result = await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => {
      throw new Error("release lookup should not be needed");
    },
  });

  assert.equal(result.status, "already-installed");
});

test("updates when the latest release is newer", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-update-"));
  await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [{ name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeExtractor,
  });

  const result = await updateEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.3.0",
      assets: [{ name: "todo-engine-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.installedVersion, "0.3.0");
});

test("rejects checksum mismatches and keeps previous metadata", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-checksum-"));
  await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [{ name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" }],
    }),
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeExtractor,
  });

  await assert.rejects(
    () =>
      updateEngine({
        cacheRoot,
        platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
        fetchReleaseImpl: async () => ({
          tag_name: "v0.3.0",
          assets: [
            { name: "todo-engine-0.3.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
            { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
          ],
        }),
        downloadFileImpl: async (url, destination) => {
          if (url.endsWith("SHA256SUMS")) {
            return fs.writeFile(destination, `${"0".repeat(64)}  todo-engine-0.3.0-aarch64-apple-darwin.tar.gz\n`);
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
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-checksum-"));
  const archiveBytes = Buffer.from("archive");
  const digest = crypto.createHash("sha256").update(archiveBytes).digest("hex");

  const result = await installEngine({
    cacheRoot,
    platformInfo: { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
    fetchReleaseImpl: async () => ({
      tag_name: "v0.2.0",
      assets: [
        { name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/archive" },
        { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
      ],
    }),
    downloadFileImpl: async (url, destination) => {
      if (url.endsWith("SHA256SUMS")) {
        return fs.writeFile(destination, `${digest}  todo-engine-0.2.0-aarch64-apple-darwin.tar.gz\n`);
      }
      return fs.writeFile(destination, archiveBytes);
    },
    extractArchiveImpl: fakeExtractor,
  });

  assert.equal(result.installedVersion, "0.2.0");
});

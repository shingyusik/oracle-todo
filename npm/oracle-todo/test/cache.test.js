const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { pathsFor, readMetadata, uiPathsFor, writeMetadata } = require("../src/cache");

test("builds cache paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cache-"));
  const paths = pathsFor(root, "0.2.0", "todo-engine");
  assert.equal(paths.activeBinary, path.join(root, "bin", "todo-engine"));
  assert.equal(paths.versionedBinary, path.join(root, "versions", "0.2.0", "todo-engine"));
  assert.equal(paths.metadataPath, path.join(root, "metadata.json"));
});

test("builds ui cache paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cache-"));
  const paths = uiPathsFor(root, "0.3.0");

  assert.equal(paths.uiDir, path.join(root, "ui"));
  assert.equal(paths.uiVersionDir, path.join(root, "ui", "0.3.0"));
  assert.equal(paths.uiIndexPath, path.join(root, "ui", "0.3.0", "index.html"));
});

test("reads and writes metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cache-"));
  assert.equal(await readMetadata(root), null);

  await writeMetadata(root, {
    installedVersion: "0.2.0",
    assetName: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz",
    binaryPath: path.join(root, "bin", "todo-engine"),
    installedAt: "2026-07-12T00:00:00.000Z",
  });

  assert.equal((await readMetadata(root)).installedVersion, "0.2.0");
});

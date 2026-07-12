const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { pathsFor, readMetadata, writeMetadata } = require("../src/cache");

test("builds cache paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cache-"));
  const paths = pathsFor(root, "0.2.0", "todo-engine");
  assert.equal(paths.activeBinary, path.join(root, "bin", "todo-engine"));
  assert.equal(paths.versionedBinary, path.join(root, "versions", "0.2.0", "todo-engine"));
  assert.equal(paths.metadataPath, path.join(root, "metadata.json"));
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

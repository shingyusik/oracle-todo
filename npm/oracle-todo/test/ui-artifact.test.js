const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installUiArtifact, uiAssetName } = require("../src/ui-artifact");

async function fakeUiExtractor(_archivePath, destination) {
  const root = path.join(destination, "oracle-todo-ui-0.3.0");
  await fs.mkdir(path.join(root, "_next"), { recursive: true });
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Oracle Todo</title>");
  await fs.writeFile(path.join(root, "merovingian-mark.png"), "png");
}

test("builds ui release asset names", () => {
  assert.equal(uiAssetName("0.3.0"), "oracle-todo-ui-0.3.0.tar.gz");
});

test("installs ui artifacts extracted under an archive root", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-ui-"));
  const result = await installUiArtifact({
    cacheRoot,
    version: "0.3.0",
    release: {
      assets: [{ name: "oracle-todo-ui-0.3.0.tar.gz", browser_download_url: "https://example.test/ui" }],
    },
    downloadFileImpl: async (_url, destination) => fs.writeFile(destination, "archive"),
    extractArchiveImpl: fakeUiExtractor,
  });

  assert.equal(result.uiVersion, "0.3.0");
  assert.equal(result.uiAssetName, "oracle-todo-ui-0.3.0.tar.gz");
  assert.equal(await fs.readFile(path.join(result.uiPath, "index.html"), "utf8"), "<!doctype html><title>Oracle Todo</title>");
});

test("rejects ui checksum mismatches", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-ui-"));
  await assert.rejects(
    () =>
      installUiArtifact({
        cacheRoot,
        version: "0.3.0",
        release: {
          assets: [
            { name: "oracle-todo-ui-0.3.0.tar.gz", browser_download_url: "https://example.test/ui" },
            { name: "SHA256SUMS", browser_download_url: "https://example.test/SHA256SUMS" },
          ],
        },
        downloadFileImpl: async (url, destination) => {
          if (url.endsWith("SHA256SUMS")) {
            return fs.writeFile(destination, `${"0".repeat(64)}  oracle-todo-ui-0.3.0.tar.gz\n`);
          }
          return fs.writeFile(destination, Buffer.from("archive"));
        },
        extractArchiveImpl: fakeUiExtractor,
      }),
    /Checksum mismatch/
  );
});

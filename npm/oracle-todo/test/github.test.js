const assert = require("node:assert/strict");
const test = require("node:test");

const { fetchRelease, selectAsset } = require("../src/github");

test("fetches latest release by default", async () => {
  const calls = [];
  const release = await fetchRelease({
    repository: "owner/repo",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: "v0.2.0", assets: [] }),
      };
    },
  });

  assert.equal(calls[0].url, "https://api.github.com/repos/owner/repo/releases/latest");
  assert.equal(release.tag_name, "v0.2.0");
});

test("fetches explicit release versions", async () => {
  const calls = [];
  await fetchRelease({
    repository: "owner/repo",
    version: "0.2.0",
    token: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ tag_name: "v0.2.0", assets: [] }) };
    },
  });

  assert.equal(calls[0].url, "https://api.github.com/repos/owner/repo/releases/tags/v0.2.0");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
});

test("selects matching release assets", () => {
  const release = {
    assets: [
      { name: "other.tar.gz", browser_download_url: "https://example.test/other" },
      { name: "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz", browser_download_url: "https://example.test/match" },
    ],
  };

  assert.equal(
    selectAsset(release, "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz").browser_download_url,
    "https://example.test/match"
  );
});

test("reports missing release assets", () => {
  assert.throws(() => selectAsset({ assets: [] }, "missing.tar.gz"), /Release asset not found: missing\.tar\.gz/);
});

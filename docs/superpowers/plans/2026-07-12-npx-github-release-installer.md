# npx GitHub Release Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `npx @shings/oracle-todo` as a Rust-free local runner that downloads `todo-engine` binaries from GitHub Releases and forwards commands to the engine.

**Architecture:** Add a small Node.js package under `npm/oracle-todo/` that owns platform resolution, GitHub Release lookup, cache metadata, install/update commands, and child-process forwarding. Add a GitHub Actions release workflow that publishes platform archives matching the wrapper's asset naming rules. Keep SQLite data ownership entirely inside the existing Rust engine.

**Tech Stack:** Node.js 18+ standard library, npm scoped package `@shings/oracle-todo`, GitHub Releases API, GitHub Actions, existing Rust workspace and `cargo build --release`.

## Global Constraints

- npm package: `@shings/oracle-todo`
- CLI command exposed by the package: `oracle-todo`
- Runtime target binary: `todo-engine`
- Use cache root `~/.local/share/oracle-todo/` unless `ORACLE_TODO_CACHE_DIR` is set.
- Support release assets for `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`, and `x86_64-pc-windows-msvc`.
- Support `ORACLE_TODO_VERSION`, `ORACLE_TODO_CACHE_DIR`, and `ORACLE_TODO_GITHUB_TOKEN`.
- Wrapper-owned commands are `install`, `update`, `version`, and `doctor`.
- All other commands must be forwarded to `todo-engine`.
- Do not create, delete, migrate, or overwrite `todo.sqlite` from JavaScript.
- Do not require Rust or Cargo for the default user path.
- Keep source-build installation out of the first implementation.

---

## File Structure

- Create `npm/oracle-todo/package.json`: package metadata, `bin` entry, test scripts, Node engine floor.
- Create `npm/oracle-todo/bin/oracle-todo.js`: executable entrypoint that calls the CLI module and maps wrapper failures to exit code `1`.
- Create `npm/oracle-todo/src/config.js`: constants for package name, GitHub repo, cache paths, and supported environment variables.
- Create `npm/oracle-todo/src/platform.js`: platform-to-Rust-target and release asset naming logic.
- Create `npm/oracle-todo/src/version.js`: semantic version normalization and comparison.
- Create `npm/oracle-todo/src/cache.js`: cache path creation, metadata read/write, active binary path resolution.
- Create `npm/oracle-todo/src/github.js`: GitHub Release API client and asset selection.
- Create `npm/oracle-todo/src/archive.js`: archive download, checksum verification when available, extraction, and executable permission handling.
- Create `npm/oracle-todo/src/install.js`: install/update orchestration.
- Create `npm/oracle-todo/src/runner.js`: command forwarding to the active engine binary.
- Create `npm/oracle-todo/src/cli.js`: wrapper command parsing and command dispatch.
- Create `npm/oracle-todo/test/*.test.js`: Node test runner coverage for platform, versions, cache, GitHub lookup, install/update, and forwarding.
- Create `.github/workflows/release.yml`: tag-triggered Rust release asset workflow.
- Modify `docs/operations/setup.md`: document `npx @shings/oracle-todo`.
- Modify `README.md`: add the npx path to setup while keeping Cargo development setup.

---

### Task 1: npm Package Scaffold and Platform Resolution

**Files:**
- Create: `npm/oracle-todo/package.json`
- Create: `npm/oracle-todo/bin/oracle-todo.js`
- Create: `npm/oracle-todo/src/config.js`
- Create: `npm/oracle-todo/src/platform.js`
- Create: `npm/oracle-todo/test/platform.test.js`

**Interfaces:**
- Produces: `resolvePlatform({ platform, arch }): { platform, arch, target, extension, binaryName }`
- Produces: `assetName(version, target): string`
- Produces: `SUPPORTED_TARGETS: readonly string[]`
- Later tasks consume `assetName()` and `resolvePlatform()` to choose GitHub assets.

- [ ] **Step 1: Write the failing platform tests**

Create `npm/oracle-todo/test/platform.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { assetName, resolvePlatform, SUPPORTED_TARGETS } = require("../src/platform");

test("resolves supported Node platforms to Rust targets", () => {
  assert.deepEqual(resolvePlatform({ platform: "darwin", arch: "arm64" }), {
    platform: "darwin",
    arch: "arm64",
    target: "aarch64-apple-darwin",
    extension: ".tar.gz",
    binaryName: "todo-engine",
  });
  assert.deepEqual(resolvePlatform({ platform: "darwin", arch: "x64" }).target, "x86_64-apple-darwin");
  assert.deepEqual(resolvePlatform({ platform: "linux", arch: "x64" }).target, "x86_64-unknown-linux-gnu");
  assert.deepEqual(resolvePlatform({ platform: "win32", arch: "x64" }), {
    platform: "win32",
    arch: "x64",
    target: "x86_64-pc-windows-msvc",
    extension: ".zip",
    binaryName: "todo-engine.exe",
  });
});

test("rejects unsupported platforms with a useful message", () => {
  assert.throws(
    () => resolvePlatform({ platform: "linux", arch: "arm64" }),
    /Unsupported platform linux\/arm64\. Supported targets:/
  );
});

test("builds release asset names", () => {
  assert.equal(
    assetName("0.2.0", "aarch64-apple-darwin"),
    "todo-engine-0.2.0-aarch64-apple-darwin.tar.gz"
  );
  assert.equal(
    assetName("v0.2.0", "x86_64-pc-windows-msvc"),
    "todo-engine-0.2.0-x86_64-pc-windows-msvc.zip"
  );
});

test("exports the supported Rust targets", () => {
  assert.deepEqual(SUPPORTED_TARGETS, [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-unknown-linux-gnu",
    "x86_64-pc-windows-msvc",
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test npm/oracle-todo/test/platform.test.js
```

Expected: FAIL with a module-not-found error for `../src/platform`.

- [ ] **Step 3: Add the package scaffold**

Create `npm/oracle-todo/package.json`:

```json
{
  "name": "@shings/oracle-todo",
  "version": "0.1.0",
  "description": "npx runner for todo-engine GitHub Release binaries",
  "license": "MIT",
  "type": "commonjs",
  "bin": {
    "oracle-todo": "bin/oracle-todo.js"
  },
  "files": [
    "bin",
    "src"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node --test"
  }
}
```

Create `npm/oracle-todo/bin/oracle-todo.js`:

```js
#!/usr/bin/env node

const { main } = require("../src/cli");

main(process.argv.slice(2)).catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
```

Create `npm/oracle-todo/src/config.js`:

```js
const path = require("node:path");
const os = require("node:os");

const PACKAGE_NAME = "@shings/oracle-todo";
const COMMAND_NAME = "oracle-todo";
const ENGINE_BINARY = "todo-engine";
const GITHUB_REPOSITORY = "shingyusik/oracle-todo";
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".local", "share", "oracle-todo");

function cacheDir(env = process.env) {
  return env.ORACLE_TODO_CACHE_DIR || DEFAULT_CACHE_DIR;
}

module.exports = {
  PACKAGE_NAME,
  COMMAND_NAME,
  ENGINE_BINARY,
  GITHUB_REPOSITORY,
  DEFAULT_CACHE_DIR,
  cacheDir,
};
```

Create `npm/oracle-todo/src/platform.js`:

```js
const SUPPORTED_TARGETS = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "x86_64-pc-windows-msvc",
];

const TARGETS = {
  "darwin/arm64": { target: "aarch64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
  "darwin/x64": { target: "x86_64-apple-darwin", extension: ".tar.gz", binaryName: "todo-engine" },
  "linux/x64": { target: "x86_64-unknown-linux-gnu", extension: ".tar.gz", binaryName: "todo-engine" },
  "win32/x64": { target: "x86_64-pc-windows-msvc", extension: ".zip", binaryName: "todo-engine.exe" },
};

function normalizeVersion(version) {
  return String(version).replace(/^v/, "");
}

function resolvePlatform({ platform = process.platform, arch = process.arch } = {}) {
  const key = `${platform}/${arch}`;
  const resolved = TARGETS[key];
  if (!resolved) {
    throw new Error(`Unsupported platform ${key}. Supported targets: ${SUPPORTED_TARGETS.join(", ")}`);
  }
  return { platform, arch, ...resolved };
}

function assetName(version, target) {
  const extension = target === "x86_64-pc-windows-msvc" ? ".zip" : ".tar.gz";
  return `todo-engine-${normalizeVersion(version)}-${target}${extension}`;
}

module.exports = {
  SUPPORTED_TARGETS,
  assetName,
  resolvePlatform,
};
```

- [ ] **Step 4: Add a temporary CLI stub**

Create `npm/oracle-todo/src/cli.js` so the bin file can load:

```js
async function main() {
  throw new Error("oracle-todo CLI is not implemented yet");
}

module.exports = { main };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: PASS for all `platform.test.js` tests.

- [ ] **Step 6: Commit**

```bash
git add npm/oracle-todo/package.json npm/oracle-todo/bin/oracle-todo.js npm/oracle-todo/src/config.js npm/oracle-todo/src/platform.js npm/oracle-todo/src/cli.js npm/oracle-todo/test/platform.test.js
git commit -m "[ADD] Add oracle todo npm package scaffold

- npx 실행 진입점과 패키지 메타데이터 추가
- 지원 플랫폼을 Rust 릴리스 타깃으로 매핑
- 릴리스 asset 이름 규칙을 테스트로 고정"
```

---

### Task 2: Version, Cache, and GitHub Release Lookup

**Files:**
- Create: `npm/oracle-todo/src/version.js`
- Create: `npm/oracle-todo/src/cache.js`
- Create: `npm/oracle-todo/src/github.js`
- Create: `npm/oracle-todo/test/version.test.js`
- Create: `npm/oracle-todo/test/cache.test.js`
- Create: `npm/oracle-todo/test/github.test.js`

**Interfaces:**
- Consumes: `assetName(version, target)` from `src/platform.js`
- Produces: `compareVersions(a, b): number`
- Produces: `normalizeVersion(version): string`
- Produces: `pathsFor(cacheRoot, version, binaryName): { root, binDir, versionsDir, versionDir, metadataPath, activeBinary, versionedBinary }`
- Produces: `readMetadata(cacheRoot): object | null`
- Produces: `writeMetadata(cacheRoot, metadata): Promise<void>`
- Produces: `fetchRelease({ version, repository, token, fetchImpl }): Promise<object>`
- Produces: `selectAsset(release, expectedName): object`

- [ ] **Step 1: Write failing tests for version comparison**

Create `npm/oracle-todo/test/version.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { compareVersions, normalizeVersion } = require("../src/version");

test("normalizes optional v prefix", () => {
  assert.equal(normalizeVersion("v0.2.0"), "0.2.0");
  assert.equal(normalizeVersion("0.2.0"), "0.2.0");
});

test("compares semantic versions", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.3.0", "0.2.9"), 1);
  assert.equal(compareVersions("0.2.9", "0.3.0"), -1);
  assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
});
```

- [ ] **Step 2: Write failing tests for cache metadata**

Create `npm/oracle-todo/test/cache.test.js`:

```js
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
```

- [ ] **Step 3: Write failing tests for GitHub release lookup**

Create `npm/oracle-todo/test/github.test.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: FAIL with module-not-found errors for `version`, `cache`, and `github`.

- [ ] **Step 5: Implement version utilities**

Create `npm/oracle-todo/src/version.js`:

```js
function normalizeVersion(version) {
  return String(version).trim().replace(/^v/, "");
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10));
  const b = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta > 0) return 1;
    if (delta < 0) return -1;
  }
  return 0;
}

module.exports = {
  compareVersions,
  normalizeVersion,
};
```

- [ ] **Step 6: Implement cache metadata**

Create `npm/oracle-todo/src/cache.js`:

```js
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

module.exports = {
  pathsFor,
  readMetadata,
  writeMetadata,
};
```

- [ ] **Step 7: Implement GitHub lookup**

Create `npm/oracle-todo/src/github.js`:

```js
function tagFor(version) {
  if (!version) return null;
  return String(version).startsWith("v") ? String(version) : `v${version}`;
}

async function fetchRelease({ version, repository, token, fetchImpl = globalThis.fetch }) {
  if (!fetchImpl) {
    throw new Error("This command requires Node.js 18 or newer with global fetch support");
  }

  const endpoint = version
    ? `https://api.github.com/repos/${repository}/releases/tags/${tagFor(version)}`
    : `https://api.github.com/repos/${repository}/releases/latest`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "@shings/oracle-todo",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(endpoint, { headers });
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with HTTP ${response.status}`);
  }
  return response.json();
}

function selectAsset(release, expectedName) {
  const asset = (release.assets || []).find((candidate) => candidate.name === expectedName);
  if (!asset) {
    throw new Error(`Release asset not found: ${expectedName}`);
  }
  return asset;
}

module.exports = {
  fetchRelease,
  selectAsset,
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: PASS for platform, version, cache, and GitHub tests.

- [ ] **Step 9: Commit**

```bash
git add npm/oracle-todo/src/version.js npm/oracle-todo/src/cache.js npm/oracle-todo/src/github.js npm/oracle-todo/test/version.test.js npm/oracle-todo/test/cache.test.js npm/oracle-todo/test/github.test.js
git commit -m "[ADD] Add release lookup and cache metadata

- GitHub Release 조회와 asset 선택 규칙 추가
- 바이너리 캐시 경로와 metadata.json 저장 형식 고정
- 버전 비교 테스트로 update 판단 기반 마련"
```

---

### Task 3: Download, Extract, Install, and Update

**Files:**
- Create: `npm/oracle-todo/src/archive.js`
- Create: `npm/oracle-todo/src/install.js`
- Create: `npm/oracle-todo/test/install.test.js`

**Interfaces:**
- Consumes: `pathsFor()`, `readMetadata()`, `writeMetadata()`, `fetchRelease()`, `selectAsset()`, `resolvePlatform()`, `assetName()`, `compareVersions()`, `normalizeVersion()`
- Produces: `installEngine(options): Promise<object>`
- Produces: `updateEngine(options): Promise<object>`
- Produces: `downloadFile(url, destination, options): Promise<void>`
- Produces: `verifyChecksum(archivePath, checksumsText, expectedName): Promise<void>`
- Produces: `extractArchive(archivePath, destination, options): Promise<void>`
- Produces: `activateBinary(paths, binaryName): Promise<void>`

- [ ] **Step 1: Write failing install/update tests**

Create `npm/oracle-todo/test/install.test.js`:

```js
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installEngine, updateEngine } = require("../src/install");
const { readMetadata } = require("../src/cache");

async function fakeExtractor(archivePath, destination) {
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "todo-engine"), "#!/bin/sh\necho fake engine\n", { mode: 0o755 });
}

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: FAIL with a module-not-found error for `../src/install`.

- [ ] **Step 3: Implement archive helpers**

Create `npm/oracle-todo/src/archive.js`:

```js
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

async function activateBinary(paths, binaryName) {
  await fs.mkdir(paths.binDir, { recursive: true });
  await fs.copyFile(paths.versionedBinary, paths.activeBinary);
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
```

- [ ] **Step 4: Implement install/update orchestration**

Create `npm/oracle-todo/src/install.js`:

```js
const fs = require("node:fs/promises");
const path = require("node:path");

const { downloadFile, extractArchive, activateBinary, verifyChecksum } = require("./archive");
const { pathsFor, readMetadata, writeMetadata } = require("./cache");
const { cacheDir, GITHUB_REPOSITORY } = require("./config");
const { fetchRelease, selectAsset } = require("./github");
const { assetName, resolvePlatform } = require("./platform");
const { compareVersions, normalizeVersion } = require("./version");

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
  await activateBinary(paths, options.platformInfo.binaryName);

  const metadata = {
    installedVersion: options.version,
    assetName: expectedAsset,
    binaryPath: paths.activeBinary,
    installedAt: (options.now || (() => new Date()))().toISOString(),
  };
  await writeMetadata(options.cacheRoot, metadata);
  return { status: "installed", ...metadata };
}

module.exports = {
  installEngine,
  updateEngine,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: PASS for all package tests.

- [ ] **Step 6: Commit**

```bash
git add npm/oracle-todo/src/archive.js npm/oracle-todo/src/install.js npm/oracle-todo/test/install.test.js
git commit -m "[ADD] Add binary install and update flow

- GitHub Release asset 다운로드와 archive 추출 흐름 추가
- 버전별 캐시와 active binary 교체 로직 구현
- 기존 설치 상태와 최신 버전 판단을 테스트로 검증"
```

---

### Task 4: CLI Dispatch, Command Forwarding, Version, and Doctor

**Files:**
- Modify: `npm/oracle-todo/src/cli.js`
- Create: `npm/oracle-todo/src/runner.js`
- Create: `npm/oracle-todo/test/cli.test.js`
- Create: `npm/oracle-todo/test/runner.test.js`

**Interfaces:**
- Consumes: `installEngine()`, `updateEngine()`, `readMetadata()`, `cacheDir()`
- Produces: `runEngine(args, options): Promise<number>`
- Produces: `main(args, options): Promise<number | undefined>`

- [ ] **Step 1: Write failing runner tests**

Create `npm/oracle-todo/test/runner.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runEngine } = require("../src/runner");

test("forwards arguments to an engine binary and returns its exit code", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-runner-"));
  const engine = path.join(dir, "todo-engine");
  const output = path.join(dir, "args.txt");
  await fs.writeFile(engine, `#!/bin/sh\necho "$@" > "${output}"\nexit 7\n`, { mode: 0o755 });

  const code = await runEngine(["today", "--json"], { binaryPath: engine, stdio: "ignore" });
  assert.equal(code, 7);
  assert.equal((await fs.readFile(output, "utf8")).trim(), "today --json");
});
```

- [ ] **Step 2: Write failing CLI tests**

Create `npm/oracle-todo/test/cli.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { main } = require("../src/cli");

test("dispatches install", async () => {
  const calls = [];
  await main(["install"], {
    installEngine: async () => calls.push("install"),
    log: () => {},
  });
  assert.deepEqual(calls, ["install"]);
});

test("dispatches update", async () => {
  const calls = [];
  await main(["update"], {
    updateEngine: async () => calls.push("update"),
    log: () => {},
  });
  assert.deepEqual(calls, ["update"]);
});

test("forwards normal engine commands after ensuring install", async () => {
  const calls = [];
  const code = await main(["today"], {
    installEngine: async () => calls.push(["install"]),
    runEngine: async (args) => {
      calls.push(["run", args]);
      return 4;
    },
    log: () => {},
  });

  assert.equal(code, 4);
  assert.deepEqual(calls, [["install"], ["run", ["today"]]]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: FAIL with a module-not-found error for `../src/runner` and CLI stub behavior.

- [ ] **Step 4: Implement command forwarding**

Create `npm/oracle-todo/src/runner.js`:

```js
const { spawn } = require("node:child_process");

function runEngine(args, { binaryPath, stdio = "inherit" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio });
    child.on("error", reject);
    child.on("close", (code) => resolve(code || 0));
  });
}

module.exports = { runEngine };
```

- [ ] **Step 5: Implement CLI dispatch**

Replace `npm/oracle-todo/src/cli.js`:

```js
const { readMetadata } = require("./cache");
const { cacheDir, PACKAGE_NAME } = require("./config");
const { installEngine, updateEngine } = require("./install");
const { runEngine } = require("./runner");

async function main(args, options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;
  const install = options.installEngine || installEngine;
  const update = options.updateEngine || updateEngine;
  const run = options.runEngine || runEngine;
  const command = args[0];

  if (command === "install") {
    const result = await install({ env });
    log(`${PACKAGE_NAME}: ${result.status} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "update") {
    const result = await update({ env });
    log(`${PACKAGE_NAME}: ${result.status} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "version") {
    const metadata = await readMetadata(cacheDir(env));
    log(`${PACKAGE_NAME} wrapper`);
    log(`todo-engine ${metadata ? metadata.installedVersion : "not installed"}`);
    return 0;
  }

  if (command === "doctor") {
    const metadata = await readMetadata(cacheDir(env));
    if (!metadata) throw new Error("todo-engine is not installed; run install first");
    log(`cache ok: ${metadata.binaryPath}`);
    return 0;
  }

  const installed = await install({ env });
  const binaryPath = installed.binaryPath;
  const exitCode = await run(args, { binaryPath });
  return exitCode;
}

module.exports = { main };
```

- [ ] **Step 6: Make the bin entrypoint preserve engine exit codes**

Replace `npm/oracle-todo/bin/oracle-todo.js`:

```js
#!/usr/bin/env node

const { main } = require("../src/cli");

main(process.argv.slice(2))
  .then((code) => {
    if (Number.isInteger(code)) process.exit(code);
  })
  .catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  });
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: PASS for all package tests.

- [ ] **Step 8: Commit**

```bash
git add npm/oracle-todo/bin/oracle-todo.js npm/oracle-todo/src/cli.js npm/oracle-todo/src/runner.js npm/oracle-todo/test/cli.test.js npm/oracle-todo/test/runner.test.js
git commit -m "[ADD] Add npx command dispatch

- wrapper 전용 install/update/version/doctor 명령 연결
- 일반 명령은 todo-engine 바이너리로 위임
- engine exit code를 npx 호출자에게 그대로 반환"
```

---

### Task 5: GitHub Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: release asset names from the design:
  - `todo-engine-<version>-aarch64-apple-darwin.tar.gz`
  - `todo-engine-<version>-x86_64-apple-darwin.tar.gz`
  - `todo-engine-<version>-x86_64-unknown-linux-gnu.tar.gz`
  - `todo-engine-<version>-x86_64-pc-windows-msvc.zip`
- Produces: release archives and `SHA256SUMS` attached to tag releases.

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write

jobs:
  build:
    name: Build ${{ matrix.target }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            target: aarch64-apple-darwin
            archive: tar.gz
          - os: macos-13
            target: x86_64-apple-darwin
            archive: tar.gz
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
            archive: tar.gz
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            archive: zip
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - name: Build
        run: cargo build -p todo-engine --release --target ${{ matrix.target }}
      - name: Package Unix
        if: matrix.archive == 'tar.gz'
        shell: bash
        run: |
          version="${GITHUB_REF_NAME#v}"
          name="todo-engine-${version}-${{ matrix.target }}"
          mkdir -p "dist/${name}"
          cp "target/${{ matrix.target }}/release/todo-engine" "dist/${name}/todo-engine"
          cp README.md "dist/${name}/README.md"
          test ! -f LICENSE || cp LICENSE "dist/${name}/LICENSE"
          tar -C dist -czf "dist/${name}.tar.gz" "${name}"
      - name: Package Windows
        if: matrix.archive == 'zip'
        shell: pwsh
        run: |
          $version = $env:GITHUB_REF_NAME.TrimStart("v")
          $name = "todo-engine-$version-${{ matrix.target }}"
          New-Item -ItemType Directory -Force -Path "dist/$name"
          Copy-Item "target/${{ matrix.target }}/release/todo-engine.exe" "dist/$name/todo-engine.exe"
          Copy-Item "README.md" "dist/$name/README.md"
          if (Test-Path "LICENSE") { Copy-Item "LICENSE" "dist/$name/LICENSE" }
          Compress-Archive -Force -Path "dist/$name/*" -DestinationPath "dist/$name.zip"
      - uses: actions/upload-artifact@v4
        with:
          name: todo-engine-${{ matrix.target }}
          path: |
            dist/*.tar.gz
            dist/*.zip

  publish:
    name: Publish Release
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: dist
          merge-multiple: true
      - name: Generate checksums
        run: |
          cd dist
          sha256sum *.tar.gz *.zip > SHA256SUMS
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/*.tar.gz
            dist/*.zip
            dist/SHA256SUMS
```

- [ ] **Step 2: Validate workflow syntax locally enough for YAML parse**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml"); puts "yaml ok"'
```

Expected: prints `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "[ADD] Add GitHub release workflow

- 태그 기반으로 지원 플랫폼별 todo-engine 바이너리 빌드
- wrapper가 기대하는 asset 이름으로 archive 생성
- SHA256SUMS를 함께 릴리스에 업로드"
```

---

### Task 6: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/setup.md`

**Interfaces:**
- Consumes: implemented package name `@shings/oracle-todo`
- Produces: user-facing install/update instructions for local non-Rust usage.

- [ ] **Step 1: Update setup docs with npx usage**

In `docs/operations/setup.md`, add this section after prerequisites:

```markdown
## Run with npx

Use the npm wrapper when you want to run the local engine without installing Rust:

```bash
npx @shings/oracle-todo init
npx @shings/oracle-todo today
npx @shings/oracle-todo pending
```

The wrapper downloads a compatible `todo-engine` binary from GitHub Releases and stores it
under `~/.local/share/oracle-todo/`. User data stays in the normal data home:
`~/.todo-engine/` unless `--home` or `TODO_ENGINE_HOME` points elsewhere.

Update the cached binary:

```bash
npx @shings/oracle-todo update
```
```

- [ ] **Step 2: Update README setup with both paths**

In `README.md`, replace the current `## Setup` section with:

```markdown
## Setup

Run without a Rust toolchain:

```bash
npx @shings/oracle-todo init
npx @shings/oracle-todo today
```

Build from source for development:

```bash
cargo build
cargo run -p todo-engine -- init
```
```

Keep the existing default data directory section after this replacement.

- [ ] **Step 3: Run package tests**

Run:

```bash
cd npm/oracle-todo && npm test
```

Expected: PASS for all Node tests.

- [ ] **Step 4: Run Rust verification**

Run:

```bash
cargo fmt --check
cargo test
```

Expected: both commands pass.

- [ ] **Step 5: Run a local wrapper smoke with a fake cached binary**

Run:

```bash
tmp_cache="$(mktemp -d)"
mkdir -p "$tmp_cache/bin"
cat > "$tmp_cache/bin/todo-engine" <<'SH'
#!/bin/sh
echo "fake todo-engine $*"
exit 0
SH
chmod +x "$tmp_cache/bin/todo-engine"
cat > "$tmp_cache/metadata.json" <<JSON
{
  "installedVersion": "0.0.0-test",
  "assetName": "fake",
  "binaryPath": "$tmp_cache/bin/todo-engine",
  "installedAt": "2026-07-12T00:00:00.000Z"
}
JSON
ORACLE_TODO_CACHE_DIR="$tmp_cache" node npm/oracle-todo/bin/oracle-todo.js today
```

Expected output:

```text
fake todo-engine today
```

- [ ] **Step 6: Commit**

```bash
git add README.md docs/operations/setup.md
git commit -m "[DOCS] Document npx local install path

- Rust 없이 실행하는 npx 사용법 추가
- GitHub Release 바이너리 캐시 위치 설명
- 기존 Cargo 기반 개발 흐름은 별도 경로로 유지"
```

---

## Self-Review Notes

- Spec coverage: npm package name, command forwarding, wrapper commands, cache layout, platform mapping, GitHub Release lookup, environment overrides, release assets, release workflow, tests, and docs are covered by Tasks 1-6.
- Scope boundary: source-build installation is explicitly excluded from implementation and from wrapper commands.
- Data safety: no task adds JavaScript behavior that touches `todo.sqlite`; all data-home behavior remains inside `todo-engine`.

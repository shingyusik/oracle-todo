# npx Local UI Release Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npx @shings/oracle-todo ui` so the published wrapper downloads the release UI artifact, starts the local Rust API, serves the UI, and opens the browser.

**Architecture:** Keep npm as a small downloader/runtime wrapper. GitHub Releases publish a platform-neutral static Next.js UI archive beside platform-specific engine archives. The wrapper caches engine and UI artifacts by release version, then runs a Node static/proxy server in front of `todo-engine api`.

**Tech Stack:** Node.js 18+ CommonJS wrapper, Next.js 14 static export, GitHub Actions release assets, Rust `todo-engine api`, Node built-in `http`, `fs`, `child_process`, `net`.

## Global Constraints

- npm package remains `@shings/oracle-todo`.
- Default UI port is `3001`.
- Default API port is `3002`.
- UI release asset name is `oracle-todo-ui-<version>.tar.gz`.
- UI calls the API through relative `/todo-engine/*` URLs.
- `npx @shings/oracle-todo ui` opens the browser by default.
- `npx @shings/oracle-todo ui --no-open` starts servers and prints the URL only.
- `--home <path>` before `ui` is passed to `todo-engine api`.
- The wrapper must not require Rust, Cargo, frontend source checkout, or `npm install` for the npx runtime path.
- The wrapper must not create database rows, perform migrations directly, or bypass the Rust service layer.
- Do not bundle `frontend/node_modules` into the npm package.

---

## File Structure

- `frontend/next.config.mjs`: enable static export while preserving the development rewrite for `next dev`.
- `frontend/tests/architecture/design-boundaries.spec.ts`: assert static export and API rewrite contract.
- `.github/workflows/release.yml`: build frontend, package `oracle-todo-ui-<version>.tar.gz`, and include it in `SHA256SUMS` and the GitHub Release.
- `npm/oracle-todo/src/cache.js`: add UI cache paths under `<cacheRoot>/ui/<version>/`.
- `npm/oracle-todo/src/ui-artifact.js`: own UI asset naming, install, extraction, checksum validation, and `index.html` verification.
- `npm/oracle-todo/src/install.js`: expose bundle install/update helpers that keep engine and UI artifacts aligned for wrapper-owned commands.
- `npm/oracle-todo/src/ui-server.js`: serve static UI files and proxy `/todo-engine/*` to the local API.
- `npm/oracle-todo/src/ui-command.js`: parse `ui` options, start `todo-engine api`, start the UI server, open the browser, and handle shutdown.
- `npm/oracle-todo/src/cli.js`: route the wrapper-owned `ui`, `install`, `update`, `version`, and `doctor` behavior to the new bundle/UI functions.
- `npm/oracle-todo/test/*.test.js`: add focused Node tests for UI artifact installation, UI server behavior, and CLI dispatch.
- `docs/operations/setup.md`: document the local UI npx command and UI release artifact.
- `npm/oracle-todo/package.json`: bump the wrapper version after implementation.

---

### Task 1: Build and Publish the Static UI Release Artifact

**Files:**
- Modify: `frontend/next.config.mjs`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Produces: GitHub Release asset `oracle-todo-ui-<version>.tar.gz`.
- Produces: static UI directory shape with `index.html`, `_next/`, and `merovingian-mark.png`.
- Consumes: existing frontend relative API calls to `/todo-engine/*`.

- [ ] **Step 1: Write failing frontend architecture tests**

Add assertions to `frontend/tests/architecture/design-boundaries.spec.ts`:

```ts
it("exports the workbench as static files for release artifacts", async () => {
  const source = await readSource("next.config.mjs");

  expect(source).toContain('output: "export"');
  expect(source).toContain("rewrites()");
  expect(source).toContain("/todo-engine/:path*");
});
```

- [ ] **Step 2: Run the targeted frontend architecture test and verify it fails**

Run:

```bash
cd frontend
npm test -- tests/architecture/design-boundaries.spec.ts
```

Expected: FAIL because `next.config.mjs` does not contain `output: "export"`.

- [ ] **Step 3: Enable static export in Next config**

Change `frontend/next.config.mjs` to:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  async rewrites() {
    return [
      {
        source: "/todo-engine/:path*",
        destination: "http://127.0.0.1:3002/:path*",
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: Verify frontend tests and static build**

Run:

```bash
cd frontend
npm test -- tests/architecture/design-boundaries.spec.ts
npm run typecheck
npm run build
test -f out/index.html
test -d out/_next
test -f out/merovingian-mark.png
```

Expected: all commands exit `0`.

- [ ] **Step 5: Add UI artifact packaging to the release workflow**

In `.github/workflows/release.yml`, add a `build-ui` job:

```yaml
  build-ui:
    name: Build UI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          package-manager-cache: false
      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci
      - name: Test frontend
        working-directory: frontend
        run: npm test
      - name: Typecheck frontend
        working-directory: frontend
        run: npm run typecheck
      - name: Build static frontend
        working-directory: frontend
        run: npm run build
      - name: Package UI
        shell: bash
        run: |
          version="${GITHUB_REF_NAME#v}"
          name="oracle-todo-ui-${version}"
          mkdir -p "dist/${name}"
          cp -R frontend/out/. "dist/${name}/"
          tar -C dist -czf "dist/${name}.tar.gz" "${name}"
      - uses: actions/upload-artifact@v4
        with:
          name: oracle-todo-ui
          path: dist/oracle-todo-ui-*.tar.gz
```

Update the `publish` job dependencies and checksum command:

```yaml
  publish:
    name: Publish Release
    needs:
      - build
      - build-ui
```

```bash
sha256sum *.tar.gz *.zip > SHA256SUMS
```

The existing `files` block already includes `dist/*.tar.gz`, so the UI archive is uploaded with engine archives.

- [ ] **Step 6: Verify workflow syntax**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml"); puts "yaml ok"'
```

Expected: prints `yaml ok`.

- [ ] **Step 7: Commit Task 1**

```bash
git add frontend/next.config.mjs frontend/tests/architecture/design-boundaries.spec.ts .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
[ADD] Add static UI release artifact

- frontend 정적 export를 release artifact로 만들도록 설정
- release workflow에서 UI archive를 생성하고 SHA256SUMS에 포함
- frontend architecture test로 static export 계약 고정
EOF
)"
```

---

### Task 2: Install and Cache the UI Artifact in the Wrapper

**Files:**
- Modify: `npm/oracle-todo/src/cache.js`
- Create: `npm/oracle-todo/src/ui-artifact.js`
- Modify: `npm/oracle-todo/src/install.js`
- Modify: `npm/oracle-todo/test/cache.test.js`
- Create: `npm/oracle-todo/test/ui-artifact.test.js`
- Modify: `npm/oracle-todo/test/install.test.js`

**Interfaces:**
- Produces: `uiAssetName(version: string): string`.
- Produces: `uiPathsFor(root: string, version: string): { uiDir, uiVersionDir, uiIndexPath }`.
- Produces: `installUiArtifact(options): Promise<{ uiVersion, uiPath, uiAssetName }>`
- Produces: `installBundle(options): Promise<{ installedVersion, binaryPath, uiVersion, uiPath }>`
- Produces: `updateBundle(options): Promise<{ installedVersion, binaryPath, uiVersion, uiPath }>`
- Consumes: `downloadFile`, `extractArchive`, `verifyChecksum`, `selectAsset`, and normalized release versions.

- [ ] **Step 1: Write failing cache path test**

Add to `npm/oracle-todo/test/cache.test.js`:

```js
test("builds ui cache paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-cache-"));
  const paths = uiPathsFor(root, "0.3.0");

  assert.equal(paths.uiDir, path.join(root, "ui"));
  assert.equal(paths.uiVersionDir, path.join(root, "ui", "0.3.0"));
  assert.equal(paths.uiIndexPath, path.join(root, "ui", "0.3.0", "index.html"));
});
```

Update the import:

```js
const { pathsFor, readMetadata, uiPathsFor, writeMetadata } = require("../src/cache");
```

- [ ] **Step 2: Run cache test and verify it fails**

Run:

```bash
cd npm/oracle-todo
node --test test/cache.test.js
```

Expected: FAIL with `uiPathsFor is not a function`.

- [ ] **Step 3: Implement UI cache paths**

Add to `npm/oracle-todo/src/cache.js`:

```js
function uiPathsFor(root, version) {
  const uiDir = path.join(root, "ui");
  const uiVersionDir = path.join(uiDir, version);
  return {
    uiDir,
    uiVersionDir,
    uiIndexPath: path.join(uiVersionDir, "index.html"),
  };
}
```

Update exports:

```js
module.exports = {
  pathsFor,
  readMetadata,
  uiPathsFor,
  writeMetadata,
};
```

- [ ] **Step 4: Verify cache test passes**

Run:

```bash
cd npm/oracle-todo
node --test test/cache.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing UI artifact tests**

Create `npm/oracle-todo/test/ui-artifact.test.js`:

```js
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
```

- [ ] **Step 6: Run UI artifact tests and verify they fail**

Run:

```bash
cd npm/oracle-todo
node --test test/ui-artifact.test.js
```

Expected: FAIL because `../src/ui-artifact` does not exist.

- [ ] **Step 7: Implement UI artifact installation**

Create `npm/oracle-todo/src/ui-artifact.js`:

```js
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
```

- [ ] **Step 8: Verify UI artifact tests pass**

Run:

```bash
cd npm/oracle-todo
node --test test/ui-artifact.test.js
```

Expected: PASS.

- [ ] **Step 9: Write failing bundle install tests**

Add to `npm/oracle-todo/test/install.test.js`:

```js
const { installBundle, installEngine, updateBundle, updateEngine } = require("../src/install");
```

Add:

```js
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
```

- [ ] **Step 10: Run bundle test and verify it fails**

Run:

```bash
cd npm/oracle-todo
node --test test/install.test.js --test-name-pattern "bundle"
```

Expected: FAIL with `installBundle is not a function`.

- [ ] **Step 11: Implement bundle helpers**

Modify `npm/oracle-todo/src/install.js`:

```js
const { installUiArtifact } = require("./ui-artifact");
```

Add:

```js
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

  const engine = await installRelease({ ...options, cacheRoot, platformInfo, release, version });
  const ui = await installUiArtifact({ ...options, cacheRoot, release, version });
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
```

Update exports:

```js
module.exports = {
  installBundle,
  installEngine,
  updateBundle,
  updateEngine,
};
```

- [ ] **Step 12: Verify bundle and full wrapper tests**

Run:

```bash
cd npm/oracle-todo
node --test test/install.test.js --test-name-pattern "bundle"
npm test
```

Expected: PASS.

- [ ] **Step 13: Commit Task 2**

```bash
git add npm/oracle-todo/src/cache.js npm/oracle-todo/src/ui-artifact.js npm/oracle-todo/src/install.js npm/oracle-todo/test/cache.test.js npm/oracle-todo/test/ui-artifact.test.js npm/oracle-todo/test/install.test.js
git commit -m "$(cat <<'EOF'
[ADD] Install UI release artifacts in wrapper cache

- UI release archive 이름과 cache path를 wrapper에 추가
- engine과 UI artifact를 같은 release version으로 설치하는 bundle helper 구현
- checksum, archive root, metadata 회귀 테스트 추가
EOF
)"
```

---

### Task 3: Add the Local UI Runtime Command

**Files:**
- Create: `npm/oracle-todo/src/ui-server.js`
- Create: `npm/oracle-todo/src/ui-command.js`
- Modify: `npm/oracle-todo/src/cli.js`
- Create: `npm/oracle-todo/test/ui-server.test.js`
- Create: `npm/oracle-todo/test/ui-command.test.js`
- Modify: `npm/oracle-todo/test/cli.test.js`

**Interfaces:**
- Produces: `createUiServer({ uiPath, apiPort }): http.Server`.
- Produces: `parseUiArgs(args: string[]): { engineArgs, uiPort, apiPort, openBrowser }`.
- Produces: `runUi(args, options): Promise<number>`.
- Consumes: `installBundle()` result with `binaryPath` and `uiPath`.

- [ ] **Step 1: Write failing UI server tests**

Create `npm/oracle-todo/test/ui-server.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createUiServer } = require("../src/ui-server");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function read(url) {
  const response = await fetch(url);
  return { status: response.status, text: await response.text() };
}

test("serves static ui files and falls back to index", async () => {
  const uiPath = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-ui-server-"));
  await fs.mkdir(path.join(uiPath, "_next"), { recursive: true });
  await fs.writeFile(path.join(uiPath, "index.html"), "<!doctype html><main>Workbench</main>");
  await fs.writeFile(path.join(uiPath, "_next", "app.js"), "console.log('app')");

  const server = createUiServer({ uiPath, apiPort: 1 });
  const port = await listen(server);
  try {
    assert.deepEqual(await read(`http://127.0.0.1:${port}/_next/app.js`), { status: 200, text: "console.log('app')" });
    assert.deepEqual(await read(`http://127.0.0.1:${port}/workspace`), { status: 200, text: "<!doctype html><main>Workbench</main>" });
  } finally {
    await close(server);
  }
});

test("proxies todo-engine requests to the api server", async () => {
  const api = http.createServer((request, response) => {
    assert.equal(request.url, "/items?type=task");
    response.end("api ok");
  });
  const apiPort = await listen(api);
  const uiPath = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-todo-ui-server-"));
  await fs.writeFile(path.join(uiPath, "index.html"), "<!doctype html>");
  const server = createUiServer({ uiPath, apiPort });
  const port = await listen(server);
  try {
    assert.deepEqual(await read(`http://127.0.0.1:${port}/todo-engine/items?type=task`), { status: 200, text: "api ok" });
  } finally {
    await close(server);
    await close(api);
  }
});
```

- [ ] **Step 2: Run UI server tests and verify they fail**

Run:

```bash
cd npm/oracle-todo
node --test test/ui-server.test.js
```

Expected: FAIL because `../src/ui-server` does not exist.

- [ ] **Step 3: Implement UI static/proxy server**

Create `npm/oracle-todo/src/ui-server.js`:

```js
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function createUiServer({ uiPath, apiPort }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/todo-engine/")) {
        await proxyApi(request, response, url, apiPort);
        return;
      }
      await serveStatic(uiPath, url.pathname, response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
}

async function serveStatic(uiPath, pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const requested = path.normalize(path.join(uiPath, relativePath));
  const root = path.normalize(uiPath + path.sep);
  const filePath = requested.startsWith(root) ? requested : path.join(uiPath, "index.html");

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const content = await fs.readFile(path.join(uiPath, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(content);
  }
}

function proxyApi(request, response, url, apiPort) {
  return new Promise((resolve, reject) => {
    const apiPath = `${url.pathname.replace(/^\/todo-engine/, "")}${url.search}`;
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: apiPort,
        path: apiPath,
        method: request.method,
        headers: request.headers,
      },
      (apiResponse) => {
        response.writeHead(apiResponse.statusCode || 502, apiResponse.headers);
        apiResponse.pipe(response);
        apiResponse.on("end", resolve);
      },
    );
    proxy.on("error", reject);
    request.pipe(proxy);
  });
}

module.exports = { createUiServer };
```

- [ ] **Step 4: Verify UI server tests pass**

Run:

```bash
cd npm/oracle-todo
node --test test/ui-server.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing UI command tests**

Create `npm/oracle-todo/test/ui-command.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { parseUiArgs } = require("../src/ui-command");

test("parses ui ports and browser option while preserving engine args", () => {
  assert.deepEqual(parseUiArgs(["--home", "/tmp/todo", "ui", "--no-open", "--ui-port", "3101", "--api-port", "3102"]), {
    engineArgs: ["--home", "/tmp/todo"],
    uiPort: 3101,
    apiPort: 3102,
    openBrowser: false,
  });
});

test("uses default ui command ports", () => {
  assert.deepEqual(parseUiArgs(["ui"]), {
    engineArgs: [],
    uiPort: 3001,
    apiPort: 3002,
    openBrowser: true,
  });
});
```

- [ ] **Step 6: Run UI command tests and verify they fail**

Run:

```bash
cd npm/oracle-todo
node --test test/ui-command.test.js
```

Expected: FAIL because `../src/ui-command` does not exist.

- [ ] **Step 7: Implement UI command parser and runtime**

Create `npm/oracle-todo/src/ui-command.js`:

```js
const { spawn } = require("node:child_process");
const net = require("node:net");

const { createUiServer } = require("./ui-server");

function parseUiArgs(args) {
  const uiIndex = args.indexOf("ui");
  const engineArgs = uiIndex < 0 ? [] : args.slice(0, uiIndex);
  const uiArgs = uiIndex < 0 ? args : args.slice(uiIndex + 1);
  const result = { engineArgs, uiPort: 3001, apiPort: 3002, openBrowser: true };

  for (let index = 0; index < uiArgs.length; index += 1) {
    const arg = uiArgs[index];
    if (arg === "--no-open") {
      result.openBrowser = false;
    } else if (arg === "--ui-port") {
      result.uiPort = parsePort(uiArgs[++index], "--ui-port");
    } else if (arg === "--api-port") {
      result.apiPort = parsePort(uiArgs[++index], "--api-port");
    } else {
      throw new Error(`Unknown ui option: ${arg}`);
    }
  }
  return result;
}

function parsePort(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} requires a port between 1 and 65535`);
  }
  return port;
}

async function runUi(args, options = {}) {
  const parsed = parseUiArgs(args);
  const install = options.installBundle;
  const installed = await install({ env: options.env || process.env });
  const api = spawn(installed.binaryPath, [...parsed.engineArgs, "api", "--host", "127.0.0.1", "--port", String(parsed.apiPort)], {
    stdio: "inherit",
  });
  await waitForPort(parsed.apiPort, api);

  const server = createUiServer({ uiPath: installed.uiPath, apiPort: parsed.apiPort });
  await listen(server, parsed.uiPort);
  const url = `http://127.0.0.1:${parsed.uiPort}`;
  (options.log || console.log)(`oracle-todo ui: ${url}`);
  if (parsed.openBrowser) {
    await openBrowser(url, options).catch(() => (options.log || console.log)(`open ${url}`));
  }
  await waitForExit(api, server);
  return 0;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function waitForPort(port, child) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        clearInterval(timer);
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        if (Date.now() - started > 10_000) {
          clearInterval(timer);
          reject(new Error(`todo-engine api did not become reachable on 127.0.0.1:${port}`));
        }
      });
    }, 100);
    child.once("exit", (code) => {
      clearInterval(timer);
      reject(new Error(`todo-engine api exited before startup with code ${code}`));
    });
  });
}

function openBrowser(url, options = {}) {
  const opener = options.spawnImpl || spawn;
  const platform = options.platform || process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve, reject) => {
    const child = opener(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`))));
  });
}

function waitForExit(child, server) {
  return new Promise((resolve) => {
    const stop = () => {
      server.close(() => resolve());
      if (!child.killed) child.kill();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("exit", () => server.close(() => resolve()));
  });
}

module.exports = {
  parseUiArgs,
  runUi,
};
```

- [ ] **Step 8: Verify UI command parser tests pass**

Run:

```bash
cd npm/oracle-todo
node --test test/ui-command.test.js
```

Expected: PASS.

- [ ] **Step 9: Write failing CLI dispatch tests**

Add to `npm/oracle-todo/test/cli.test.js`:

```js
test("dispatches ui without forwarding to the engine command runner", async () => {
  const calls = [];
  const code = await main(["--home", "/tmp/todo", "ui", "--no-open"], {
    installBundle: async () => {
      calls.push(["installBundle"]);
      return { binaryPath: "/tmp/todo-engine", uiPath: "/tmp/ui", installedVersion: "0.3.0", uiVersion: "0.3.0" };
    },
    runUi: async (args) => {
      calls.push(["ui", args]);
      return 0;
    },
    runEngine: async () => {
      throw new Error("engine runner should not be called");
    },
    log: () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, [["ui", ["--home", "/tmp/todo", "ui", "--no-open"]]]);
});
```

- [ ] **Step 10: Run CLI test and verify it fails**

Run:

```bash
cd npm/oracle-todo
node --test test/cli.test.js --test-name-pattern "dispatches ui"
```

Expected: FAIL because `ui` is forwarded as an engine command.

- [ ] **Step 11: Wire `ui`, bundle install/update, version, and doctor**

Modify `npm/oracle-todo/src/cli.js`:

```js
const { installBundle, installEngine, updateBundle } = require("./install");
const { runUi } = require("./ui-command");
```

Inside `main`:

```js
  const install = options.installEngine || installEngine;
  const installAll = options.installBundle || installBundle;
  const updateAll = options.updateBundle || updateBundle;
  const ui = options.runUi || runUi;
  const command = args.includes("ui") ? "ui" : args[0];

  if (command === "install") {
    const result = await installAll({ env });
    log(`${PACKAGE_NAME}: ${result.status || "installed"} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "update") {
    const result = await updateAll({ env });
    log(`${PACKAGE_NAME}: ${result.status || "installed"} ${result.installedVersion || ""}`.trim());
    return 0;
  }

  if (command === "ui") {
    return ui(args, { env, installBundle: installAll, log });
  }
```

Update `version` output:

```js
    log(`todo-engine ${metadata ? metadata.installedVersion : "not installed"}`);
    log(`oracle-todo-ui ${metadata && metadata.uiVersion ? metadata.uiVersion : "not installed"}`);
```

Update `doctor` output to require both `binaryPath` and `uiPath`:

```js
    if (!metadata) throw new Error("todo-engine is not installed; run install first");
    if (!metadata.uiPath) throw new Error("oracle-todo-ui is not installed; run install first");
    log(`cache ok: ${metadata.binaryPath}`);
    log(`ui ok: ${metadata.uiPath}`);
```

- [ ] **Step 12: Verify wrapper tests**

Run:

```bash
cd npm/oracle-todo
npm test
```

Expected: PASS.

- [ ] **Step 13: Commit Task 3**

```bash
git add npm/oracle-todo/src/ui-server.js npm/oracle-todo/src/ui-command.js npm/oracle-todo/src/cli.js npm/oracle-todo/test/ui-server.test.js npm/oracle-todo/test/ui-command.test.js npm/oracle-todo/test/cli.test.js
git commit -m "$(cat <<'EOF'
[ADD] Add local UI runtime command

- npx wrapper에 ui 명령을 추가해 API와 UI static server를 함께 실행
- /todo-engine 프록시와 브라우저 자동 오픈 동작 구현
- 포트 옵션, no-open 옵션, CLI dispatch 테스트 추가
EOF
)"
```

---

### Task 4: Document, Version, Release, and Smoke

**Files:**
- Modify: `docs/operations/setup.md`
- Modify: `README.md`
- Modify: `npm/oracle-todo/package.json`
- Optional modify: `docs/superpowers/specs/2026-07-12-npx-local-ui-release-artifact-design.md` only if implementation reveals a spec mismatch.

**Interfaces:**
- Produces: user-facing commands for `npx @shings/oracle-todo ui`.
- Produces: npm wrapper version `0.1.2`.
- Produces: release smoke commands for `v0.3.0` and `npm-v0.1.2`.

- [ ] **Step 1: Update setup docs**

Add to `docs/operations/setup.md` under "Run with npx":

Add this text:

- Heading text: `Run the local UI:`
- Commands: `npx @shings/oracle-todo ui` and `npx @shings/oracle-todo ui --no-open`
- Explanation: the `ui` command downloads the matching GitHub Release UI artifact, starts `todo-engine api` on `127.0.0.1:3002`, serves the UI on `127.0.0.1:3001`, proxies `/todo-engine/*` requests to the API, and opens the browser by default.

- [ ] **Step 2: Update README setup quick path**

Add one command to `README.md` under "Run without a Rust toolchain":

```bash
npx @shings/oracle-todo ui
```

- [ ] **Step 3: Bump npm wrapper version**

Change `npm/oracle-todo/package.json`:

```json
{
  "name": "@shings/oracle-todo",
  "version": "0.1.2"
}
```

Only change the `version` field; keep existing package metadata.

- [ ] **Step 4: Verify all local gates**

Run:

```bash
cd frontend
npm test
npm run typecheck
npm run build
test -f out/index.html

cd ../npm/oracle-todo
npm test
npm publish --access public --dry-run

cd ../..
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml"); YAML.load_file(".github/workflows/npm-publish.yml"); puts "yaml ok"'
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit Task 4**

```bash
git add README.md docs/operations/setup.md npm/oracle-todo/package.json
git commit -m "$(cat <<'EOF'
[RELEASE] Prepare wrapper UI launch release

- npx UI 실행 명령을 README와 setup 문서에 추가
- npm wrapper 배포 버전을 0.1.2로 갱신
- release smoke 기준을 문서화된 실행 경로와 맞춤
EOF
)"
```

- [ ] **Step 6: Push implementation commits**

Run:

```bash
git status --short --branch
git push origin main
```

Expected: branch is pushed and clean.

- [ ] **Step 7: Create the engine/UI GitHub Release**

Run:

```bash
git tag v0.3.0
git push origin v0.3.0
gh run watch --repo shingyusik/oracle-todo "$(gh run list --repo shingyusik/oracle-todo --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
gh release view v0.3.0 --repo shingyusik/oracle-todo --json assets --jq '.assets[].name'
```

Expected asset list includes:

```text
oracle-todo-ui-0.3.0.tar.gz
SHA256SUMS
todo-engine-0.3.0-aarch64-apple-darwin.tar.gz
todo-engine-0.3.0-x86_64-apple-darwin.tar.gz
todo-engine-0.3.0-x86_64-unknown-linux-gnu.tar.gz
todo-engine-0.3.0-x86_64-pc-windows-msvc.zip
```

- [ ] **Step 8: Publish npm wrapper `0.1.2` with Trusted Publishing**

Run:

```bash
git tag npm-v0.1.2
git push origin npm-v0.1.2
gh run watch --repo shingyusik/oracle-todo "$(gh run list --repo shingyusik/oracle-todo --workflow npm-publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
npm view @shings/oracle-todo version --json
```

Expected npm version output:

```json
"0.1.2"
```

- [ ] **Step 9: Smoke published npx UI runtime without opening a browser**

Run:

```bash
tmp_cache="$(mktemp -d)"
tmp_home="$(mktemp -d)"
ORACLE_TODO_CACHE_DIR="$tmp_cache" npx -y @shings/oracle-todo --home "$tmp_home" ui --no-open --ui-port 3101 --api-port 3102
```

Expected:

```text
oracle-todo ui: http://127.0.0.1:3101
```

In a second terminal while the command is running:

```bash
curl -fsS http://127.0.0.1:3101/ | head
curl -fsS http://127.0.0.1:3101/todo-engine/health || true
```

Expected: first command returns HTML. The second command reaches the API server path if the API exposes that route; if not, it returns an API 404 without connection failure.

---

## Self-Review Checklist

- Spec coverage: release asset, static export, cache, wrapper commands, runtime server, browser open, data boundary, error handling, and tests are covered by Tasks 1-4.
- Placeholder scan: no future implementation placeholders are present.
- Type consistency: planned wrapper functions are `uiPathsFor`, `uiAssetName`, `installUiArtifact`, `installBundle`, `updateBundle`, `createUiServer`, `parseUiArgs`, and `runUi`.
- Scope check: the plan is one vertical feature with independently testable tasks; frontend release packaging and wrapper runtime are both necessary for `npx @shings/oracle-todo ui`.

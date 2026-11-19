const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { activateBinary } = require("../src/archive");
const { pathsFor } = require("../src/cache");

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raven-activate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = pathsFor(root, "0.4.0", "raven");
  await fs.mkdir(paths.versionDir, { recursive: true });
  await fs.writeFile(paths.versionedBinary, "engine 0.4.0");
  await fs.mkdir(paths.binDir, { recursive: true });
  await fs.writeFile(paths.activeBinary, "engine 0.3.0", { mode: 0o755 });
  return paths;
}

test("activates the binary by renaming a staged copy into place", async (t) => {
  const paths = await setup(t);
  const copies = [];
  await activateBinary(paths, "raven", {
    fsImpl: { ...fs, copyFile: async (src, dest) => { copies.push(dest); return fs.copyFile(src, dest); } },
  });

  assert.equal(await fs.readFile(paths.activeBinary, "utf8"), "engine 0.4.0");
  assert.equal((await fs.stat(paths.activeBinary)).mode & 0o777, 0o755);
  assert.equal(copies.length, 1);
  assert.notEqual(copies[0], paths.activeBinary);
  assert.equal(path.dirname(copies[0]), paths.binDir);
  assert.deepEqual(await fs.readdir(paths.binDir), ["raven"]);
});

test("a failed activation leaves the previous binary intact and no staging file", async (t) => {
  const paths = await setup(t);
  await assert.rejects(
    () => activateBinary(paths, "raven", {
      fsImpl: {
        ...fs,
        copyFile: async (_src, dest) => {
          await fs.writeFile(dest, "engine 0.4");
          throw new Error("disk full");
        },
      },
    }),
    /disk full/
  );

  assert.equal(await fs.readFile(paths.activeBinary, "utf8"), "engine 0.3.0");
  assert.deepEqual(await fs.readdir(paths.binDir), ["raven"]);
});

test("a failed rename leaves the previous binary intact", async (t) => {
  const paths = await setup(t);
  await assert.rejects(
    () => activateBinary(paths, "raven", {
      fsImpl: { ...fs, rename: async () => { throw new Error("rename failed"); } },
    }),
    /rename failed/
  );

  assert.equal(await fs.readFile(paths.activeBinary, "utf8"), "engine 0.3.0");
  assert.deepEqual(await fs.readdir(paths.binDir), ["raven"]);
});

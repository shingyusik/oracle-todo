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

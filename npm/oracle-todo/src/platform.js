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

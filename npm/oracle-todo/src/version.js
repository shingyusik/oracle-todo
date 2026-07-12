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

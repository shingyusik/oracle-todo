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
    "User-Agent": "@shinggyusik/oracle-todo",
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

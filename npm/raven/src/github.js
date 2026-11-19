function tagFor(version) {
  if (!version) return null;
  return String(version).startsWith("v") ? String(version) : `v${version}`;
}

const GITHUB_API_URL = "https://api.github.com";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// RAVEN_GITHUB_API_URL is a test-only override (e.g. a local fake release server).
// Only plain-http loopback URLs are honored; anything else falls back to GitHub.
function loopbackApiUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

async function fetchRelease({ version, repository, token, apiUrl, fetchImpl = globalThis.fetch }) {
  if (!fetchImpl) {
    throw new Error("This command requires Node.js 18 or newer with global fetch support");
  }

  const override = loopbackApiUrl(apiUrl);
  const base = override || GITHUB_API_URL;
  const endpoint = version
    ? `${base}/repos/${repository}/releases/tags/${tagFor(version)}`
    : `${base}/repos/${repository}/releases/latest`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "@shings/raven",
  };
  // Never send a GitHub token to a local override.
  if (token && !override) headers.Authorization = `Bearer ${token}`;

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

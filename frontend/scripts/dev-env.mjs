import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadDevEnvironment(workspaceRoot, baseEnv = process.env) {
  return {
    ...readDotEnv(join(workspaceRoot, ".env")),
    ...baseEnv,
  };
}

function readDotEnv(path) {
  try {
    return parseDotEnv(readFileSync(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export function parseDotEnv(source) {
  const env = {};

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) {
      continue;
    }

    env[match[1]] = parseValue(match[2] ?? "");
  }

  return env;
}

function parseValue(rawValue) {
  const value = rawValue.trim();
  const quote = value[0];

  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }

  return value.replace(/\s+#.*$/, "").trim();
}

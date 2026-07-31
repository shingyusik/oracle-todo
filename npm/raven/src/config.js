const path = require("node:path");
const os = require("node:os");

const PACKAGE_NAME = "@shings/raven";
const COMMAND_NAME = "raven";
const ENGINE_BINARY = "raven";
const GITHUB_REPOSITORY = "shingyusik/oracle-todo";
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".local", "share", "raven");

function cacheDir(env = process.env) {
  return env.RAVEN_CACHE_DIR || DEFAULT_CACHE_DIR;
}

module.exports = {
  PACKAGE_NAME,
  COMMAND_NAME,
  ENGINE_BINARY,
  GITHUB_REPOSITORY,
  DEFAULT_CACHE_DIR,
  cacheDir,
};

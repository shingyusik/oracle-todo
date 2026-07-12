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

function topLevelCommandIndex(args) {
  let index = 0;
  while (args[index] === "--home" || args[index]?.startsWith("--home=")) {
    index += args[index] === "--home" ? 2 : 1;
  }
  return index;
}

module.exports = { topLevelCommandIndex };

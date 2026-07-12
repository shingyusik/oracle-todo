#!/usr/bin/env node

const { main } = require("../src/cli");

main(process.argv.slice(2))
  .then((code) => {
    if (Number.isInteger(code)) process.exit(code);
  })
  .catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  });

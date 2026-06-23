#!/usr/bin/env node

import { runCli } from "../src/cli.mjs";

runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd()
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

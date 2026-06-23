#!/usr/bin/env node

import { runCli } from "../src/cli.mjs";
import { loadRuntimeEnv } from "../src/env-loader.mjs";

const cwd = process.cwd();
const env = await loadRuntimeEnv(cwd);

runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  env,
  cwd
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

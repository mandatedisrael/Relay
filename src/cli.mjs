import { loadConfig } from "./config.mjs";
import { initializeLocalStore } from "./local-store.mjs";

const HELP_TEXT = `Relay

Shared task context for 0G models.

Usage:
  relay --help
  relay init
  relay doctor

Commands:
  init      Create local Relay runtime folders.
  doctor    Check local setup without requiring secrets.

MVP commands coming next:
  relay models
  relay ask --model <model-id> "hello"
  relay run "<task>" --auto --mode standard
`;

export async function runCli(args, io) {
  const command = args[0] ?? "--help";

  if (command === "--help" || command === "-h" || command === "help") {
    io.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  if (command === "--version" || command === "-v") {
    io.stdout.write("0.1.0\n");
    return;
  }

  if (command === "doctor") {
    const config = loadConfig(io.env);
    io.stdout.write("Relay doctor\n");
    io.stdout.write(`0G Router base URL: ${config.routerBaseUrl}\n`);
    io.stdout.write(`0G inference key: ${config.hasInferenceKey ? "configured" : "missing"}\n`);
    io.stdout.write("Local checks passed. Network checks are not implemented yet.\n");
    return;
  }

  if (command === "init") {
    const result = await initializeLocalStore(io.cwd ?? process.cwd());
    io.stdout.write(`Relay initialized at ${result.root}\n`);
    io.stdout.write("Created local folders for events, capsules, views, and traces.\n");
    return;
  }

  io.stderr.write(`Unknown command: ${command}\n\n`);
  io.stderr.write(HELP_TEXT);
  io.stderr.write("\n");
  throw new Error("Command failed.");
}

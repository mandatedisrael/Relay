import { loadConfig } from "./config.mjs";
import { initializeLocalStore, listCapsules, readCapsule } from "./local-store.mjs";
import { fetchModelCatalog } from "./zerog-router.mjs";

const HELP_TEXT = `Relay

Shared task context for 0G models.

Usage:
  relay --help
  relay init
  relay doctor
  relay models
  relay capsule list
  relay capsule inspect [capsule-id]

Commands:
  init       Create local Relay runtime folders.
  doctor     Check local setup without requiring secrets.
  models     List live 0G Router models.
  capsule    Inspect local Context Capsules.

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

  if (command === "models") {
    const config = loadConfig(io.env);
    const models = await fetchModelCatalog({ baseUrl: config.routerBaseUrl, fetchImpl: io.fetch });
    io.stdout.write(`0G Router models (${models.length})\n`);

    for (const model of models) {
      const context = model.contextLength === null ? "unknown ctx" : `${model.contextLength} ctx`;
      const prompt = model.pricing.prompt ?? "unknown";
      const completion = model.pricing.completion ?? "unknown";
      const capabilities = [
        model.capabilities.chat ? "chat" : null,
        model.capabilities.tools ? "tools" : null,
        model.capabilities.vision ? "vision" : null,
        model.capabilities.json ? "json" : null
      ].filter(Boolean).join(", ") || "capabilities unknown";

      io.stdout.write(`${model.id} | ${context} | prompt ${prompt} | completion ${completion} | ${capabilities}\n`);
    }
    return;
  }

  if (command === "init") {
    const result = await initializeLocalStore(io.cwd ?? process.cwd());
    io.stdout.write(`Relay initialized at ${result.root}\n`);
    io.stdout.write("Created local folders for events, capsules, views, and traces.\n");
    return;
  }

  if (command === "capsule") {
    await runCapsuleCommand(args.slice(1), io);
    return;
  }

  io.stderr.write(`Unknown command: ${command}\n\n`);
  io.stderr.write(HELP_TEXT);
  io.stderr.write("\n");
  throw new Error("Command failed.");
}

async function runCapsuleCommand(args, io) {
  const subcommand = args[0] ?? "list";
  const projectRoot = io.cwd ?? process.cwd();

  if (subcommand === "list") {
    const capsules = await listCapsules(projectRoot);
    if (capsules.length === 0) {
      io.stdout.write("No local Context Capsules found.\n");
      return;
    }

    for (const capsule of capsules) {
      io.stdout.write(`${capsule.id}\n`);
    }
    return;
  }

  if (subcommand === "inspect") {
    const capsuleId = args[1] ?? "latest";
    const record = await readCapsule(projectRoot, capsuleId);
    if (!record) {
      io.stdout.write("No local Context Capsules found.\n");
      return;
    }

    const capsule = record.payload;
    io.stdout.write(`Context Capsule: ${capsule.capsule_id}\n`);
    io.stdout.write(`Goal: ${capsule.task.goal}\n`);
    io.stdout.write(`Status: ${capsule.state.status}\n`);
    io.stdout.write(`Next action: ${capsule.state.next_action || "None"}\n`);
    io.stdout.write(`Verified facts: ${capsule.facts.filter((fact) => fact.truth_state === "verified").length}\n`);
    io.stdout.write(`Claims: ${capsule.claims.length}\n`);
    io.stdout.write(`Content hash: ${record.content_hash}\n`);
    return;
  }

  io.stderr.write(`Unknown capsule command: ${subcommand}\n`);
  throw new Error("Command failed.");
}

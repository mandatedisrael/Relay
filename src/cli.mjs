import { loadConfig } from "./config.mjs";
import { buildModelResponseEvent } from "./events.mjs";
import {
  initializeLocalStore,
  listCapsules,
  listEvents,
  readCapsule,
  readEvent,
  saveCapsule,
  saveEvent,
  saveView
} from "./local-store.mjs";
import { createChatCompletion, fetchModelCatalog } from "./zerog-router.mjs";
import { createInitialCapsule } from "./capsule-compiler.mjs";
import { buildContextView } from "./view-builder.mjs";
import { CONTEXT_MODES } from "./protocol.mjs";

const HELP_TEXT = `Relay

Shared task context for 0G models.

Usage:
  relay --help
  relay init
  relay doctor
  relay models
  relay ask --model <model-id> [--goal "task description"] "message"
  relay capsule list
  relay capsule inspect [capsule-id]
  relay capsule view --mode <compact|standard|deep> [capsule-id]

Commands:
  init       Create local Relay runtime folders.
  doctor     Check local setup without requiring secrets.
  models     List live 0G Router models.
  ask        Send one chat completion through 0G Router. Supports --goal for capsule.
  capsule    Inspect, list, and build context views from local Context Capsules.

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
      const providers = model.providerCount === null ? "providers unknown" : `${model.providerCount} providers`;
      const prompt = model.pricing.prompt ?? "unknown";
      const completion = model.pricing.completion ?? "unknown";
      const capabilities = [
        model.capabilities.chat ? "chat" : null,
        model.capabilities.tools ? "tools" : null,
        model.capabilities.vision ? "vision" : null,
        model.capabilities.json ? "json" : null
      ].filter(Boolean).join(", ") || "capabilities unknown";

      io.stdout.write(`${model.id} | ${context} | ${providers} | prompt ${prompt} | completion ${completion} | ${capabilities}\n`);
    }
    return;
  }

  if (command === "ask") {
    await runAskCommand(args.slice(1), io);
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

async function runAskCommand(args, io) {
  const modelIndex = args.indexOf("--model");
  const goalIndex = args.indexOf("--goal");
  const model = modelIndex === -1 ? "" : args[modelIndex + 1];
  const explicitGoal = goalIndex === -1 ? null : args[goalIndex + 1];
  const filtered = args.filter((_, index) =>
    index !== modelIndex && index !== modelIndex + 1 &&
    index !== goalIndex && index !== goalIndex + 1
  );
  const message = filtered.join(" ").trim();
  const config = loadConfig(io.env);

  const completion = await createChatCompletion({
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    model,
    messages: [
      {
        role: "user",
        content: message
      }
    ],
    fetchImpl: io.fetch
  });
  const projectRoot = io.cwd ?? process.cwd();
  const event = buildModelResponseEvent({ completion, prompt: message });
  const eventRecord = await saveEvent(projectRoot, event);

  const capsule = createInitialCapsule({ goal: explicitGoal || message, event });
  const capsuleRecord = await saveCapsule(projectRoot, capsule);

  io.stdout.write(`${completion.content}\n`);
  io.stdout.write(`\nevent_id: ${event.event_id}\n`);
  io.stdout.write(`event_hash: ${eventRecord.content_hash}\n`);

  if (completion.trace.requestId) {
    io.stdout.write(`request_id: ${completion.trace.requestId}\n`);
  }

  if (completion.trace.provider) {
    io.stdout.write(`provider: ${completion.trace.provider}\n`);
  }

  if (completion.trace.billing.totalCost) {
    io.stdout.write(`total_cost: ${completion.trace.billing.totalCost} neuron\n`);
  }

  io.stdout.write(`capsule_id: ${capsule.capsule_id}\n`);
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
    const capsuleId = parseOptionalCapsuleId(args.slice(1));
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

  if (subcommand === "view") {
    await runCapsuleViewCommand(args.slice(1), projectRoot, io);
    return;
  }

  io.stderr.write(`Unknown capsule command: ${subcommand}\n`);
  throw new Error("Command failed.");
}

async function runCapsuleViewCommand(args, projectRoot, io) {
  const modeIndex = args.indexOf("--mode");
  const jsonFlag = args.includes("--json");
  const mode = modeIndex === -1 ? "" : args[modeIndex + 1];
  const filtered = args.filter((_, index) =>
    index !== modeIndex && index !== modeIndex + 1 && args[index] !== "--json"
  );
  const capsuleId = parseOptionalCapsuleId(filtered);

  if (!mode) {
    throw new Error(`--mode is required. Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  if (!CONTEXT_MODES.includes(mode)) {
    throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  const record = await readCapsule(projectRoot, capsuleId);
  if (!record) {
    io.stdout.write("No local Context Capsules found.\n");
    return;
  }

  const events = await loadEventPayloads(projectRoot);
  const result = buildContextView({
    capsule: record.payload,
    mode,
    events
  });
  const viewRecord = await saveView(projectRoot, result.view);

  if (jsonFlag) {
    io.stdout.write(`${JSON.stringify({
      view: result.view,
      estimates: result.estimates,
      view_hash: viewRecord.content_hash,
      handoff: result.handoff
    }, null, 2)}\n`);
    return;
  }

  io.stdout.write(`Context mode: ${mode}\n`);
  io.stdout.write(`Source capsule: ${record.payload.capsule_id}\n`);
  io.stdout.write(`Estimated handoff: ${formatTokenCount(result.estimates.viewTokens)} tokens\n`);
  io.stdout.write(`Full event history: ${formatTokenCount(result.estimates.fullHistoryTokens)} tokens\n`);

  if (result.estimates.reductionPercent === null) {
    io.stdout.write("Estimated context reduction: unavailable\n");
  } else {
    io.stdout.write(`Estimated context reduction: ${result.estimates.reductionPercent}%\n`);
  }

  io.stdout.write(`Sections: ${result.view.sections.join(", ")}\n`);
  io.stdout.write(`View ID: ${result.view.view_id}\n`);
  io.stdout.write(`View hash: ${viewRecord.content_hash}\n`);
  io.stdout.write("\n--- Handoff preview ---\n");
  io.stdout.write(`${result.handoff}\n`);
}

function parseOptionalCapsuleId(args) {
  const candidate = args.find((arg) => !arg.startsWith("--"));
  return candidate ?? "latest";
}

async function loadEventPayloads(projectRoot) {
  const listed = await listEvents(projectRoot);
  const records = await Promise.all(
    listed.map((entry) => readEvent(projectRoot, entry.id))
  );
  return records.map((record) => record.payload);
}

function formatTokenCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

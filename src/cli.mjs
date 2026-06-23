import { join } from "node:path";
import { readActiveTask } from "./active-task.mjs";
import { loadConfig } from "./config.mjs";
import { fetchCapsuleBundle, importCapsuleBundle } from "./capsule-fetch.mjs";
import { publishCapsuleBundle } from "./capsule-publish.mjs";
import { loadStorageConfig } from "./storage-config.mjs";
import {
  initializeLocalStore,
  listCapsules,
  listEvents,
  readCapsule,
  readEvent,
  saveCapsule,
  saveView
} from "./local-store.mjs";
import { formatModelAccessReason, probeModelAccess } from "./model-access.mjs";
import { fetchModelCatalog } from "./zerog-router.mjs";
import { buildContextView } from "./view-builder.mjs";
import { runLiveDoctorChecks } from "./live-checks.mjs";
import { runMvpProof, saveProofReport } from "./proof-run.mjs";
import { handoffTaskToTarget } from "./handoff-to.mjs";
import { createRelayRouterProxy, defaultEventsLoader } from "./router-proxy.mjs";
import { ensureDefaultTargetsConfig } from "./targets-config.mjs";
import { continueTask, startTask, stepTask } from "./task-runtime.mjs";
import { buildTaskMemorySummary } from "./task-summary.mjs";
import { CONTEXT_MODES } from "./protocol.mjs";

const COMMAND_ALIASES = Object.freeze({
  doctor: "status",
  ask: "run",
  switch: "continue",
  proof: "demo",
  e2e: "demo"
});

const CAPSULE_COMMAND_ALIASES = Object.freeze({
  view: "handoff"
});

const HELP_TEXT = `Relay

Shared task memory for multi-model work on 0G.

Use Relay anywhere an app talks to 0G Router (Cline, Codex, custom clients):
  relay proxy
  # then point the app's OpenAI base URL to http://127.0.0.1:8791/v1

Relay captures each Router call, updates local task memory, and injects capsule
handoffs automatically. No manual relay task step per message required.

Getting started:
  relay init
  relay proxy [--port 8791]
  relay status [--local]
  relay models --allowed

Work on one task (CLI mode):
  relay task start --model <model-id> --goal "task" --message "first step"
  relay task step --message "next step on the same task"
  relay task continue --to <model-id> --mode compact --message "hand off to another model"
  relay task status

Switch coding agents:
  relay to codex [--message "..."]
  relay to claude-code --handoff-only

Portable memory:
  relay capsule handoff --mode compact
  relay capsule publish
  relay capsule fetch <relay-url-or-root>

Verification:
  relay demo [--mode compact] [--skip-storage]

Commands:
  proxy       OpenAI-compatible proxy in front of 0G Router with Relay memory.
  task        Start, extend, and hand off a shared task across models.
  to          Publish task memory to 0G Storage and hand off to Codex or another target.
  capsule     Inspect, preview, publish, and fetch Context Capsules.
  status      Check local setup and live 0G connectivity.
  models      List models and probe API-key access with --allowed.
  demo        Run the full Relay workflow and save a report.

Aliases:
  run -> task start | continue -> task continue | ask -> run
  doctor -> status | proof -> demo | capsule view -> capsule handoff

`;

export async function runCli(args, io) {
  const rawCommand = args[0] ?? "--help";
  const command = resolveCommandName(rawCommand);

  if (rawCommand === "--help" || rawCommand === "-h" || rawCommand === "help") {
    io.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  if (rawCommand === "--version" || rawCommand === "-v") {
    io.stdout.write("0.1.0\n");
    return;
  }

  if (command === "status") {
    await runStatusCommand(args.slice(1), io);
    return;
  }

  if (command === "demo") {
    await runDemoCommand(args.slice(1), io);
    return;
  }

  if (command === "models") {
    await runModelsCommand(args.slice(1), io);
    return;
  }

  if (command === "run") {
    await runTaskWorkflowCommand("start", args.slice(1), io);
    return;
  }

  if (command === "task") {
    await runTaskWorkflowCommand(args[1] ?? "status", args.slice(2), io);
    return;
  }

  if (command === "to") {
    await runHandoffToCommand(args.slice(1), io);
    return;
  }

  if (command === "proxy") {
    await runProxyCommand(args.slice(1), io);
    return;
  }

  if (command === "init") {
    const projectRoot = io.cwd ?? process.cwd();
    const result = await initializeLocalStore(projectRoot);
    const targetsPath = await ensureDefaultTargetsConfig(projectRoot);
    io.stdout.write(`Relay initialized at ${result.root}\n`);
    io.stdout.write("Created local folders for events, capsules, views, and traces.\n");
    if (targetsPath) {
      io.stdout.write(`Wrote default handoff targets at ${targetsPath}\n`);
    }
    return;
  }

  if (command === "capsule") {
    await runCapsuleCommand(args.slice(1), io);
    return;
  }

  if (command === "continue") {
    await runTaskWorkflowCommand("continue", args.slice(1), io);
    return;
  }

  io.stderr.write(`Unknown command: ${rawCommand}\n\n`);
  io.stderr.write(HELP_TEXT);
  io.stderr.write("\n");
  throw new Error("Command failed.");
}

function resolveCommandName(command) {
  return COMMAND_ALIASES[command] ?? command;
}

function resolveCapsuleCommandName(subcommand) {
  return CAPSULE_COMMAND_ALIASES[subcommand] ?? subcommand;
}

async function runModelsCommand(args, io) {
  const allowedFlag = args.includes("--allowed");
  const jsonFlag = args.includes("--json");
  const config = loadConfig(io.env);
  const models = await fetchModelCatalog({ baseUrl: config.routerBaseUrl, fetchImpl: io.fetch });

  if (!allowedFlag) {
    io.stdout.write(`0G Router models (${models.length})\n`);
    for (const model of models) {
      io.stdout.write(`${formatModelCatalogLine(model)}\n`);
    }
    return;
  }

  if (!config.hasInferenceKey) {
    throw new Error("OG_INFERENCE_API_KEY is required for `relay models --allowed`.");
  }

  const access = await probeModelAccess({
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    models,
    fetchImpl: io.fetch
  });

  if (jsonFlag) {
    io.stdout.write(`${JSON.stringify({
      catalog_count: models.length,
      probed_count: access.summary.total,
      allowed_count: access.summary.allowedCount,
      denied_count: access.summary.deniedCount,
      results: access.results.map((result) => ({
        id: result.model.id,
        allowed: result.allowed,
        reason: result.reason,
        context_length: result.model.contextLength,
        provider_count: result.model.providerCount,
        pricing: result.model.pricing,
        capabilities: result.model.capabilities
      }))
    }, null, 2)}\n`);
    return;
  }

  io.stdout.write(`0G Router models (${models.length})\n`);
  io.stdout.write(`Allowed for your API key: ${access.summary.allowedCount} of ${access.summary.total} chat models\n`);

  for (const result of access.results) {
    const status = result.allowed ? "allowed" : formatModelAccessReason(result.reason);
    io.stdout.write(`${result.model.id} | ${status} | ${formatModelCatalogLine(result.model, { includeId: false })}\n`);
  }
}

function formatModelCatalogLine(model, { includeId = true } = {}) {
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

  const details = `${context} | ${providers} | prompt ${prompt} | completion ${completion} | ${capabilities}`;
  return includeId ? `${model.id} | ${details}` : details;
}

async function runStatusCommand(args, io) {
  const localOnly = args.includes("--local") && !args.includes("--live");
  const config = loadConfig(io.env);
  let storageSummary = null;

  try {
    const storageConfig = loadStorageConfig(io.env);
    storageSummary = {
      network: storageConfig.network,
      mode: storageConfig.mode,
      hasPrivateKey: storageConfig.hasPrivateKey
    };
  } catch (error) {
    storageSummary = { error: error.message };
  }

  io.stdout.write("Relay status\n");
  io.stdout.write(`0G Router base URL: ${config.routerBaseUrl}\n`);
  io.stdout.write(`0G inference key: ${config.hasInferenceKey ? "configured" : "missing"}\n`);

  if (storageSummary?.error) {
    io.stdout.write(`0G Storage config: invalid (${storageSummary.error})\n`);
  } else if (storageSummary) {
    io.stdout.write(`0G Storage network: ${storageSummary.network}\n`);
    io.stdout.write(`0G Storage mode: ${storageSummary.mode}\n`);
    io.stdout.write(`0G Storage private key: ${storageSummary.hasPrivateKey ? "configured" : "missing"}\n`);
  }

  if (localOnly) {
    io.stdout.write("\nLocal configuration checked. Run `relay status` to verify live 0G connectivity.\n");
    return;
  }

  const result = await runLiveDoctorChecks({ env: io.env, fetchImpl: io.fetch });
  io.stdout.write("\nLive checks:\n");
  for (const check of result.checks) {
    io.stdout.write(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}\n`);
  }

  if (result.storage) {
    io.stdout.write(`Storage indexer: ${result.storage.indexerUrl}\n`);
  }

  io.stdout.write(`\nReady for relay demo: ${result.readyForProof ? "yes" : "no"}\n`);
}

async function runDemoCommand(args, io) {
  const modelAIndex = args.indexOf("--model-a");
  const modelBIndex = args.indexOf("--model-b");
  const modeIndex = args.indexOf("--mode");
  const goalIndex = args.indexOf("--goal");
  const jsonFlag = args.includes("--json");
  const skipStorage = args.includes("--skip-storage");
  const modelA = modelAIndex === -1 ? null : args[modelAIndex + 1];
  const modelB = modelBIndex === -1 ? null : args[modelBIndex + 1];
  const mode = modeIndex === -1 ? "compact" : args[modeIndex + 1];
  const goal = goalIndex === -1 ? null : args[goalIndex + 1];
  const projectRoot = io.cwd ?? process.cwd();

  if (!CONTEXT_MODES.includes(mode)) {
    throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  const report = await runMvpProof({
    projectRoot,
    env: io.env,
    fetchImpl: io.fetch,
    modelA,
    modelB,
    mode,
    goal: goal ?? undefined,
    skipStorage,
    storageDeps: io.storageDeps
  });
  const reportPath = await saveProofReport(projectRoot, report);

  if (jsonFlag) {
    io.stdout.write(`${JSON.stringify({ report, report_path: reportPath }, null, 2)}\n`);
    if (!report.all_passed) {
      throw new Error("Relay end-to-end demo did not pass all steps.");
    }
    return;
  }

  io.stdout.write("Relay end-to-end demo\n");
  io.stdout.write(`Goal: ${report.goal}\n`);
  io.stdout.write(`Mode: ${report.mode}\n`);
  if (report.models?.modelA && report.models?.modelB) {
    io.stdout.write(`Model A: ${report.models.modelA}\n`);
    io.stdout.write(`Model B: ${report.models.modelB}\n`);
  }

  if (report.token_proof) {
    io.stdout.write(`Handoff tokens: ${formatTokenCount(report.token_proof.handoff_tokens)}\n`);
    io.stdout.write(`Full history tokens: ${formatTokenCount(report.token_proof.full_history_tokens)}\n`);
    io.stdout.write(`Context reduction: ${report.token_proof.reduction_percent ?? "unavailable"}%\n`);
  }

  if (report.storage) {
    io.stdout.write(`Relay URL: ${report.storage.relay_url}\n`);
    io.stdout.write(`Decryption key: ${report.storage.key_hex}\n`);
  }

  io.stdout.write("\nSteps:\n");
  for (const step of report.steps) {
    io.stdout.write(`${step.ok ? "ok" : "fail"} ${step.name}\n`);
  }

  io.stdout.write(`\nDemo report: ${reportPath}\n`);
  io.stdout.write(`Result: ${report.all_passed ? "PASS" : "FAIL"}\n`);

  if (!report.all_passed) {
    throw new Error("Relay end-to-end demo did not pass all steps.");
  }
}

async function runProxyCommand(args, io) {
  const portIndex = args.indexOf("--port");
  const hostIndex = args.indexOf("--host");
  const port = portIndex === -1 ? 8791 : Number(args[portIndex + 1]);
  const host = hostIndex === -1 ? "127.0.0.1" : args[hostIndex + 1];
  const projectRoot = io.env.RELAY_PROJECT_ROOT ?? io.cwd ?? process.cwd();

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Invalid --port value for relay proxy.");
  }

  const proxy = createRelayRouterProxy({
    projectRoot,
    env: io.env,
    host,
    port,
    fetchImpl: io.fetch,
    eventsLoader: defaultEventsLoader
  });

  const listenUrl = await proxy.start();
  io.stdout.write(`Relay proxy listening on ${listenUrl}/v1\n`);
  io.stdout.write(`Project memory: ${join(projectRoot, ".relay")}\n`);
  io.stdout.write(`Upstream Router: ${proxy.upstreamBaseUrl}\n`);
  io.stdout.write("Point any OpenAI-compatible client here (Cline, Codex, custom apps).\n");
  io.stdout.write("Optional headers: X-Relay-Goal, X-Relay-Mode, X-Relay-No-Handoff\n");

  await new Promise(() => {});
}

async function runHandoffToCommand(args, io) {
  const handoffOnly = args.includes("--handoff-only");
  const modeIndex = args.indexOf("--mode");
  const messageIndex = args.indexOf("--message");
  const mode = modeIndex === -1 ? "compact" : args[modeIndex + 1];
  const message = messageIndex === -1 ? null : args[messageIndex + 1];
  const filtered = removeFlagValues(args, [modeIndex, messageIndex], { alsoExclude: ["--handoff-only"] });
  const positional = filtered.filter((arg) => !arg.startsWith("--"));
  const targetName = positional[0];
  const projectRoot = io.cwd ?? process.cwd();
  const config = loadConfig(io.env);

  if (!targetName) {
    throw new Error("Usage: relay to <target> [--message \"...\"] [--handoff-only] [--mode compact]");
  }

  if (!CONTEXT_MODES.includes(mode)) {
    throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  const activeTask = await readActiveTask(projectRoot);
  const capsuleId = positional[1] && isCapsuleReference(positional[1])
    ? positional[1]
    : (activeTask?.capsule_id ?? "latest");
  const events = await loadEventPayloads(projectRoot);
  const result = await handoffTaskToTarget({
    projectRoot,
    targetName,
    events,
    capsuleId,
    mode,
    message,
    handoffOnly,
    env: io.env,
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    hasInferenceKey: config.hasInferenceKey,
    fetchImpl: io.fetch,
    storageDeps: io.storageDeps
  });

  io.stdout.write(`Portable handoff ready for ${result.target.label}\n`);
  io.stdout.write(`Relay URL: ${result.publishResult.relayUrl}\n`);
  io.stdout.write(`Decryption key: ${result.publishResult.keyHex}\n`);
  io.stdout.write(`Handoff file: ${result.exportResult.targetFile}\n`);

  if (result.target.external || result.target.reason === "no_inference_models_verified") {
    io.stdout.write(`Mode: storage + paste handoff (${result.target.label} is external)\n`);
    io.stdout.write("Open the handoff file in Codex or Claude Code and continue from there.\n");
  } else if (result.continueResult) {
    writeTaskInteractionOutput(io, result.continueResult);
  } else if (handoffOnly) {
    io.stdout.write("Mode: storage + paste handoff only\n");
  }

  io.stdout.write(`\nFetch anywhere with:\n  relay capsule fetch ${result.publishResult.relayUrl}\n`);
}

async function runTaskWorkflowCommand(subcommand, args, io) {
  const projectRoot = io.cwd ?? process.cwd();
  const config = loadConfig(io.env);

  if (subcommand === "status") {
    await runTaskStatusCommand(projectRoot, io);
    return;
  }

  if (subcommand === "start") {
    const modelIndex = args.indexOf("--model");
    const goalIndex = args.indexOf("--goal");
    const model = modelIndex === -1 ? "" : args[modelIndex + 1];
    const goal = goalIndex === -1 ? null : args[goalIndex + 1];
    const message = parseTaskMessage(args, [modelIndex, goalIndex]);

    if (!model) {
      throw new Error("--model is required to start a Relay task.");
    }

    const result = await startTask({
      projectRoot,
      model,
      goal,
      message,
      baseUrl: config.routerBaseUrl,
      apiKey: config.inferenceApiKey,
      fetchImpl: io.fetch
    });
    writeTaskInteractionOutput(io, result);
    return;
  }

  if (subcommand === "step") {
    const modelIndex = args.indexOf("--model");
    const modeIndex = args.indexOf("--mode");
    const modelOverride = modelIndex === -1 ? null : args[modelIndex + 1];
    const mode = modeIndex === -1 ? "standard" : args[modeIndex + 1];
    const message = parseTaskMessage(args, [modelIndex, modeIndex]);
    const activeTask = await readActiveTask(projectRoot);

    if (!activeTask) {
      throw new Error("No active Relay task found. Start one with `relay task start`.");
    }

    if (!CONTEXT_MODES.includes(mode)) {
      throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
    }

    const record = await readCapsule(projectRoot, activeTask.capsule_id);
    if (!record) {
      throw new Error(`Active task capsule not found: ${activeTask.capsule_id}`);
    }

    const model = modelOverride ?? activeTask.last_model;
    if (!model) {
      throw new Error("--model is required when the active task has no last model recorded.");
    }

    const events = await loadEventPayloads(projectRoot);
    const result = await stepTask({
      projectRoot,
      capsule: record.payload,
      events,
      model,
      message,
      mode,
      baseUrl: config.routerBaseUrl,
      apiKey: config.inferenceApiKey,
      fetchImpl: io.fetch
    });
    writeTaskInteractionOutput(io, result);
    return;
  }

  if (subcommand === "continue") {
    const toIndex = args.indexOf("--to");
    const modeIndex = args.indexOf("--mode");
    const messageIndex = args.indexOf("--message");
    const targetModel = toIndex === -1 ? "" : args[toIndex + 1];
    const mode = modeIndex === -1 ? "compact" : args[modeIndex + 1];
    const filtered = removeFlagValues(args, [toIndex, modeIndex, messageIndex]);
    const { capsuleId, trailingMessage } = parseCapsuleTarget(filtered);
    const instruction = messageIndex === -1
      ? (trailingMessage || null)
      : args[messageIndex + 1];

    if (!targetModel) {
      throw new Error("--to is required with the next model ID.");
    }

    if (!CONTEXT_MODES.includes(mode)) {
      throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
    }

    const record = await readCapsule(projectRoot, capsuleId);
    if (!record) {
      io.stdout.write("No local Context Capsules found. Run `relay task start` first.\n");
      return;
    }

    const events = await loadEventPayloads(projectRoot);
    const result = await continueTask({
      projectRoot,
      capsule: record.payload,
      events,
      targetModel,
      message: instruction,
      mode,
      baseUrl: config.routerBaseUrl,
      apiKey: config.inferenceApiKey,
      fetchImpl: io.fetch
    });
    writeTaskInteractionOutput(io, result);
    return;
  }

  io.stderr.write(`Unknown task command: ${subcommand}\n`);
  throw new Error("Command failed.");
}

async function runTaskStatusCommand(projectRoot, io) {
  const activeTask = await readActiveTask(projectRoot);
  if (!activeTask) {
    io.stdout.write("No active Relay task.\n");
    io.stdout.write("Start one with: relay task start --model <model-id> --goal \"...\" --message \"...\"\n");
    return;
  }

  const record = await readCapsule(projectRoot, activeTask.capsule_id);
  if (!record) {
    io.stdout.write(`Active task capsule is missing: ${activeTask.capsule_id}\n`);
    return;
  }

  const events = await loadEventPayloads(projectRoot);
  const summary = buildTaskMemorySummary({
    capsule: record.payload,
    events,
    mode: "compact",
    model: activeTask.last_model
  });

  io.stdout.write("Active Relay task\n");
  io.stdout.write(`${summary.text}\n`);
}

function writeTaskInteractionOutput(io, result) {
  io.stdout.write("--- Model response ---\n");
  io.stdout.write(`${result.completion.content}\n\n`);
  io.stdout.write(`${result.summary.text}\n`);

  if (result.completion.trace.billing.totalCost) {
    io.stdout.write(`\nRouter billing: ${result.completion.trace.billing.totalCost} neuron\n`);
  }
}

async function runCapsuleCommand(args, io) {
  const subcommand = resolveCapsuleCommandName(args[0] ?? "list");
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

  if (subcommand === "handoff") {
    await runCapsuleHandoffCommand(args.slice(1), projectRoot, io);
    return;
  }

  if (subcommand === "publish") {
    await runCapsulePublishCommand(args.slice(1), projectRoot, io);
    return;
  }

  if (subcommand === "fetch") {
    await runCapsuleFetchCommand(args.slice(1), projectRoot, io);
    return;
  }

  io.stderr.write(`Unknown capsule command: ${subcommand}\n`);
  throw new Error("Command failed.");
}

async function runCapsulePublishCommand(args, projectRoot, io) {
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex === -1 ? "compact" : args[modeIndex + 1];
  const filtered = removeFlagValues(args, [modeIndex]);
  const capsuleId = parseOptionalCapsuleId(filtered);

  if (!CONTEXT_MODES.includes(mode)) {
    throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  const record = await readCapsule(projectRoot, capsuleId);
  if (!record) {
    io.stdout.write("No local Context Capsules found.\n");
    return;
  }

  const storageConfig = loadStorageConfig(io.env);
  if (!storageConfig.hasPrivateKey) {
    throw new Error("OG_STORAGE_PRIVATE_KEY is required to publish capsules to 0G Storage.");
  }

  const events = await loadEventPayloads(projectRoot);
  const result = await publishCapsuleBundle({
    projectRoot,
    capsule: record.payload,
    events,
    mode,
    storageConfig,
    deps: io.storageDeps
  });

  const capsuleRecord = await saveCapsule(projectRoot, result.updatedCapsule);
  const viewRecord = await saveView(projectRoot, result.view);

  io.stdout.write("Published encrypted Context Capsule to 0G Storage.\n");
  io.stdout.write(`Relay URL: ${result.relayUrl}\n`);
  io.stdout.write(`Root hash: ${result.upload.rootHash}\n`);
  io.stdout.write(`Transaction: ${result.upload.txHash}\n`);
  io.stdout.write(`Network: ${storageConfig.network}\n`);
  io.stdout.write(`Storage mode: ${storageConfig.mode}\n`);
  io.stdout.write(`Encryption: aes256\n`);
  io.stdout.write(`Decryption key: ${result.keyHex}\n`);
  io.stdout.write("Save the decryption key locally. Relay also stored it under .relay/publish-keys/.\n");
  io.stdout.write(`Bundle hash: ${result.bundle.manifest.content_hash}\n`);
  io.stdout.write(`View ID: ${result.view.view_id}\n`);
  io.stdout.write(`View hash: ${viewRecord.content_hash}\n`);
  io.stdout.write(`Capsule ID: ${result.updatedCapsule.capsule_id}\n`);
  io.stdout.write(`Capsule hash: ${capsuleRecord.content_hash}\n`);
}

async function runCapsuleFetchCommand(args, projectRoot, io) {
  const keyIndex = args.indexOf("--key");
  const encryptionKeyHex = keyIndex === -1 ? null : args[keyIndex + 1];
  const filtered = removeFlagValues(args, [keyIndex]);
  const reference = filtered.find((arg) => !arg.startsWith("--"));

  if (!reference) {
    throw new Error("A relay storage URL or root hash is required.");
  }

  const fetched = await fetchCapsuleBundle({
    projectRoot,
    reference,
    encryptionKeyHex,
    env: io.env,
    deps: io.storageDeps
  });
  const imported = await importCapsuleBundle(projectRoot, fetched.bundle);

  io.stdout.write("Fetched and validated encrypted Context Capsule from 0G Storage.\n");
  io.stdout.write(`Root hash: ${fetched.rootHash}\n`);
  io.stdout.write(`Network: ${fetched.network}\n`);
  io.stdout.write(`Proof verified: ${fetched.proofVerified ? "yes" : "no"}\n`);
  io.stdout.write(`Capsule ID: ${fetched.bundle.capsule.capsule_id}\n`);
  io.stdout.write(`Events imported: ${imported.eventRecords.length}\n`);
  io.stdout.write(`Traces imported: ${imported.traceRecords.length}\n`);
  io.stdout.write(`Capsule hash: ${imported.capsuleRecord.content_hash}\n`);
  io.stdout.write(`Goal: ${fetched.bundle.capsule.task.goal}\n`);
}

async function runCapsuleHandoffCommand(args, projectRoot, io) {
  const modeIndex = args.indexOf("--mode");
  const jsonFlag = args.includes("--json");
  const mode = modeIndex === -1 ? "" : args[modeIndex + 1];
  const filtered = removeFlagValues(args, [modeIndex], { alsoExclude: ["--json"] });
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
  return parseCapsuleTarget(args).capsuleId;
}

function parseCapsuleTarget(args) {
  const positional = args.filter((arg) => !arg.startsWith("--"));

  if (positional.length === 0) {
    return { capsuleId: "latest", trailingMessage: null };
  }

  const first = positional[0];
  if (isCapsuleReference(first)) {
    return {
      capsuleId: first,
      trailingMessage: positional.slice(1).join(" ").trim() || null
    };
  }

  return {
    capsuleId: "latest",
    trailingMessage: positional.join(" ").trim() || null
  };
}

function isCapsuleReference(value) {
  return value === "latest" || value.startsWith("ctx_");
}

function parseTaskMessage(args, flagIndexes) {
  const messageIndex = args.indexOf("--message");
  const indexes = [...flagIndexes];
  if (messageIndex !== -1) {
    indexes.push(messageIndex);
  }

  const filtered = removeFlagValues(args, indexes);
  const message = messageIndex !== -1
    ? args[messageIndex + 1]?.trim()
    : filtered.join(" ").trim();

  if (!message) {
    throw new Error("A task message is required. Pass --message \"...\" or add it at the end of the command.");
  }

  return message;
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

function removeFlagValues(args, flagIndexes, { alsoExclude = [] } = {}) {
  const excluded = new Set(
    alsoExclude
      .map((value) => args.indexOf(value))
      .filter((index) => index !== -1)
  );

  for (const index of flagIndexes) {
    if (index !== -1) {
      excluded.add(index);
      excluded.add(index + 1);
    }
  }

  return args.filter((_, index) => !excluded.has(index));
}

import { loadConfig } from "./config.mjs";
import { fetchCapsuleBundle, importCapsuleBundle } from "./capsule-fetch.mjs";
import { publishCapsuleBundle } from "./capsule-publish.mjs";
import { loadStorageConfig } from "./storage-config.mjs";
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
import { formatModelAccessReason, probeModelAccess } from "./model-access.mjs";
import { createChatCompletion, fetchModelCatalog } from "./zerog-router.mjs";
import { createInitialCapsule } from "./capsule-compiler.mjs";
import { buildContextView } from "./view-builder.mjs";
import { runModelSwitch } from "./model-switch.mjs";
import { runLiveDoctorChecks } from "./live-checks.mjs";
import { runMvpProof, saveProofReport } from "./proof-run.mjs";
import { CONTEXT_MODES } from "./protocol.mjs";

const HELP_TEXT = `Relay

Shared task context for 0G models.

Usage:
  relay --help
  relay init
  relay doctor
  relay models [--allowed] [--json]
  relay ask --model <model-id> [--goal "task description"] "message"
  relay capsule list
  relay capsule inspect [capsule-id]
  relay capsule view --mode <compact|standard|deep> [capsule-id]
  relay capsule publish [--mode standard] [capsule-id]
  relay capsule fetch <relay-url-or-root> [--key <hex>]
  relay switch --to <model-id> --mode <compact|standard|deep> [--message "..."] [capsule-id]
  relay doctor --live
  relay proof [--model-a <id>] [--model-b <id>] [--mode standard] [--skip-storage]

Commands:
  init       Create local Relay runtime folders.
  doctor     Check local setup. Use --live for 0G connectivity checks.
  proof      Run the full live MVP proof loop and save a report.
  models     List live 0G Router models. Use --allowed to probe your API key access.
  ask        Send one chat completion through 0G Router. Supports --goal for capsule.
  switch     Continue a task on another 0G model using a capsule view handoff.
  capsule    Inspect, publish, fetch, and build views from local Context Capsules.


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
    await runDoctorCommand(args.slice(1), io);
    return;
  }

  if (command === "proof") {
    await runProofCommand(args.slice(1), io);
    return;
  }

  if (command === "models") {
    await runModelsCommand(args.slice(1), io);
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

  if (command === "switch") {
    await runSwitchCommand(args.slice(1), io);
    return;
  }

  io.stderr.write(`Unknown command: ${command}\n\n`);
  io.stderr.write(HELP_TEXT);
  io.stderr.write("\n");
  throw new Error("Command failed.");
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

async function runDoctorCommand(args, io) {
  const live = args.includes("--live");
  const config = loadConfig(io.env);

  io.stdout.write("Relay doctor\n");
  io.stdout.write(`0G Router base URL: ${config.routerBaseUrl}\n`);
  io.stdout.write(`0G inference key: ${config.hasInferenceKey ? "configured" : "missing"}\n`);

  if (!live) {
    io.stdout.write("Local checks passed. Run `relay doctor --live` to verify 0G connectivity.\n");
    return;
  }

  const result = await runLiveDoctorChecks({ env: io.env, fetchImpl: io.fetch });
  io.stdout.write("\nLive checks:\n");
  for (const check of result.checks) {
    io.stdout.write(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}\n`);
  }

  if (result.storage) {
    io.stdout.write(`Storage network: ${result.storage.network}\n`);
    io.stdout.write(`Storage mode: ${result.storage.mode}\n`);
    io.stdout.write(`Storage indexer: ${result.storage.indexerUrl}\n`);
  }

  io.stdout.write(`\nReady for relay proof: ${result.readyForProof ? "yes" : "no"}\n`);
}

async function runProofCommand(args, io) {
  const modelAIndex = args.indexOf("--model-a");
  const modelBIndex = args.indexOf("--model-b");
  const modeIndex = args.indexOf("--mode");
  const goalIndex = args.indexOf("--goal");
  const jsonFlag = args.includes("--json");
  const skipStorage = args.includes("--skip-storage");
  const modelA = modelAIndex === -1 ? null : args[modelAIndex + 1];
  const modelB = modelBIndex === -1 ? null : args[modelBIndex + 1];
  const mode = modeIndex === -1 ? "standard" : args[modeIndex + 1];
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
      throw new Error("Relay MVP proof did not pass all steps.");
    }
    return;
  }

  io.stdout.write("Relay MVP proof\n");
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

  io.stdout.write(`\nProof report: ${reportPath}\n`);
  io.stdout.write(`Result: ${report.all_passed ? "PASS" : "FAIL"}\n`);

  if (!report.all_passed) {
    throw new Error("Relay MVP proof did not pass all steps.");
  }
}

async function runAskCommand(args, io) {
  const modelIndex = args.indexOf("--model");
  const goalIndex = args.indexOf("--goal");
  const model = modelIndex === -1 ? "" : args[modelIndex + 1];
  const explicitGoal = goalIndex === -1 ? null : args[goalIndex + 1];
  const filtered = removeFlagValues(args, [modelIndex, goalIndex]);
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

async function runSwitchCommand(args, io) {
  const toIndex = args.indexOf("--to");
  const modeIndex = args.indexOf("--mode");
  const messageIndex = args.indexOf("--message");
  const targetModel = toIndex === -1 ? "" : args[toIndex + 1];
  const mode = modeIndex === -1 ? "" : args[modeIndex + 1];
  const instruction = messageIndex === -1 ? null : args[messageIndex + 1];
  const filtered = removeFlagValues(args, [toIndex, modeIndex, messageIndex]);
  const capsuleId = parseOptionalCapsuleId(filtered);
  const projectRoot = io.cwd ?? process.cwd();
  const config = loadConfig(io.env);

  if (!targetModel) {
    throw new Error("--to is required with a target 0G model ID.");
  }

  if (!mode) {
    throw new Error(`--mode is required. Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  if (!CONTEXT_MODES.includes(mode)) {
    throw new Error(`Invalid context mode "${mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  const record = await readCapsule(projectRoot, capsuleId);
  if (!record) {
    io.stdout.write("No local Context Capsules found. Run relay ask first to create one.\n");
    return;
  }

  const events = await loadEventPayloads(projectRoot);
  const result = await runModelSwitch({
    capsule: record.payload,
    mode,
    events,
    model: targetModel,
    instruction,
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    fetchImpl: io.fetch
  });

  const eventRecord = await saveEvent(projectRoot, result.event);
  const viewRecord = await saveView(projectRoot, result.view);
  const capsuleRecord = await saveCapsule(projectRoot, result.updatedCapsule);

  io.stdout.write(`${result.completion.content}\n`);
  io.stdout.write(`\nSwitched to: ${targetModel}\n`);
  io.stdout.write(`Context mode: ${mode}\n`);
  io.stdout.write(`Estimated handoff: ${formatTokenCount(result.estimates.viewTokens)} tokens\n`);
  io.stdout.write(`Full event history: ${formatTokenCount(result.estimates.fullHistoryTokens)} tokens\n`);

  if (result.estimates.reductionPercent === null) {
    io.stdout.write("Estimated context reduction: unavailable\n");
  } else {
    io.stdout.write(`Estimated context reduction: ${result.estimates.reductionPercent}%\n`);
  }

  io.stdout.write("Transcript-independent: yes\n");
  io.stdout.write(`event_id: ${result.event.event_id}\n`);
  io.stdout.write(`event_hash: ${eventRecord.content_hash}\n`);
  io.stdout.write(`view_id: ${result.view.view_id}\n`);
  io.stdout.write(`view_hash: ${viewRecord.content_hash}\n`);
  io.stdout.write(`capsule_id: ${result.updatedCapsule.capsule_id}\n`);
  io.stdout.write(`capsule_hash: ${capsuleRecord.content_hash}\n`);

  if (result.completion.trace.requestId) {
    io.stdout.write(`request_id: ${result.completion.trace.requestId}\n`);
  }

  if (result.completion.trace.provider) {
    io.stdout.write(`provider: ${result.completion.trace.provider}\n`);
  }

  if (result.completion.trace.billing.totalCost) {
    io.stdout.write(`total_cost: ${result.completion.trace.billing.totalCost} neuron\n`);
  }
}

async function runCapsulePublishCommand(args, projectRoot, io) {
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex === -1 ? "standard" : args[modeIndex + 1];
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

async function runCapsuleViewCommand(args, projectRoot, io) {
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

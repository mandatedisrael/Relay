import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./hash.mjs";
import { createInitialCapsule, updateCapsuleFromEvent } from "./capsule-compiler.mjs";
import { fetchCapsuleBundle, importCapsuleBundle } from "./capsule-fetch.mjs";
import { publishCapsuleBundle } from "./capsule-publish.mjs";
import { buildModelResponseEvent } from "./events.mjs";
import { initializeLocalStore, readCapsule, saveCapsule, saveEvent, saveView } from "./local-store.mjs";
import { runLiveDoctorChecks } from "./live-checks.mjs";
import { loadConfig } from "./config.mjs";
import { loadStorageConfig } from "./storage-config.mjs";
import { buildContextView } from "./view-builder.mjs";
import { runModelSwitch, messagesIncludeTranscript } from "./model-switch.mjs";
import { createChatCompletion, fetchModelCatalog } from "./zerog-router.mjs";
import { validateCapsule } from "./protocol.mjs";

const DEFAULT_GOAL = "Prove Relay shared context across 0G models";
const DEFAULT_MODEL_A_PROMPT = "You are model A. Give one short diagnostic step for the task goal.";
const DEFAULT_SWITCH_MESSAGE = "You are model B. Continue from the capsule and propose the next concrete action.";
const DEFAULT_FETCH_SWITCH_MESSAGE = "You are model B after a storage fetch. Confirm you can continue from the capsule.";

export async function runMvpProof({
  projectRoot,
  env,
  fetchImpl = globalThis.fetch,
  modelA,
  modelB,
  mode = "standard",
  goal = DEFAULT_GOAL,
  skipStorage = false,
  storageDeps,
  routerDeps = {},
  liveChecks = runLiveDoctorChecks
}) {
  const report = {
    schema: "relay.proof-report.v1",
    started_at: new Date().toISOString(),
    completed_at: null,
    mode,
    goal,
    skip_storage: skipStorage,
    steps: [],
    token_proof: null,
    storage: null,
    models: {},
    all_passed: false
  };

  const doctor = await liveChecks({ env, fetchImpl });
  const routerChecksOk = doctor.checks
    .filter((check) => check.name.startsWith("router_"))
    .every((check) => check.ok);
  const storageChecksOk = doctor.checks
    .filter((check) => check.name.startsWith("storage_"))
    .every((check) => check.ok);

  recordStep(report, "live_doctor", routerChecksOk && (skipStorage || storageChecksOk), {
    checks: doctor.checks,
    skip_storage: skipStorage
  });

  if (!routerChecksOk) {
    report.completed_at = new Date().toISOString();
    return finalizeReport(report);
  }

  if (!doctor.router.hasInferenceKey) {
    throw new Error("OG_INFERENCE_API_KEY is required for relay proof.");
  }

  if (!skipStorage && !doctor.storage?.hasPrivateKey) {
    throw new Error("OG_STORAGE_PRIVATE_KEY is required unless --skip-storage is set.");
  }

  await initializeLocalStore(projectRoot);
  recordStep(report, "local_store", true, { root: join(projectRoot, ".relay") });

  const models = doctor.models.length > 0
    ? doctor.models
    : await fetchModelCatalog({ baseUrl: doctor.router.routerBaseUrl, fetchImpl });
  const selected = selectProofModels(models, { modelA, modelB });
  report.models = selected;
  recordStep(report, "model_selection", true, selected);

  const routerConfig = loadConfig(env);
  const completionA = await createChatCompletion({
    baseUrl: routerConfig.routerBaseUrl,
    apiKey: routerConfig.inferenceApiKey,
    model: selected.modelA,
    messages: [{ role: "user", content: DEFAULT_MODEL_A_PROMPT }],
    fetchImpl,
    ...routerDeps
  });

  const eventA = buildModelResponseEvent({
    completion: completionA,
    prompt: DEFAULT_MODEL_A_PROMPT
  });
  await saveEvent(projectRoot, eventA);
  const capsule = createInitialCapsule({ goal, event: eventA });
  await saveCapsule(projectRoot, capsule);

  recordStep(report, "model_a_ask", true, {
    model_id: selected.modelA,
    event_id: eventA.event_id,
    capsule_id: capsule.capsule_id,
    total_cost: completionA.trace.billing.totalCost ?? null
  });

  const eventsAfterA = [eventA];
  const viewBeforeSwitch = buildContextView({ capsule, mode, events: eventsAfterA });
  await saveView(projectRoot, viewBeforeSwitch.view);
  report.token_proof = {
    handoff_tokens: viewBeforeSwitch.estimates.viewTokens,
    full_history_tokens: viewBeforeSwitch.estimates.fullHistoryTokens,
    reduction_percent: viewBeforeSwitch.estimates.reductionPercent
  };
  recordStep(report, "token_proof", true, report.token_proof);

  const switchResult = await runModelSwitch({
    capsule,
    mode,
    events: eventsAfterA,
    model: selected.modelB,
    instruction: DEFAULT_SWITCH_MESSAGE,
    baseUrl: routerConfig.routerBaseUrl,
    apiKey: routerConfig.inferenceApiKey,
    fetchImpl,
    ...routerDeps
  });

  await saveEvent(projectRoot, switchResult.event);
  await saveView(projectRoot, switchResult.view);
  await saveCapsule(projectRoot, switchResult.updatedCapsule);

  const transcriptIndependent = !messagesIncludeTranscript(
    switchResult.messages,
    eventsAfterA,
    capsule
  );

  recordStep(report, "model_b_switch", transcriptIndependent, {
    model_id: selected.modelB,
    event_id: switchResult.event.event_id,
    capsule_id: switchResult.updatedCapsule.capsule_id,
    transcript_independent: transcriptIndependent,
    total_cost: switchResult.completion.trace.billing.totalCost ?? null
  });

  if (!skipStorage) {
    const storageConfig = loadStorageConfig(env);
    const events = [eventA, switchResult.event];
    const publishResult = await publishCapsuleBundle({
      projectRoot,
      capsule: switchResult.updatedCapsule,
      events,
      mode,
      storageConfig,
      deps: storageDeps
    });

    await saveCapsule(projectRoot, publishResult.updatedCapsule);
    report.storage = {
      relay_url: publishResult.relayUrl,
      root_hash: publishResult.upload.rootHash,
      tx_hash: publishResult.upload.txHash,
      encryption: "aes256",
      key_hex: publishResult.keyHex
    };
    recordStep(report, "storage_publish", true, report.storage);

    const fetched = await fetchCapsuleBundle({
      projectRoot,
      reference: publishResult.relayUrl,
      storageConfig,
      encryptionKeyHex: publishResult.keyHex,
      deps: storageDeps
    });
    const imported = await importCapsuleBundle(projectRoot, fetched.bundle);
    recordStep(report, "storage_fetch", fetched.proofVerified, {
      root_hash: fetched.rootHash,
      proof_verified: fetched.proofVerified,
      capsule_id: fetched.bundle.capsule.capsule_id,
      events_imported: imported.eventRecords.length
    });

    const fetchedCapsuleRecord = await readCapsule(projectRoot, fetched.bundle.capsule.capsule_id);
    const continueResult = await runModelSwitch({
      capsule: fetchedCapsuleRecord.payload,
      mode,
      events: fetched.bundle.events,
      model: selected.modelB,
      instruction: DEFAULT_FETCH_SWITCH_MESSAGE,
      baseUrl: routerConfig.routerBaseUrl,
      apiKey: routerConfig.inferenceApiKey,
      fetchImpl,
      ...routerDeps
    });

    const continuedCapsule = updateCapsuleFromEvent({
      capsule: fetchedCapsuleRecord.payload,
      event: continueResult.event
    });
    await saveEvent(projectRoot, continueResult.event);
    await saveCapsule(projectRoot, continuedCapsule);

    const continuedValidation = validateCapsule(continuedCapsule);
    recordStep(report, "continue_from_fetched", continuedValidation.ok, {
      model_id: selected.modelB,
      event_id: continueResult.event.event_id,
      capsule_id: continuedCapsule.capsule_id
    });
  }

  report.completed_at = new Date().toISOString();
  return finalizeReport(report);
}

export async function saveProofReport(projectRoot, report) {
  const directory = join(projectRoot, ".relay", "proof");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "latest.json");
  await writeFile(path, canonicalJson(report), "utf8");
  return path;
}

export function selectProofModels(models, { modelA, modelB } = {}) {
  const eligible = models
    .filter((model) => model.capabilities.chat)
    .sort((left, right) => comparePromptPrice(left, right));

  if (eligible.length < 2 && (!modelA || !modelB)) {
    throw new Error("Need at least two chat-capable 0G Router models for relay proof.");
  }

  const resolvedA = modelA ?? eligible[0]?.id;
  const resolvedB = modelB ?? eligible.find((model) => model.id !== resolvedA)?.id;

  if (!resolvedA || !resolvedB) {
    throw new Error("Could not resolve two distinct proof models.");
  }

  if (resolvedA === resolvedB) {
    throw new Error("Model A and Model B must be different models.");
  }

  return {
    modelA: resolvedA,
    modelB: resolvedB
  };
}

function comparePromptPrice(left, right) {
  const leftPrice = BigInt(left.pricing.prompt ?? "0");
  const rightPrice = BigInt(right.pricing.prompt ?? "0");
  if (leftPrice === rightPrice) {
    return left.id.localeCompare(right.id);
  }
  return leftPrice < rightPrice ? -1 : 1;
}

function recordStep(report, name, ok, detail = {}) {
  report.steps.push({
    name,
    ok: Boolean(ok),
    at: new Date().toISOString(),
    detail
  });
}

function finalizeReport(report) {
  report.all_passed = report.steps.length > 0 && report.steps.every((step) => step.ok);
  return report;
}
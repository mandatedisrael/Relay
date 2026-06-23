import { saveActiveTask } from "./active-task.mjs";
import { publishCapsuleBundle } from "./capsule-publish.mjs";
import { writePortableHandoff } from "./handoff-export.mjs";
import { loadTargetOverrides, resolveHandoffTarget } from "./model-targets.mjs";
import { probeModelAccess } from "./model-access.mjs";
import { readCapsule, saveCapsule, saveView } from "./local-store.mjs";
import { loadStorageConfig } from "./storage-config.mjs";
import { continueTask } from "./task-runtime.mjs";
import { buildContextView } from "./view-builder.mjs";
import { fetchModelCatalog } from "./zerog-router.mjs";

export async function handoffTaskToTarget({
  projectRoot,
  targetName,
  events,
  capsuleId = "latest",
  mode = "compact",
  message = null,
  handoffOnly = false,
  env = {},
  baseUrl,
  apiKey,
  hasInferenceKey,
  fetchImpl,
  storageDeps
}) {
  const record = await readCapsule(projectRoot, capsuleId);
  if (!record) {
    throw new Error("No Context Capsule found. Start a task with `relay task start` first.");
  }

  const storageConfig = loadStorageConfig(env);
  if (!storageConfig.hasPrivateKey) {
    throw new Error("OG_STORAGE_PRIVATE_KEY is required to make memory portable on 0G Storage.");
  }

  const catalog = await fetchModelCatalog({ baseUrl, fetchImpl });
  let allowedModelIds = [];
  if (hasInferenceKey) {
    const access = await probeModelAccess({
      baseUrl,
      apiKey,
      models: catalog,
      fetchImpl
    });
    allowedModelIds = access.summary.allowedModels.map((model) => model.id);
  }

  const overrides = await loadTargetOverrides(projectRoot);
  const target = resolveHandoffTarget(targetName, {
    overrides,
    allowedModelIds,
    catalogModelIds: catalog.map((model) => model.id)
  });

  const publishResult = await publishCapsuleBundle({
    projectRoot,
    capsule: record.payload,
    events,
    mode,
    storageConfig,
    deps: storageDeps
  });
  await saveCapsule(projectRoot, publishResult.updatedCapsule);
  await saveView(projectRoot, publishResult.view);

  const viewResult = buildContextView({
    capsule: publishResult.updatedCapsule,
    mode,
    events
  });

  let continueResult = null;
  const shouldContinue = !handoffOnly && !target.external && target.modelId;

  if (shouldContinue) {
    if (!hasInferenceKey) {
      throw new Error("OG_INFERENCE_API_KEY is required to continue on a 0G model.");
    }

    continueResult = await continueTask({
      projectRoot,
      capsule: publishResult.updatedCapsule,
      events,
      targetModel: target.modelId,
      message: message ?? `Continue this Relay task on ${target.label}.`,
      mode,
      baseUrl,
      apiKey,
      fetchImpl
    });
  }

  await saveActiveTask(projectRoot, {
    capsule_id: (continueResult?.updatedCapsule ?? publishResult.updatedCapsule).capsule_id,
    goal: (continueResult?.updatedCapsule ?? publishResult.updatedCapsule).task.goal,
    last_model: continueResult ? target.modelId : record.payload.routing?.last_model ?? null
  });

  const exportResult = await writePortableHandoff({
    projectRoot,
    target,
    capsule: continueResult?.updatedCapsule ?? publishResult.updatedCapsule,
    handoff: viewResult.handoff,
    publishResult,
    continued: Boolean(continueResult),
    modelId: target.modelId
  });

  return {
    target,
    publishResult,
    continueResult,
    exportResult,
    viewResult
  };
}
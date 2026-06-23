import { saveActiveTask } from "./active-task.mjs";
import { createInitialCapsule } from "./capsule-compiler.mjs";
import { buildModelResponseEvent } from "./events.mjs";
import { saveCapsule, saveEvent, saveView } from "./local-store.mjs";
import { runModelSwitch } from "./model-switch.mjs";
import { buildTaskMemorySummary } from "./task-summary.mjs";
import { createChatCompletion } from "./zerog-router.mjs";

export async function startTask({
  projectRoot,
  model,
  goal,
  message,
  baseUrl,
  apiKey,
  fetchImpl
}) {
  const completion = await createChatCompletion({
    baseUrl,
    apiKey,
    model,
    messages: [{ role: "user", content: message }],
    fetchImpl
  });

  const event = buildModelResponseEvent({ completion, prompt: message });
  await saveEvent(projectRoot, event);

  const capsule = createInitialCapsule({ goal: goal || message, event });
  await saveCapsule(projectRoot, capsule);
  await saveActiveTask(projectRoot, {
    capsule_id: capsule.capsule_id,
    goal: capsule.task.goal,
    last_model: model
  });

  const summary = buildTaskMemorySummary({
    capsule,
    events: [event],
    model
  });

  return { completion, event, capsule, summary };
}

export async function stepTask({
  projectRoot,
  capsule,
  events,
  model,
  message,
  mode = "standard",
  baseUrl,
  apiKey,
  fetchImpl
}) {
  const result = await runModelSwitch({
    capsule,
    mode,
    events,
    model,
    instruction: message,
    baseUrl,
    apiKey,
    fetchImpl
  });

  await saveEvent(projectRoot, result.event);
  await saveView(projectRoot, result.view);
  await saveCapsule(projectRoot, result.updatedCapsule);
  await saveActiveTask(projectRoot, {
    capsule_id: result.updatedCapsule.capsule_id,
    goal: result.updatedCapsule.task.goal,
    last_model: model
  });

  const summary = buildTaskMemorySummary({
    capsule: result.updatedCapsule,
    events: [...events, result.event],
    mode,
    model,
    transcriptIndependent: true
  });

  return { ...result, summary };
}

export async function continueTask({
  projectRoot,
  capsule,
  events,
  targetModel,
  message,
  mode,
  baseUrl,
  apiKey,
  fetchImpl
}) {
  const result = await stepTask({
    projectRoot,
    capsule,
    events,
    model: targetModel,
    message,
    mode,
    baseUrl,
    apiKey,
    fetchImpl
  });

  return result;
}


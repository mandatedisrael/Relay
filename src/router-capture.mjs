import { readActiveTask, saveActiveTask } from "./active-task.mjs";
import { createInitialCapsule, updateCapsuleFromEvent } from "./capsule-compiler.mjs";
import { buildContinuationMessages, RELAY_CONTINUATION_SYSTEM_PROMPT } from "./continuation.mjs";
import { buildModelResponseEvent } from "./events.mjs";
import { initializeLocalStore, readCapsule, saveCapsule, saveEvent } from "./local-store.mjs";
import { parseChatCompletion } from "./zerog-router.mjs";
import { buildContextView } from "./view-builder.mjs";
import { CONTEXT_MODES } from "./protocol.mjs";

export function resolveRelayProxyHeaders(headers = {}) {
  const normalized = normalizeHeaders(headers);
  return {
    goal: normalized["x-relay-goal"] ?? null,
    mode: normalizeMode(normalized["x-relay-mode"]),
    noHandoff: normalized["x-relay-no-handoff"] === "true",
    transcriptIndependent: normalized["x-relay-transcript-independent"] !== "false",
    projectRoot: normalized["x-relay-project-root"] ?? null
  };
}

export function findLastUserMessage(messages) {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string" && message.content.trim()) {
      return message;
    }
  }

  return null;
}

export function prepareProxiedChatRequest({
  messages,
  handoff = null,
  transcriptIndependent = true,
  injectHandoff = true
}) {
  const clientMessages = Array.isArray(messages) ? messages : [];
  const lastUser = findLastUserMessage(clientMessages);

  if (!injectHandoff || !handoff) {
    return {
      messages: clientMessages,
      prompt: lastUser?.content ?? ""
    };
  }

  if (transcriptIndependent) {
    const proxied = buildContinuationMessages({
      handoff,
      instruction: lastUser?.content ?? "Continue the task based on the capsule above."
    });
    return {
      messages: proxied,
      prompt: proxied.at(-1)?.content ?? ""
    };
  }

  return {
    messages: [
      {
        role: "system",
        content: `${RELAY_CONTINUATION_SYSTEM_PROMPT}\n\n${handoff}`
      },
      ...clientMessages
    ],
    prompt: lastUser?.content ?? ""
  };
}

export async function loadRelayHandoff(projectRoot, { mode = "compact", eventsLoader }) {
  const activeTask = await readActiveTask(projectRoot);
  if (!activeTask?.capsule_id) {
    return { activeTask: null, handoff: null, capsule: null };
  }

  const record = await readCapsule(projectRoot, activeTask.capsule_id);
  if (!record) {
    return { activeTask, handoff: null, capsule: null };
  }

  const events = await eventsLoader(projectRoot);
  const view = buildContextView({
    capsule: record.payload,
    mode,
    events
  });

  return {
    activeTask,
    handoff: view.handoff,
    capsule: record.payload
  };
}

export async function captureProxiedCompletion({
  projectRoot,
  requestBody,
  responseBody,
  relayHeaders,
  eventsLoader
}) {
  await initializeLocalStore(projectRoot);

  const completion = parseChatCompletion(responseBody);
  const lastUser = findLastUserMessage(requestBody.messages);
  const prompt = lastUser?.content ?? "Relay proxied request";
  const event = buildModelResponseEvent({
    completion,
    prompt,
    extraPayload: {
      relay_proxy: true,
      handoff_mode: relayHeaders.mode,
      transcript_independent: relayHeaders.transcriptIndependent
    }
  });

  await saveEvent(projectRoot, event);

  const shouldStartNewTask = Boolean(relayHeaders.goal) || !(await hasActiveTask(projectRoot));
  let capsule;

  if (shouldStartNewTask) {
    capsule = createInitialCapsule({
      goal: relayHeaders.goal ?? prompt,
      event
    });
  } else {
    const { capsule: existing } = await loadRelayHandoff(projectRoot, {
      mode: relayHeaders.mode,
      eventsLoader
    });
    if (!existing) {
      capsule = createInitialCapsule({ goal: relayHeaders.goal ?? prompt, event });
    } else {
      capsule = updateCapsuleFromEvent({ capsule: existing, event });
    }
  }

  await saveCapsule(projectRoot, capsule);
  await saveActiveTask(projectRoot, {
    capsule_id: capsule.capsule_id,
    goal: capsule.task.goal,
    last_model: completion.model
  });

  return {
    event,
    capsule
  };
}

async function hasActiveTask(projectRoot) {
  const activeTask = await readActiveTask(projectRoot);
  return Boolean(activeTask?.capsule_id);
}

function normalizeMode(value) {
  if (typeof value === "string" && CONTEXT_MODES.includes(value)) {
    return value;
  }
  return "compact";
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}
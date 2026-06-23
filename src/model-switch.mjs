import { updateCapsuleFromEvent } from "./capsule-compiler.mjs";
import { buildContinuationMessages, buildContinuationPrompt } from "./continuation.mjs";
import { buildModelResponseEvent } from "./events.mjs";
import { buildContextView } from "./view-builder.mjs";
import { createChatCompletion } from "./zerog-router.mjs";

export function prepareModelSwitch({ capsule, mode, events = [], instruction }) {
  const viewResult = buildContextView({ capsule, mode, events });
  const continuationPrompt = buildContinuationPrompt({
    handoff: viewResult.handoff,
    instruction: instruction ?? capsule.state.next_action
  });
  const messages = buildContinuationMessages({
    handoff: viewResult.handoff,
    instruction: instruction ?? capsule.state.next_action
  });

  return {
    view: viewResult.view,
    handoff: viewResult.handoff,
    estimates: viewResult.estimates,
    messages,
    continuationPrompt
  };
}

export async function runModelSwitch({
  capsule,
  mode,
  events = [],
  model,
  instruction,
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch
}) {
  if (!model) {
    throw new Error("A target model ID is required.");
  }

  const prepared = prepareModelSwitch({ capsule, mode, events, instruction });
  const completion = await createChatCompletion({
    baseUrl,
    apiKey,
    model,
    messages: prepared.messages,
    fetchImpl
  });

  const event = buildModelResponseEvent({
    completion,
    prompt: prepared.continuationPrompt,
    extraPayload: {
      handoff: {
        source_capsule_id: capsule.capsule_id,
        view_mode: mode,
        view_id: prepared.view.view_id,
        transcript_independent: true
      }
    }
  });

  const updatedCapsule = updateCapsuleFromEvent({ capsule, event });

  return {
    completion,
    event,
    updatedCapsule,
    view: prepared.view,
    estimates: prepared.estimates,
    messages: prepared.messages
  };
}

export function messagesIncludeTranscript(messages, events, capsule) {
  if (!Array.isArray(messages) || !Array.isArray(events)) {
    return false;
  }

  const referencedEvents = new Set(
    (capsule?.evidence ?? [])
      .map((item) => item.source_event)
      .filter(Boolean)
  );

  const transcriptSnippets = events
    .filter((event) => !referencedEvents.has(event.event_id))
    .flatMap((event) => [event.payload?.prompt, event.payload?.response, event.payload?.text])
    .filter((value) => typeof value === "string" && value.trim().length > 20);

  const serializedMessages = messages
    .map((message) => message.content)
    .join("\n");

  return transcriptSnippets.some((snippet) => serializedMessages.includes(snippet.trim()));
}
import { canonicalJson, sha256Digest } from "./hash.mjs";

export function buildModelResponseEvent({ completion, prompt }) {
  const requestId = completion.trace.requestId ?? completion.id ?? `local_${Date.now()}`;
  const eventId = `evt_${sanitizeId(requestId)}`;
  const payload = {
    prompt,
    response: completion.content,
    raw_response_id: completion.id
  };

  return {
    schema: "relay.event.v1",
    event_id: eventId,
    timestamp: new Date().toISOString(),
    kind: "model.response",
    source: {
      runtime: "0g-router",
      model_id: completion.model,
      provider: completion.trace.provider,
      request_id: completion.trace.requestId
    },
    trace: buildTrace(completion),
    payload,
    content_hash: sha256Digest(canonicalJson(payload))
  };
}

function buildTrace(completion) {
  if (!completion.model || !completion.trace.provider || !completion.trace.requestId) {
    return undefined;
  }

  return {
    model_id: completion.model,
    provider: completion.trace.provider,
    request_id: completion.trace.requestId,
    input_tokens: completion.usage.inputTokens ?? 0,
    output_tokens: completion.usage.outputTokens ?? 0,
    billing: {
      currency: "neuron",
      input_cost: completion.trace.billing.inputCost ?? "0",
      output_cost: completion.trace.billing.outputCost ?? "0",
      total_cost: completion.trace.billing.totalCost ?? "0"
    },
    tee_verified: completion.trace.teeVerified
  };
}

function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

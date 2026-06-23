import { createChatCompletion } from "./zerog-router.mjs";

export const MODEL_ACCESS_PROBE_MESSAGE = "ok";

const MODEL_ACCESS_DENIED_PATTERN = /model not allowed for this api key/i;

export function isModelAccessDenied(error) {
  const message = error instanceof Error ? error.message : String(error);
  return MODEL_ACCESS_DENIED_PATTERN.test(message);
}

export function summarizeModelAccess(results) {
  const allowed = results.filter((result) => result.allowed);
  const denied = results.filter((result) => !result.allowed);
  return {
    total: results.length,
    allowedCount: allowed.length,
    deniedCount: denied.length,
    allowedModels: allowed.map((result) => result.model),
    deniedModels: denied.map((result) => result.model)
  };
}

export async function probeModelAccess({
  baseUrl,
  apiKey,
  models,
  fetchImpl = globalThis.fetch,
  chatOnly = true,
  maxTokens = 1,
  probeMessage = MODEL_ACCESS_PROBE_MESSAGE
} = {}) {
  if (!baseUrl) {
    throw new Error("0G Router base URL is required.");
  }

  if (!apiKey) {
    throw new Error("OG_INFERENCE_API_KEY is required to probe allowed models.");
  }

  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("At least one catalog model is required to probe access.");
  }

  const candidates = chatOnly
    ? models.filter((model) => model.capabilities.chat)
    : models;

  const results = [];
  for (const model of candidates) {
    results.push(await probeSingleModelAccess({
      baseUrl,
      apiKey,
      model,
      fetchImpl,
      maxTokens,
      probeMessage
    }));
  }

  return {
    results,
    summary: summarizeModelAccess(results)
  };
}

async function probeSingleModelAccess({
  baseUrl,
  apiKey,
  model,
  fetchImpl,
  maxTokens,
  probeMessage
}) {
  try {
    await createChatCompletion({
      baseUrl,
      apiKey,
      model: model.id,
      messages: [{ role: "user", content: probeMessage }],
      maxTokens,
      fetchImpl
    });

    return {
      model,
      allowed: true,
      reason: null
    };
  } catch (error) {
    if (isModelAccessDenied(error)) {
      return {
        model,
        allowed: false,
        reason: "not_allowed_for_api_key"
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      model,
      allowed: false,
      reason: message.replace(/^0G Router chat completion failed:\s*/i, "")
    };
  }
}

export function formatModelAccessReason(reason) {
  if (!reason) {
    return "allowed";
  }

  if (reason === "not_allowed_for_api_key") {
    return "not allowed for API key";
  }

  return reason;
}
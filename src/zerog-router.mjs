export async function fetchModelCatalog({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) {
    throw new Error("0G Router base URL is required.");
  }

  const response = await fetchImpl(routerUrl(baseUrl, "models"), {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`0G Router models request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  return parseModelCatalog(body);
}

export async function createChatCompletion({
  baseUrl,
  apiKey,
  model,
  messages,
  fetchImpl = globalThis.fetch,
  verifyTee = false,
  maxTokens
} = {}) {
  if (!baseUrl) {
    throw new Error("0G Router base URL is required.");
  }

  if (!apiKey) {
    throw new Error("OG_INFERENCE_API_KEY is required for chat completions.");
  }

  if (!model) {
    throw new Error("A model ID is required.");
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("At least one chat message is required.");
  }

  const response = await fetchImpl(routerUrl(baseUrl, "chat/completions"), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      verify_tee: verifyTee,
      ...(Number.isInteger(maxTokens) && maxTokens > 0 ? { max_tokens: maxTokens } : {})
    })
  });

  const body = await readJsonResponse(response);

  if (!response.ok) {
    const message = body?.error?.message ?? body?.message ?? `HTTP ${response.status}`;
    throw new Error(`0G Router chat completion failed: ${message}`);
  }

  return parseChatCompletion(body);
}

export function parseModelCatalog(body) {
  if (!body || body.object !== "list" || !Array.isArray(body.data)) {
    throw new Error("0G Router returned an invalid model catalog.");
  }

  return body.data.map((model) => ({
    id: requireString(model.id, "model.id"),
    name: typeof model.name === "string" ? model.name : model.id,
    owner: typeof model.owned_by === "string" ? model.owned_by : null,
    contextLength: readInteger(model.context_length),
    providerCount: readInteger(model.provider_count ?? model.providers_count ?? model.healthy_providers),
    pricing: {
      prompt: readStringOrNull(model.pricing?.prompt),
      completion: readStringOrNull(model.pricing?.completion)
    },
    capabilities: readCapabilities(model)
  }));
}

export function parseChatCompletion(body) {
  if (!body || !Array.isArray(body.choices) || body.choices.length === 0) {
    throw new Error("0G Router returned an invalid chat completion.");
  }

  const choice = body.choices[0];
  const message = choice.message ?? {};
  const trace = body.x_0g_trace ?? {};

  return {
    id: typeof body.id === "string" ? body.id : null,
    model: typeof body.model === "string" ? body.model : null,
    content: typeof message.content === "string" ? message.content : "",
    reasoningContent: typeof message.reasoning_content === "string"
      ? message.reasoning_content
      : message.provider_specific_fields?.reasoning_content ?? null,
    usage: {
      inputTokens: readInteger(body.usage?.prompt_tokens),
      outputTokens: readInteger(body.usage?.completion_tokens),
      totalTokens: readInteger(body.usage?.total_tokens)
    },
    trace: {
      requestId: typeof trace.request_id === "string" ? trace.request_id : null,
      provider: typeof trace.provider === "string" ? trace.provider : null,
      billing: {
        inputCost: readStringOrNull(trace.billing?.input_cost),
        outputCost: readStringOrNull(trace.billing?.output_cost),
        totalCost: readStringOrNull(trace.billing?.total_cost)
      },
      teeVerified: typeof trace.tee_verified === "boolean" ? trace.tee_verified : null
    },
    raw: body
  };
}

function routerUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function readCapabilities(model) {
  const raw = model.capabilities ?? model.metadata?.capabilities ?? {};

  if (Array.isArray(raw)) {
    return {
      raw,
      chat: raw.includes("chat"),
      tools: raw.includes("tools") || raw.includes("tool_calling"),
      vision: raw.includes("vision"),
      json: raw.includes("json") || raw.includes("json_mode")
    };
  }

  if (raw && typeof raw === "object") {
    return {
      raw,
      chat: Boolean(raw.chat ?? true),
      tools: Boolean(raw.tools ?? raw.tool_calling),
      vision: Boolean(raw.vision),
      json: Boolean(raw.json ?? raw.json_mode ?? raw.structured_output)
    };
  }

  return {
    raw: null,
    chat: true,
    tools: false,
    vision: false,
    json: false
  };
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value;
}

function readInteger(value) {
  return Number.isInteger(value) ? value : null;
}

function readStringOrNull(value) {
  return typeof value === "string" ? value : null;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

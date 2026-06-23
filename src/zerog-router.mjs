export async function fetchModelCatalog({ baseUrl, fetchImpl = fetch } = {}) {
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

export function parseModelCatalog(body) {
  if (!body || body.object !== "list" || !Array.isArray(body.data)) {
    throw new Error("0G Router returned an invalid model catalog.");
  }

  return body.data.map((model) => ({
    id: requireString(model.id, "model.id"),
    name: typeof model.name === "string" ? model.name : model.id,
    owner: typeof model.owned_by === "string" ? model.owned_by : null,
    contextLength: readInteger(model.context_length),
    pricing: {
      prompt: readStringOrNull(model.pricing?.prompt),
      completion: readStringOrNull(model.pricing?.completion)
    },
    capabilities: readCapabilities(model)
  }));
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

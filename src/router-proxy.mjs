import { createServer } from "node:http";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";
import {
  captureProxiedCompletion,
  loadRelayHandoff,
  prepareProxiedChatRequest,
  resolveRelayProxyHeaders
} from "./router-capture.mjs";
import { fetchModelCatalog } from "./zerog-router.mjs";

export function createRelayRouterProxy({
  projectRoot,
  env,
  host = "127.0.0.1",
  port = 8791,
  fetchImpl = globalThis.fetch,
  eventsLoader
} = {}) {
  if (!projectRoot) {
    throw new Error("A project root is required for relay proxy.");
  }

  const config = loadConfig(env);
  if (!config.hasInferenceKey) {
    throw new Error("OG_INFERENCE_API_KEY is required for relay proxy.");
  }

  const upstreamBaseUrl = config.routerBaseUrl.replace(/\/+$/, "");
  const listenUrl = `http://${host}:${port}`;

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, {
        projectRoot,
        upstreamBaseUrl,
        apiKey: config.inferenceApiKey,
        fetchImpl,
        eventsLoader
      });
    } catch (error) {
      writeJson(res, 500, {
        error: {
          message: error.message
        }
      });
    }
  });

  return {
    server,
    listenUrl,
    projectRoot,
    upstreamBaseUrl,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      return `http://${host}:${resolvedPort}`;
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function handleRequest(req, res, context) {
  const url = new URL(req.url ?? "/", "http://relay.local");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && (pathname === "/health" || pathname === "/v1/health")) {
    writeJson(res, 200, {
      ok: true,
      service: "relay-proxy",
      project_root: context.projectRoot,
      upstream: context.upstreamBaseUrl
    });
    return;
  }

  if (req.method === "GET" && (pathname === "/v1/models" || pathname === "/models")) {
    const models = await fetchModelCatalog({
      baseUrl: context.upstreamBaseUrl,
      fetchImpl: context.fetchImpl
    });
    writeJson(res, 200, {
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        owned_by: model.owner ?? "0g",
        context_length: model.contextLength,
        provider_count: model.providerCount,
        pricing: model.pricing,
        capabilities: model.capabilities.raw ?? {
          chat: model.capabilities.chat,
          tools: model.capabilities.tools,
          vision: model.capabilities.vision,
          json: model.capabilities.json
        }
      }))
    });
    return;
  }

  if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/chat/completions")) {
    await handleChatCompletions(req, res, context);
    return;
  }

  writeJson(res, 404, {
    error: {
      message: `Relay proxy route not found: ${req.method} ${pathname}`
    }
  });
}

async function handleChatCompletions(req, res, context) {
  const requestBody = await readJsonBody(req);
  const relayHeaders = resolveRelayProxyHeaders(req.headers);
  const projectRoot = relayHeaders.projectRoot ?? context.projectRoot;
  const mode = relayHeaders.mode;

  const handoffState = relayHeaders.noHandoff
    ? { handoff: null }
    : await loadRelayHandoff(projectRoot, {
      mode,
      eventsLoader: context.eventsLoader
    });

  const prepared = prepareProxiedChatRequest({
    messages: requestBody.messages,
    handoff: handoffState.handoff,
    transcriptIndependent: relayHeaders.transcriptIndependent,
    injectHandoff: !relayHeaders.noHandoff && Boolean(handoffState.handoff) && !relayHeaders.goal
  });

  const upstreamBody = {
    ...requestBody,
    messages: prepared.messages
  };

  const upstreamResponse = await context.fetchImpl(`${context.upstreamBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${context.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(upstreamBody)
  });

  const responseBody = await upstreamResponse.json();

  if (upstreamResponse.ok) {
    await captureProxiedCompletion({
      projectRoot,
      requestBody,
      responseBody,
      relayHeaders,
      eventsLoader: context.eventsLoader
    });
  }

  res.statusCode = upstreamResponse.status;
  res.setHeader("content-type", "application/json");
  res.setHeader("x-relay-proxy", "true");
  if (handoffState.handoff && !relayHeaders.noHandoff) {
    res.setHeader("x-relay-handoff-applied", "true");
  }
  res.end(JSON.stringify(responseBody));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("Request body is required.");
  }

  return JSON.parse(text);
}

function writeJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function defaultEventsLoader(projectRoot) {
  return import("./local-store.mjs").then(async ({ listEvents, readEvent }) => {
    const listed = await listEvents(projectRoot);
    const records = await Promise.all(listed.map((entry) => readEvent(projectRoot, entry.id)));
    return records.map((record) => record.payload);
  });
}
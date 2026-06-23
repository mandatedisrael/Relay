import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatModelAccessReason,
  isModelAccessDenied,
  probeModelAccess,
  summarizeModelAccess
} from "../src/model-access.mjs";

const sampleModels = [
  {
    id: "example/allowed",
    capabilities: { chat: true },
    pricing: { prompt: "100", completion: "200" }
  },
  {
    id: "example/denied",
    capabilities: { chat: true },
    pricing: { prompt: "50", completion: "100" }
  },
  {
    id: "example/non-chat",
    capabilities: { chat: false },
    pricing: { prompt: "0", completion: "0" }
  }
];

describe("Relay model access probing", () => {
  it("detects API-key allowlist denials", () => {
    assert.equal(
      isModelAccessDenied(new Error("0G Router chat completion failed: model not allowed for this api key: example/denied")),
      true
    );
    assert.equal(isModelAccessDenied(new Error("insufficient balance")), false);
  });

  it("formats access reasons for CLI output", () => {
    assert.equal(formatModelAccessReason(null), "allowed");
    assert.equal(formatModelAccessReason("not_allowed_for_api_key"), "not allowed for API key");
    assert.equal(formatModelAccessReason("insufficient balance"), "insufficient balance");
  });

  it("summarizes probe results", () => {
    const summary = summarizeModelAccess([
      { model: sampleModels[0], allowed: true, reason: null },
      { model: sampleModels[1], allowed: false, reason: "not_allowed_for_api_key" }
    ]);

    assert.equal(summary.total, 2);
    assert.equal(summary.allowedCount, 1);
    assert.equal(summary.deniedCount, 1);
    assert.deepEqual(summary.allowedModels.map((model) => model.id), ["example/allowed"]);
  });

  it("probes chat-capable models with minimal completions", async () => {
    const calls = [];

    const access = await probeModelAccess({
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      models: sampleModels,
      fetchImpl: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });

        if (calls.at(-1).body.model === "example/denied") {
          return {
            ok: false,
            async json() {
              return { error: { message: "model not allowed for this api key: example/denied" } };
            }
          };
        }

        return {
          ok: true,
          async json() {
            return {
              choices: [{ message: { content: "ok" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 }
            };
          }
        };
      }
    });

    assert.equal(access.summary.total, 2);
    assert.equal(access.summary.allowedCount, 1);
    assert.equal(access.summary.deniedCount, 1);
    assert.equal(access.results.find((result) => result.model.id === "example/allowed").allowed, true);
    assert.equal(access.results.find((result) => result.model.id === "example/denied").reason, "not_allowed_for_api_key");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.max_tokens, 1);
    assert.equal(calls[0].body.messages[0].content, "ok");
  });
});
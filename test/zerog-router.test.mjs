import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createChatCompletion,
  fetchModelCatalog,
  parseChatCompletion,
  parseModelCatalog
} from "../src/zerog-router.mjs";

describe("0G Router model catalog", () => {
  it("parses OpenAI-style model catalog responses", () => {
    const catalog = parseModelCatalog({
      object: "list",
      data: [
        {
          id: "example/model",
          object: "model",
          owned_by: "0G Foundation",
          name: "Example Model",
          context_length: 131072,
          provider_count: 3,
          pricing: {
            prompt: "100000000000",
            completion: "320000000000"
          },
          capabilities: {
            chat: true,
            tools: true,
            vision: false,
            json_mode: true
          }
        }
      ]
    });

    assert.deepEqual(catalog, [
      {
        id: "example/model",
        name: "Example Model",
        owner: "0G Foundation",
        contextLength: 131072,
        providerCount: 3,
        pricing: {
          prompt: "100000000000",
          completion: "320000000000"
        },
        capabilities: {
          raw: {
            chat: true,
            tools: true,
            vision: false,
            json_mode: true
          },
          chat: true,
          tools: true,
          vision: false,
          json: true
        }
      }
    ]);
  });

  it("fetches the model catalog from the configured base URL", async () => {
    const catalog = await fetchModelCatalog({
      baseUrl: "https://router-api.0g.ai/v1/",
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://router-api.0g.ai/v1/models");
        assert.equal(options.method, "GET");

        return {
          ok: true,
          async json() {
            return {
              object: "list",
              data: [
                {
                  id: "example/model"
                }
              ]
            };
          }
        };
      }
    });

    assert.equal(catalog[0].id, "example/model");
  });

  it("rejects invalid catalog responses", () => {
    assert.throws(() => parseModelCatalog({ object: "not-list", data: [] }), /invalid model catalog/);
  });

  it("requires an inference API key for chat completions", async () => {
    await assert.rejects(
      () => createChatCompletion({
        baseUrl: "https://router-api.0g.ai/v1",
        model: "example/model",
        messages: [{ role: "user", content: "hello" }]
      }),
      /OG_INFERENCE_API_KEY/
    );
  });

  it("sends OpenAI-compatible chat completion requests", async () => {
    const completion = await createChatCompletion({
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      model: "example/model",
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://router-api.0g.ai/v1/chat/completions");
        assert.equal(options.method, "POST");
        assert.equal(options.headers.authorization, "Bearer sk-test");

        const body = JSON.parse(options.body);
        assert.equal(body.model, "example/model");
        assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);

        return {
          ok: true,
          async json() {
            return chatCompletionBody();
          }
        };
      }
    });

    assert.equal(completion.content, "hello from 0G");
    assert.equal(completion.trace.requestId, "req_001");
    assert.equal(completion.trace.billing.totalCost, "300");
  });

  it("supports max_tokens for low-cost probe requests", async () => {
    await createChatCompletion({
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      model: "example/model",
      messages: [{ role: "user", content: "ok" }],
      maxTokens: 1,
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.max_tokens, 1);

        return {
          ok: true,
          async json() {
            return chatCompletionBody();
          }
        };
      }
    });
  });

  it("parses Router chat completion trace metadata", () => {
    assert.deepEqual(parseChatCompletion(chatCompletionBody()), {
      id: "chatcmpl_001",
      model: "example/model",
      content: "hello from 0G",
      reasoningContent: null,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      },
      trace: {
        requestId: "req_001",
        provider: "0x0000000000000000000000000000000000000000",
        billing: {
          inputCost: "100",
          outputCost: "200",
          totalCost: "300"
        },
        teeVerified: true
      },
      raw: chatCompletionBody()
    });
  });
});

function chatCompletionBody() {
  return {
    id: "chatcmpl_001",
    model: "example/model",
    choices: [
      {
        message: {
          role: "assistant",
          content: "hello from 0G"
        }
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15
    },
    x_0g_trace: {
      request_id: "req_001",
      provider: "0x0000000000000000000000000000000000000000",
      billing: {
        input_cost: "100",
        output_cost: "200",
        total_cost: "300"
      },
      tee_verified: true
    }
  };
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchModelCatalog, parseModelCatalog } from "../src/zerog-router.mjs";

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
});

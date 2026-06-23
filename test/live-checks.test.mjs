import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLiveDoctorChecks } from "../src/live-checks.mjs";

describe("Relay live doctor checks", () => {
  it("reports missing credentials and live catalog status", async () => {
    const result = await runLiveDoctorChecks({
      env: {},
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            object: "list",
            data: [{
              id: "example/model",
              pricing: { prompt: "1", completion: "1" },
              capabilities: { chat: true, tools: false, vision: false, json_mode: true }
            }]
          };
        }
      })
    });

    assert.equal(result.checks.find((check) => check.name === "router_catalog").ok, true);
    assert.equal(result.checks.find((check) => check.name === "router_inference_key").ok, false);
    assert.match(
      result.checks.find((check) => check.name === "router_allowed_models").detail,
      /skipped until OG_INFERENCE_API_KEY/
    );
    assert.equal(result.readyForProof, false);
  });

  it("reports allowed model count when the inference key can access models", async () => {
    const result = await runLiveDoctorChecks({
      env: { OG_INFERENCE_API_KEY: "sk-test" },
      fetchImpl: async (url, options) => {
        if (String(url).endsWith("/models")) {
          return {
            ok: true,
            async json() {
              return {
                object: "list",
                data: [
                  {
                    id: "example/allowed",
                    pricing: { prompt: "1", completion: "1" },
                    capabilities: { chat: true }
                  },
                  {
                    id: "example/denied",
                    pricing: { prompt: "2", completion: "2" },
                    capabilities: { chat: true }
                  }
                ]
              };
            }
          };
        }

        const body = JSON.parse(options.body);
        if (body.model === "example/denied") {
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

    const allowedCheck = result.checks.find((check) => check.name === "router_allowed_models");
    assert.equal(allowedCheck.ok, true);
    assert.match(allowedCheck.detail, /1 of 2 chat models allowed/);
    assert.deepEqual(result.allowedModels.map((model) => model.id), ["example/allowed"]);
  });
});
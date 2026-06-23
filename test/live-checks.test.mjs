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
    assert.equal(result.readyForProof, false);
  });
});
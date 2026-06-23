import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runMvpProof, saveProofReport, selectProofModels } from "../src/proof-run.mjs";

describe("Relay MVP proof run", () => {
  it("selects two distinct chat-capable models", () => {
    const selected = selectProofModels([
      { id: "zai/a", capabilities: { chat: true }, pricing: { prompt: "200" } },
      { id: "zai/b", capabilities: { chat: true }, pricing: { prompt: "100" } }
    ]);

    assert.equal(selected.modelA, "zai/b");
    assert.equal(selected.modelB, "zai/a");
  });

  it("prefers models allowed for the configured API key", () => {
    const models = [
      { id: "zai/cheap-denied", capabilities: { chat: true }, pricing: { prompt: "1" } },
      { id: "zai/allowed-a", capabilities: { chat: true }, pricing: { prompt: "100" } },
      { id: "zai/allowed-b", capabilities: { chat: true }, pricing: { prompt: "200" } }
    ];

    const selected = selectProofModels(models, {
      allowedModelIds: ["zai/allowed-a", "zai/allowed-b"]
    });

    assert.equal(selected.modelA, "zai/allowed-a");
    assert.equal(selected.modelB, "zai/allowed-b");
  });

  it("runs storage-skipped proof with mocked router calls", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-proof-test-"));
    let callCount = 0;

    const report = await runMvpProof({
      projectRoot,
      env: { OG_INFERENCE_API_KEY: "sk-proof" },
      modelA: "example/model-a",
      modelB: "example/model-b",
      skipStorage: true,
      liveChecks: async () => ({
        router: { hasInferenceKey: true, routerBaseUrl: "https://router-api.0g.ai/v1" },
        storage: null,
        models: [],
        checks: [
          { name: "router_inference_key", ok: true, detail: "configured" },
          { name: "router_catalog", ok: true, detail: "1 live models" }
        ],
        readyForProof: true
      }),
      fetchImpl: async (url) => {
        if (String(url).includes("/models")) {
          return {
            ok: true,
            async json() {
              return { object: "list", data: [] };
            }
          };
        }

        callCount += 1;
        return {
          ok: true,
          async json() {
            return buildCompletion(callCount === 1 ? "example/model-a" : "example/model-b");
          }
        };
      }
    });

    assert.equal(report.all_passed, true);
    assert.ok(report.token_proof.handoff_tokens >= 0);
    assert.equal(report.steps.find((step) => step.name === "model_b_switch").ok, true);
    assert.equal(report.storage, null);

    const savedPath = await saveProofReport(projectRoot, report);
    const saved = JSON.parse(await readFile(savedPath, "utf8"));
    assert.equal(saved.all_passed, true);
  });

  it("runs full proof including storage publish, fetch, and continuation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-proof-test-"));
    const rootHash = `0x${"a".repeat(64)}`;
    let publishedBytes = null;
    let routerCalls = 0;

    const report = await runMvpProof({
      projectRoot,
      env: {
        OG_INFERENCE_API_KEY: "sk-proof",
        OG_STORAGE_PRIVATE_KEY: "0x" + "1".repeat(64)
      },
      modelA: "example/model-a",
      modelB: "example/model-b",
      liveChecks: async () => ({
        router: { hasInferenceKey: true, routerBaseUrl: "https://router-api.0g.ai/v1" },
        storage: { hasPrivateKey: true, network: "testnet", mode: "turbo" },
        models: [],
        checks: [
          { name: "router_inference_key", ok: true, detail: "configured" },
          { name: "router_catalog", ok: true, detail: "1 live models" },
          { name: "storage_private_key", ok: true, detail: "configured" },
          { name: "storage_wallet_balance", ok: true, detail: "funded" }
        ],
        readyForProof: true
      }),
      fetchImpl: async (url) => {
        if (String(url).includes("/models")) {
          return { ok: true, async json() { return { object: "list", data: [] }; } };
        }

        routerCalls += 1;
        return {
          ok: true,
          async json() {
            const model = routerCalls <= 1
              ? "example/model-a"
              : "example/model-b";
            return buildCompletion(model, routerCalls);
          }
        };
      },
      storageDeps: {
        uploadEncryptedBytes: async ({ bytes }) => {
          publishedBytes = bytes;
          return { rootHash, txHash: "0xtx_proof" };
        },
        peekEncryptionHeader: async () => ({ version: 1 }),
        downloadEncryptedBytes: async () => publishedBytes
      }
    });

    assert.equal(report.all_passed, true);
    assert.equal(report.storage.root_hash, rootHash);
    assert.equal(report.steps.find((step) => step.name === "storage_publish").ok, true);
    assert.equal(report.steps.find((step) => step.name === "storage_fetch").ok, true);
    assert.equal(report.steps.find((step) => step.name === "continue_from_fetched").ok, true);

    assert.ok(publishedBytes);
    assert.equal(JSON.parse(publishedBytes.toString()).schema, "relay.capsule-bundle.v1");
  });
});

function buildCompletion(model, sequence = 1) {
  return {
    id: `chatcmpl_${sequence}`,
    model,
    choices: [{ message: { role: "assistant", content: `Response from ${model}` } }],
    usage: { prompt_tokens: 100, completion_tokens: 40 },
    x_0g_trace: {
      request_id: `req_${sequence}`,
      provider: "0x0000000000000000000000000000000000000000",
      billing: { total_cost: "10" }
    }
  };
}
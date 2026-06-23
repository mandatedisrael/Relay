import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveCapsule } from "../src/local-store.mjs";
import { handoffTaskToTarget } from "../src/handoff-to.mjs";

describe("Relay handoff to target", () => {
  it("publishes portable memory and writes a Codex handoff file", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-handoff-test-"));
    await saveCapsule(projectRoot, sampleCapsule());

    const result = await handoffTaskToTarget({
      projectRoot,
      targetName: "claude-code",
      events: [],
      handoffOnly: true,
      env: {
        OG_STORAGE_PRIVATE_KEY: "0x" + "3".repeat(64),
        OG_STORAGE_NETWORK: "testnet"
      },
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      hasInferenceKey: true,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/models")) {
          return {
            ok: true,
            async json() {
              return {
                object: "list",
                data: [{
                  id: "glm-5.1",
                  pricing: { prompt: "1", completion: "1" },
                  capabilities: { chat: true }
                }]
              };
            }
          };
        }

        return {
          ok: false,
          async json() {
            return { error: { message: "model not allowed" } };
          }
        };
      },
      storageDeps: {
        uploadEncryptedBytes: async () => ({
          rootHash: `0x${"b".repeat(64)}`,
          txHash: "0xhandoff_tx"
        })
      }
    });

    assert.match(result.publishResult.relayUrl, /relay:\/\/0g-storage\/testnet\//);
    assert.match(result.exportResult.body, /Relay portable handoff/);
    assert.match(result.exportResult.body, /relay capsule fetch/);

    const handoffFile = await readFile(result.exportResult.targetFile, "utf8");
    assert.match(handoffFile, /Claude Code/);

    const latest = await stat(join(projectRoot, ".relay", "handoffs", "latest.md"));
    assert.equal(latest.isFile(), true);
  });
});

function sampleCapsule() {
  return {
    schema: "relay.context.v1",
    capsule_id: "ctx_handoff_001",
    parent_capsule_id: null,
    created_at: "2026-06-23T12:00:00.000Z",
    task: { goal: "Fix checkout session bug" },
    state: {
      status: "in_progress",
      next_action: "Patch checkout/session.ts",
      blockers: []
    },
    facts: [{
      id: "fact_001",
      text: "Refresh token expiry reproduces the failure",
      truth_state: "observed",
      evidence: ["ev_001"]
    }],
    claims: [],
    decisions: [],
    evidence: [{
      id: "ev_001",
      kind: "model_output",
      source_event: "evt_001",
      hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }],
    model_trace: [],
    routing: { last_model: "claude-code", recommended_next_step: "review", recommended_mode: "compact" },
    storage: {}
  };
}
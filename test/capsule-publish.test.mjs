import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { publishCapsuleBundle } from "../src/capsule-publish.mjs";
import { readPublishKey } from "../src/publish-keys.mjs";
import { parseCapsuleBundle } from "../src/capsule-bundle.mjs";

describe("Relay capsule publish", () => {
  it("publishes an encrypted bundle and stores local publish metadata", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-publish-test-"));
    const rootHash = `0x${"b".repeat(64)}`;
    const capsule = sampleCapsule();
    const events = [sampleEvent()];

    const result = await publishCapsuleBundle({
      projectRoot,
      capsule,
      events,
      mode: "standard",
      storageConfig: {
        network: "testnet",
        mode: "turbo",
        evmRpcUrl: "https://evmrpc-testnet.0g.ai",
        indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
        privateKey: "0x" + "1".repeat(64),
        hasPrivateKey: true
      },
      encryptionKey: Buffer.alloc(32, 7),
      deps: {
        uploadEncryptedBytes: async ({ bytes }) => {
          const bundle = parseCapsuleBundle(bytes);
          assert.equal(bundle.capsule.capsule_id, capsule.capsule_id);
          return {
            rootHash,
            txHash: "0xtx_publish_001"
          };
        }
      }
    });

    assert.equal(result.upload.rootHash, rootHash);
    assert.match(result.relayUrl, /relay:\/\/0g-storage\/testnet\//);
    assert.equal(result.updatedCapsule.storage.root_hash, rootHash);
    assert.equal(result.updatedCapsule.storage.encryption, "aes256");

    const savedKey = await readPublishKey(projectRoot, rootHash);
    assert.equal(savedKey.key_hex, result.keyHex);
    assert.equal(savedKey.capsule_id, capsule.capsule_id);
  });
});

function sampleCapsule() {
  return {
    schema: "relay.context.v1",
    capsule_id: "ctx_publish_001",
    parent_capsule_id: null,
    created_at: "2026-06-23T10:01:00.000Z",
    task: { goal: "Publish this capsule" },
    state: {
      status: "in_progress",
      next_action: "Continue",
      blockers: []
    },
    facts: [],
    claims: [],
    decisions: [],
    evidence: [
      {
        id: "ev_001",
        kind: "model_output",
        source_event: "evt_publish_001",
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ],
    model_trace: [],
    routing: {
      last_model: "example/model-a",
      recommended_next_step: "review",
      recommended_mode: "standard"
    },
    storage: {}
  };
}

function sampleEvent() {
  return {
    schema: "relay.event.v1",
    event_id: "evt_publish_001",
    timestamp: "2026-06-23T10:01:00.000Z",
    kind: "model.response",
    source: {
      runtime: "0g-router",
      model_id: "example/model-a",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "req_publish_001"
    },
    payload: {
      prompt: "Start task",
      response: "Acknowledged"
    },
    content_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  };
}
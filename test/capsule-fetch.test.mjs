import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCapsuleBundle,
  serializeCapsuleBundle
} from "../src/capsule-bundle.mjs";
import { fetchCapsuleBundle, importCapsuleBundle } from "../src/capsule-fetch.mjs";
import { savePublishKey } from "../src/publish-keys.mjs";
import { readCapsule } from "../src/local-store.mjs";

describe("Relay capsule fetch", () => {
  it("fetches, decrypts, validates, and imports a published bundle", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-fetch-test-"));
    const rootHash = `0x${"c".repeat(64)}`;
    const keyHex = `0x${"d".repeat(64)}`;
    const capsule = sampleCapsule();
    const bundle = buildCapsuleBundle({
      capsule,
      events: [sampleEvent()],
      traces: [],
      handoff: "# Relay Context Capsule"
    });
    const bundleBytes = serializeCapsuleBundle(bundle);

    await savePublishKey(projectRoot, {
      root_hash: rootHash,
      encryption: "aes256",
      key_hex: keyHex,
      network: "testnet",
      mode: "turbo",
      relay_url: `relay://0g-storage/testnet/${rootHash}`,
      capsule_id: capsule.capsule_id
    });

    const fetched = await fetchCapsuleBundle({
      projectRoot,
      reference: `relay://0g-storage/testnet/${rootHash}`,
      storageConfig: {
        network: "testnet",
        mode: "turbo",
        evmRpcUrl: "https://evmrpc-testnet.0g.ai",
        indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
        privateKey: "",
        hasPrivateKey: false
      },
      deps: {
        peekEncryptionHeader: async () => ({ version: 1 }),
        downloadEncryptedBytes: async () => bundleBytes
      }
    });

    assert.equal(fetched.rootHash, rootHash);
    assert.equal(fetched.bundle.capsule.capsule_id, capsule.capsule_id);
    assert.equal(fetched.proofVerified, true);

    const imported = await importCapsuleBundle(projectRoot, fetched.bundle);
    const localCapsule = await readCapsule(projectRoot, capsule.capsule_id);

    assert.equal(imported.eventRecords.length, 1);
    assert.equal(localCapsule.payload.capsule_id, capsule.capsule_id);
  });
});

function sampleCapsule() {
  return {
    schema: "relay.context.v1",
    capsule_id: "ctx_fetch_001",
    parent_capsule_id: null,
    created_at: "2026-06-23T10:01:00.000Z",
    task: { goal: "Fetch this capsule" },
    state: {
      status: "in_progress",
      next_action: "Continue",
      blockers: []
    },
    facts: [],
    claims: [],
    decisions: [],
    evidence: [],
    model_trace: [],
    routing: {
      last_model: null,
      recommended_next_step: "review",
      recommended_mode: "standard"
    },
    storage: {}
  };
}

function sampleEvent() {
  return {
    schema: "relay.event.v1",
    event_id: "evt_fetch_001",
    timestamp: "2026-06-23T10:01:00.000Z",
    kind: "model.response",
    source: {
      runtime: "0g-router",
      model_id: "example/model-a",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "req_fetch_001"
    },
    payload: {
      prompt: "hello",
      response: "world"
    },
    content_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  };
}
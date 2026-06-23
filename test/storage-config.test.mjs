import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRelayStorageUrl,
  loadStorageConfig,
  parseRelayStorageReference
} from "../src/storage-config.mjs";

describe("Relay storage config", () => {
  it("loads mainnet turbo defaults", () => {
    const config = loadStorageConfig({});
    assert.equal(config.network, "mainnet");
    assert.equal(config.mode, "turbo");
    assert.equal(config.evmRpcUrl, "https://evmrpc.0g.ai");
    assert.equal(config.indexerUrl, "https://indexer-storage-turbo.0g.ai");
    assert.equal(config.hasPrivateKey, false);
  });

  it("builds and parses relay storage URLs", () => {
    const rootHash = `0x${"a".repeat(64)}`;
    const relayUrl = buildRelayStorageUrl("testnet", rootHash);
    const parsed = parseRelayStorageReference(relayUrl);

    assert.equal(parsed.network, "testnet");
    assert.equal(parsed.rootHash, rootHash);
    assert.deepEqual(parseRelayStorageReference(rootHash), {
      network: null,
      rootHash
    });
  });
});
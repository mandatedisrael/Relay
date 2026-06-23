import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildCapsuleBundle,
  parseCapsuleBundle,
  serializeCapsuleBundle,
  validateCapsuleBundle
} from "../src/capsule-bundle.mjs";

async function readFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Relay capsule bundle", () => {
  it("builds a publishable bundle with manifest metadata", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const event = await readFixture("protocol/fixtures/valid-event.json");

    const bundle = buildCapsuleBundle({
      capsule,
      events: [event],
      traces: capsule.model_trace,
      handoff: "# Relay Context Capsule\n\n## Goal\nFix checkout failure"
    });

    assert.equal(bundle.schema, "relay.capsule-bundle.v1");
    assert.equal(bundle.manifest.capsule_id, capsule.capsule_id);
    assert.ok(bundle.manifest.content_hash.startsWith("sha256:"));
    assert.equal(validateCapsuleBundle(bundle).ok, true);
  });

  it("redacts obvious secret patterns before publishing", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const event = {
      ...(await readFixture("protocol/fixtures/valid-event.json")),
      payload: {
        prompt: "Use sk-live-secret-key-1234567890",
        response: "Done"
      }
    };

    const bundle = buildCapsuleBundle({
      capsule,
      events: [event],
      traces: [],
      handoff: "key OG_INFERENCE_API_KEY=sk-hidden"
    });

    assert.match(bundle.events[0].payload.prompt, /\[REDACTED\]/);
    assert.doesNotMatch(bundle.events[0].payload.prompt, /sk-live-secret-key/);
    assert.match(bundle.handoff, /\[REDACTED\]/);
  });

  it("round-trips bundle serialization and rejects tampering", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const bundle = buildCapsuleBundle({
      capsule,
      events: [],
      traces: [],
      handoff: "handoff"
    });

    const parsed = parseCapsuleBundle(serializeCapsuleBundle(bundle));
    assert.equal(parsed.manifest.content_hash, bundle.manifest.content_hash);

    parsed.capsule.task.goal = "Tampered";
    const validation = validateCapsuleBundle(parsed);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(" "), /content_hash does not match/);
  });
});
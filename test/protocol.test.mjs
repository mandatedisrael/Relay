import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  CONTEXT_MODES,
  TRUTH_STATES,
  validateCapsule,
  validateEvent,
  validateView
} from "../src/protocol.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Relay protocol validation", () => {
  it("defines the MVP truth states", () => {
    assert.deepEqual(TRUTH_STATES, [
      "observed",
      "verified",
      "claimed",
      "planned",
      "failed",
      "blocked",
      "stale"
    ]);
  });

  it("defines the MVP context modes", () => {
    assert.deepEqual(CONTEXT_MODES, [
      "compact",
      "standard",
      "deep"
    ]);
  });

  it("accepts a valid event fixture", async () => {
    const event = await readJson("protocol/fixtures/valid-event.json");

    assert.deepEqual(validateEvent(event), {
      ok: true,
      errors: []
    });
  });

  it("accepts a valid capsule fixture", async () => {
    const capsule = await readJson("protocol/fixtures/valid-capsule.json");

    assert.deepEqual(validateCapsule(capsule), {
      ok: true,
      errors: []
    });
  });

  it("rejects verified facts without evidence", async () => {
    const capsule = await readJson("protocol/fixtures/invalid-capsule-missing-evidence.json");
    const result = validateCapsule(capsule);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /verified but has no evidence/);
  });

  it("accepts a valid context view fixture", async () => {
    const view = await readJson("protocol/fixtures/valid-view.json");

    assert.deepEqual(validateView(view), {
      ok: true,
      errors: []
    });
  });
});

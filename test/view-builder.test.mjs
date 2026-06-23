import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildContextView, resolveRelatedEvents } from "../src/view-builder.mjs";
import { validateView } from "../src/protocol.mjs";

async function readFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Relay view builder", () => {
  it("builds a valid compact view from a capsule", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const events = [await readFixture("protocol/fixtures/valid-event.json")];

    const result = buildContextView({ capsule, mode: "compact", events });

    assert.equal(result.view.schema, "relay.view.v1");
    assert.equal(result.view.mode, "compact");
    assert.equal(result.view.source_capsule_id, capsule.capsule_id);
    assert.ok(result.view.estimated_tokens > 0);
    assert.ok(result.view.sections.includes("goal"));
    assert.ok(result.view.sections.includes("verified_facts"));
    assert.equal(validateView(result.view).ok, true);
    assert.match(result.handoff, /Fix checkout failure/);
    assert.match(result.handoff, /checkout\.test\.ts fails before the fix/);
  });

  it("includes more sections in standard and deep modes", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const events = [await readFixture("protocol/fixtures/valid-event.json")];

    const compact = buildContextView({ capsule, mode: "compact", events });
    const standard = buildContextView({ capsule, mode: "standard", events });
    const deep = buildContextView({ capsule, mode: "deep", events });

    assert.ok(standard.view.sections.length > compact.view.sections.length);
    assert.ok(deep.view.sections.length > standard.view.sections.length);
    assert.ok(standard.view.sections.includes("claimed_unverified"));
    assert.ok(deep.view.sections.includes("task_history"));
    assert.match(standard.handoff, /Claims \(Unverified\)/);
  });

  it("estimates lower handoff tokens than full event history for multi-step transcripts", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const baseEvent = await readFixture("protocol/fixtures/valid-event.json");
    const longPrompt = "Please continue debugging checkout with a much longer prompt that would normally bloat the transcript. ".repeat(8);
    const longResponse = "Here is a much longer model response that includes many details about checkout/session.ts, token refresh handling, middleware ordering, and test failures that should inflate the full-history estimate. ".repeat(8);
    const events = [
      {
        ...baseEvent,
        payload: {
          prompt: longPrompt,
          response: longResponse
        }
      },
      {
        ...baseEvent,
        event_id: "evt_router_response_002",
        timestamp: "2026-06-23T10:02:00.000Z",
        payload: {
          prompt: longPrompt,
          response: longResponse
        }
      }
    ];
    capsule.evidence.push({
      id: "ev_002",
      kind: "model_output",
      source_event: "evt_router_response_002",
      hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    });

    const result = buildContextView({ capsule, mode: "compact", events });

    assert.ok(result.estimates.viewTokens > 0);
    assert.ok(result.estimates.fullHistoryTokens > result.estimates.viewTokens);
    assert.ok(result.estimates.reductionPercent > 0);
  });

  it("renders failed attempts and open alternatives when present", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    capsule.facts.push({
      id: "fact_failed",
      text: "Patching only session.ts did not fix the test",
      truth_state: "failed",
      evidence: []
    });
    capsule.claims.push({
      id: "claim_planned",
      text: "Try refreshing tokens in middleware instead",
      truth_state: "planned",
      evidence: []
    });

    const deep = buildContextView({ capsule, mode: "deep", events: [] });

    assert.match(deep.handoff, /Failed Attempts/);
    assert.match(deep.handoff, /Patching only session\.ts did not fix the test/);
    assert.match(deep.handoff, /Open Alternatives/);
    assert.match(deep.handoff, /Try refreshing tokens in middleware instead/);
  });

  it("resolves only capsule-referenced events when evidence is present", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const referenced = await readFixture("protocol/fixtures/valid-event.json");
    const unrelated = {
      ...referenced,
      event_id: "evt_unrelated",
      timestamp: "2026-06-23T09:00:00.000Z"
    };

    const resolved = resolveRelatedEvents(capsule, [referenced, unrelated]);

    assert.deepEqual(resolved.map((event) => event.event_id), [referenced.event_id]);
  });

  it("rejects invalid modes", async () => {
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");

    assert.throws(
      () => buildContextView({ capsule, mode: "tiny", events: [] }),
      /Invalid context mode/
    );
  });
});
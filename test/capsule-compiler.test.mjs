import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInitialCapsule } from "../src/capsule-compiler.mjs";
import { validateCapsule } from "../src/protocol.mjs";

describe("Relay capsule compiler", () => {
  it("creates a valid initial capsule from a model response event", () => {
    const event = buildSampleEvent("Test the checkout flow");

    const capsule = createInitialCapsule({ goal: "Fix checkout bug", event });

    const validation = validateCapsule(capsule);
    assert.equal(validation.ok, true, `validation errors: ${validation.errors?.join(", ")}`);

    assert.equal(capsule.schema, "relay.context.v1");
    assert.ok(capsule.capsule_id.startsWith("ctx_"));
    assert.equal(capsule.task.goal, "Fix checkout bug");
    assert.equal(capsule.state.status, "in_progress");
    assert.equal(capsule.facts.length, 1);
    assert.equal(capsule.facts[0].truth_state, "observed");
    assert.equal(capsule.evidence.length, 1);
    assert.equal(capsule.model_trace.length, 1);
    assert.equal(capsule.routing.recommended_mode, "standard");
  });

  it("falls back to a default goal when none is provided", () => {
    const event = buildSampleEvent();

    const capsule = createInitialCapsule({ event });

    assert.equal(capsule.task.goal, "Interactive ask session");
  });

  it("produces evidence and model_trace that match the source event", () => {
    const event = buildSampleEvent();

    const capsule = createInitialCapsule({ goal: "Anything", event });

    assert.equal(capsule.evidence[0].source_event, event.event_id);
    assert.equal(capsule.model_trace[0].model_id, event.source.model_id);
    assert.equal(capsule.model_trace[0].request_id, event.trace.request_id);
  });

  it("handles events without full trace gracefully", () => {
    const minimalEvent = {
      event_id: "evt_minimal",
      payload: { prompt: "x", response: "y" },
      content_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      source: { model_id: "m" }
    };

    const capsule = createInitialCapsule({ goal: "Minimal", event: minimalEvent });

    const validation = validateCapsule(capsule);
    assert.equal(validation.ok, true);
    assert.equal(capsule.model_trace.length, 0);
  });
});

function buildSampleEvent(prompt = "hello") {
  return {
    schema: "relay.event.v1",
    event_id: "evt_sample_001",
    timestamp: new Date().toISOString(),
    kind: "model.response",
    source: {
      runtime: "0g-router",
      model_id: "example/model",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "sample_001"
    },
    trace: {
      model_id: "example/model",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "sample_001",
      input_tokens: 12,
      output_tokens: 7,
      billing: {
        currency: "neuron",
        input_cost: "10",
        output_cost: "20",
        total_cost: "30"
      },
      tee_verified: null
    },
    payload: {
      prompt,
      response: "Here is a helpful response from the model about the task."
    },
    content_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  };
}

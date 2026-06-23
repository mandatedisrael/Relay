import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildModelResponseEvent } from "../src/events.mjs";
import { validateEvent } from "../src/protocol.mjs";

describe("Relay event builders", () => {
  it("builds valid model response events from Router completions", () => {
    const event = buildModelResponseEvent({
      prompt: "hello",
      completion: {
        id: "chatcmpl_001",
        model: "example/model",
        content: "hello from 0G",
        usage: {
          inputTokens: 10,
          outputTokens: 5
        },
        trace: {
          requestId: "req_001",
          provider: "0x0000000000000000000000000000000000000000",
          billing: {
            inputCost: "100",
            outputCost: "200",
            totalCost: "300"
          },
          teeVerified: true
        }
      }
    });

    assert.equal(event.event_id, "evt_req_001");
    assert.equal(event.source.runtime, "0g-router");
    assert.equal(event.trace.billing.total_cost, "300");
    assert.equal(validateEvent(event).ok, true);
  });
});

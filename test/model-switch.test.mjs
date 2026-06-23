import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { createInitialCapsule } from "../src/capsule-compiler.mjs";
import {
  messagesIncludeTranscript,
  prepareModelSwitch,
  runModelSwitch
} from "../src/model-switch.mjs";
import { validateCapsule } from "../src/protocol.mjs";

async function readFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Relay model switch", () => {
  it("prepares transcript-independent continuation messages", async () => {
    const event = buildSampleEvent();
    const capsule = createInitialCapsule({ goal: "Fix checkout bug", event });
    const priorTranscript = [
      event,
      {
        ...event,
        event_id: "evt_prior_step",
        payload: {
          prompt: "This prior transcript prompt must not be replayed to the target model.",
          response: "This prior transcript response must not be replayed to the target model."
        }
      }
    ];

    const prepared = prepareModelSwitch({
      capsule,
      mode: "standard",
      events: priorTranscript,
      instruction: "Continue debugging checkout"
    });

    assert.equal(prepared.messages.length, 2);
    assert.match(prepared.continuationPrompt, /Fix checkout bug/);
    assert.match(prepared.continuationPrompt, /Continue debugging checkout/);
    assert.equal(
      messagesIncludeTranscript(prepared.messages, priorTranscript, capsule),
      false
    );
  });

  it("runs a model switch, updates the capsule, and records handoff metadata", async () => {
    const event = await readFixture("protocol/fixtures/valid-event.json");
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");

    const result = await runModelSwitch({
      capsule,
      mode: "compact",
      events: [event],
      model: "example/model-b",
      instruction: "Continue from the capsule",
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            id: "chatcmpl_switch_001",
            model: "example/model-b",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "I will patch checkout/session.ts and rerun checkout.test.ts."
                }
              }
            ],
            usage: {
              prompt_tokens: 900,
              completion_tokens: 120
            },
            x_0g_trace: {
              request_id: "req_switch_001",
              provider: "0x0000000000000000000000000000000000000001",
              billing: {
                input_cost: "10",
                output_cost: "20",
                total_cost: "30"
              }
            }
          };
        }
      })
    });

    assert.match(result.completion.content, /patch checkout\/session\.ts/);
    assert.equal(result.event.payload.handoff.transcript_independent, true);
    assert.equal(result.event.payload.handoff.view_mode, "compact");
    assert.equal(result.updatedCapsule.capsule_id, capsule.capsule_id);
    assert.equal(result.updatedCapsule.model_trace.length, 2);
    assert.equal(validateCapsule(result.updatedCapsule).ok, true);
    assert.equal(messagesIncludeTranscript(result.messages, [event], capsule), false);
  });
});

function buildSampleEvent() {
  return {
    schema: "relay.event.v1",
    event_id: "evt_sample_001",
    timestamp: new Date().toISOString(),
    kind: "model.response",
    source: {
      runtime: "0g-router",
      model_id: "example/model-a",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "sample_001"
    },
    trace: {
      model_id: "example/model-a",
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
      prompt: "hello",
      response: "Here is a helpful response from the model about the task."
    },
    content_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222"
  };
}
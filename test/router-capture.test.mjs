import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareProxiedChatRequest } from "../src/router-capture.mjs";

describe("Relay router capture", () => {
  it("replaces client transcript with a capsule handoff when transcript independence is enabled", () => {
    const prepared = prepareProxiedChatRequest({
      messages: [
        { role: "user", content: "message one" },
        { role: "assistant", content: "reply one" },
        { role: "user", content: "message two" }
      ],
      handoff: "# Relay Context Capsule\nGoal: Fix checkout",
      transcriptIndependent: true
    });

    assert.equal(prepared.messages.length, 2);
    assert.equal(prepared.messages[0].role, "system");
    assert.match(prepared.messages[1].content, /message two/);
    assert.match(prepared.messages[1].content, /Fix checkout/);
  });

  it("passes messages through unchanged when no handoff is available", () => {
    const messages = [{ role: "user", content: "hello" }];
    const prepared = prepareProxiedChatRequest({
      messages,
      handoff: null
    });

    assert.deepEqual(prepared.messages, messages);
  });
});
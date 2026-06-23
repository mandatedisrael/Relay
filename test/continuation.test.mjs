import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RELAY_CONTINUATION_SYSTEM_PROMPT,
  buildContinuationMessages,
  buildContinuationPrompt
} from "../src/continuation.mjs";

describe("Relay continuation prompt", () => {
  it("builds the documented system and user messages", () => {
    const messages = buildContinuationMessages({
      handoff: "# Relay Context Capsule\n\n## Goal\nFix checkout",
      instruction: "Patch checkout/session.ts next"
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "system");
    assert.equal(messages[0].content, RELAY_CONTINUATION_SYSTEM_PROMPT);
    assert.match(messages[1].content, /Fix checkout/);
    assert.match(messages[1].content, /Patch checkout\/session\.ts next/);
  });

  it("falls back to a default continuation instruction", () => {
    const prompt = buildContinuationPrompt({
      handoff: "# Relay Context Capsule"
    });

    assert.match(prompt, /Continue the task based on the capsule above/);
  });

  it("rejects empty handoff content", () => {
    assert.throws(
      () => buildContinuationPrompt({ handoff: "   " }),
      /non-empty capsule handoff/
    );
  });
});
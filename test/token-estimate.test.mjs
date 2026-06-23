import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokens, estimateTokensFromValue } from "../src/token-estimate.mjs";

describe("Relay token estimation", () => {
  it("returns zero for empty text", () => {
    assert.equal(estimateTokens(""), 0);
  });

  it("uses a chars/4 heuristic for non-empty text", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcdefgh"), 2);
  });

  it("estimates tokens from structured values", () => {
    assert.ok(estimateTokensFromValue({ goal: "Fix checkout" }) > 0);
  });
});
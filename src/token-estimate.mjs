/**
 * Rough token estimate for English-ish text using the common chars/4 heuristic.
 * Relay uses this for handoff previews until Router tokenizer metadata is wired in.
 */
export function estimateTokens(text) {
  if (typeof text !== "string" || text.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensFromValue(value) {
  if (typeof value === "string") {
    return estimateTokens(value);
  }

  return estimateTokens(JSON.stringify(value));
}
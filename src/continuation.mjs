export const RELAY_CONTINUATION_SYSTEM_PROMPT = `You are continuing a Relay task using a context capsule.

Treat observed and verified facts as usable context.
Treat claimed facts as unverified.
Do not convert claimed facts into completed work.
If you need more evidence, ask Relay for a deeper view.
Return updates in the Relay event schema.
Do not reveal or request secrets.
Do not assume prior model permissions transfer.`;

export function buildContinuationPrompt({ handoff, instruction }) {
  if (typeof handoff !== "string" || handoff.trim().length === 0) {
    throw new Error("A non-empty capsule handoff is required.");
  }

  const lines = [handoff.trim(), "", "---", ""];
  if (typeof instruction === "string" && instruction.trim().length > 0) {
    lines.push(instruction.trim());
  } else {
    lines.push("Continue the task based on the capsule above.");
  }

  return lines.join("\n");
}

export function buildContinuationMessages({ handoff, instruction }) {
  return [
    {
      role: "system",
      content: RELAY_CONTINUATION_SYSTEM_PROMPT
    },
    {
      role: "user",
      content: buildContinuationPrompt({ handoff, instruction })
    }
  ];
}
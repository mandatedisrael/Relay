import { canonicalJson, sha256Digest } from "./hash.mjs";

export function createInitialCapsule({ goal, event }) {
  const now = new Date().toISOString();
  const base = event?.event_id ? event.event_id.replace(/^evt_/, "") : String(Date.now());
  const capsuleId = `ctx_${sanitizeForId(base)}`;

  const evId = `ev_${sanitizeForId(base)}`;
  const factId = `fact_${sanitizeForId(base)}`;

  const prompt = event?.payload?.prompt ?? "";
  const response = event?.payload?.response ?? event?.payload?.text ?? "";
  const modelId = event?.source?.model_id ?? event?.trace?.model_id ?? null;
  const provider = event?.source?.provider ?? event?.trace?.provider ?? null;
  const requestId = event?.source?.request_id ?? event?.trace?.request_id ?? null;

  const evidenceHash = event?.content_hash ?? sha256Digest(canonicalJson({ prompt, response }));

  const facts = response
    ? [
        {
          id: factId,
          text: truncateForFact(response),
          truth_state: "observed",
          evidence: [evId]
        }
      ]
    : [];

  const traceEntry = buildModelTrace(event?.trace, modelId, provider, requestId);

  const capsule = {
    schema: "relay.context.v1",
    capsule_id: capsuleId,
    parent_capsule_id: null,
    created_at: now,
    task: {
      goal: typeof goal === "string" && goal.trim() ? goal.trim() : "Interactive ask session"
    },
    state: {
      status: "in_progress",
      next_action: response ? "Review model response and decide next action" : "Continue the task",
      blockers: []
    },
    facts,
    claims: [],
    decisions: [],
    evidence: [
      {
        id: evId,
        kind: "model_output",
        source_event: event?.event_id ?? "evt_unknown",
        hash: evidenceHash
      }
    ],
    model_trace: (traceEntry && traceEntry.model_id && traceEntry.provider && traceEntry.request_id) ? [traceEntry] : [],
    routing: {
      last_model: modelId,
      recommended_next_step: "review",
      recommended_mode: "standard"
    },
    storage: {}
  };

  return capsule;
}

function buildModelTrace(trace, modelId, provider, requestId) {
  if (!trace && !modelId) return null;

  return {
    model_id: modelId ?? trace?.model_id ?? "",
    provider: provider ?? trace?.provider ?? "",
    request_id: requestId ?? trace?.request_id ?? "",
    input_tokens: trace?.input_tokens ?? 0,
    output_tokens: trace?.output_tokens ?? 0,
    billing: {
      currency: trace?.billing?.currency ?? "neuron",
      input_cost: trace?.billing?.input_cost ?? "0",
      output_cost: trace?.billing?.output_cost ?? "0",
      total_cost: trace?.billing?.total_cost ?? "0"
    },
    tee_verified: typeof trace?.tee_verified === "boolean" ? trace.tee_verified : null
  };
}

function sanitizeForId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

function truncateForFact(text) {
  const cleaned = String(text).replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned;
  return cleaned.slice(0, 177) + "...";
}

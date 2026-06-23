import { estimateTokens } from "./token-estimate.mjs";
import { CONTEXT_MODES, validateView } from "./protocol.mjs";

const MODE_SECTIONS = Object.freeze({
  compact: [
    "goal",
    "current_state",
    "verified_facts",
    "blockers",
    "next_action",
    "model_trace"
  ],
  standard: [
    "goal",
    "current_state",
    "verified_facts",
    "blockers",
    "next_action",
    "model_trace",
    "decisions",
    "claimed_unverified",
    "failed_attempts",
    "evidence_excerpts"
  ],
  deep: [
    "goal",
    "current_state",
    "verified_facts",
    "blockers",
    "next_action",
    "model_trace",
    "decisions",
    "claimed_unverified",
    "failed_attempts",
    "evidence_excerpts",
    "model_output_excerpts",
    "rejected_hypotheses",
    "open_alternatives",
    "task_history"
  ]
});

export function buildContextView({ capsule, mode, events = [] }) {
  if (!capsule || typeof capsule !== "object") {
    throw new Error("A Context Capsule is required to build a view.");
  }

  if (!CONTEXT_MODES.includes(mode)) {
    throw new Error(`Invalid context mode "${mode}". Expected one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  const sections = MODE_SECTIONS[mode];
  const relatedEvents = resolveRelatedEvents(capsule, events);
  const handoff = renderHandoff({ capsule, mode, sections, events: relatedEvents });
  const viewTokens = estimateTokens(handoff);
  const fullHistoryTokens = estimateFullHistoryTokens(relatedEvents, capsule);
  const reductionPercent = computeReductionPercent(viewTokens, fullHistoryTokens);

  const view = {
    schema: "relay.view.v1",
    view_id: buildViewId(capsule.capsule_id, mode),
    source_capsule_id: capsule.capsule_id,
    mode,
    estimated_tokens: viewTokens,
    sections
  };

  const validation = validateView(view);
  if (!validation.ok) {
    throw new Error(`Built view failed validation: ${validation.errors.join("; ")}`);
  }

  return {
    view,
    handoff,
    estimates: {
      viewTokens,
      fullHistoryTokens,
      reductionPercent
    }
  };
}

export function resolveRelatedEvents(capsule, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const referencedIds = new Set();
  for (const item of capsule.evidence ?? []) {
    if (item?.source_event) {
      referencedIds.add(item.source_event);
    }
  }

  if (referencedIds.size === 0) {
    return events
      .map((entry) => normalizeEvent(entry))
      .filter(Boolean)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  return events
    .map((entry) => normalizeEvent(entry))
    .filter((event) => event && referencedIds.has(event.event_id))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function normalizeEvent(entry) {
  if (!entry) return null;
  if (entry.payload?.event_id) {
    return entry.payload;
  }
  if (entry.event_id) {
    return entry;
  }
  return null;
}

function renderHandoff({ capsule, mode, sections, events }) {
  const lines = [
    "# Relay Context Capsule",
    "",
    `Mode: ${mode}`,
    `Source: ${capsule.capsule_id}`,
    ""
  ];

  for (const section of sections) {
    const block = renderSection(section, capsule, mode, events);
    if (block) {
      lines.push(block, "");
    }
  }

  return lines.join("\n").trimEnd();
}

function renderSection(section, capsule, mode, events) {
  switch (section) {
    case "goal":
      return renderGoal(capsule);
    case "current_state":
      return renderCurrentState(capsule);
    case "verified_facts":
      return renderVerifiedFacts(capsule);
    case "blockers":
      return renderBlockers(capsule);
    case "next_action":
      return renderNextAction(capsule);
    case "model_trace":
      return renderModelTrace(capsule, mode);
    case "decisions":
      return renderDecisions(capsule);
    case "claimed_unverified":
      return renderClaims(capsule);
    case "failed_attempts":
      return renderFailedAttempts(capsule);
    case "evidence_excerpts":
      return renderEvidenceExcerpts(capsule, events, mode === "deep" ? "deep" : "standard");
    case "model_output_excerpts":
      return renderModelOutputExcerpts(events, mode);
    case "rejected_hypotheses":
      return renderRejectedHypotheses(capsule);
    case "open_alternatives":
      return renderOpenAlternatives(capsule);
    case "task_history":
      return renderTaskHistory(events);
    default:
      return null;
  }
}

function renderGoal(capsule) {
  const lines = ["## Goal", capsule.task.goal];
  if (Array.isArray(capsule.task.acceptance_criteria) && capsule.task.acceptance_criteria.length > 0) {
    lines.push("", "Acceptance criteria:");
    for (const criterion of capsule.task.acceptance_criteria) {
      lines.push(`- ${criterion}`);
    }
  }
  return lines.join("\n");
}

function renderCurrentState(capsule) {
  return ["## Current State", `Status: ${capsule.state.status}`].join("\n");
}

function renderVerifiedFacts(capsule) {
  const facts = (capsule.facts ?? []).filter((fact) =>
    fact.truth_state === "verified" || fact.truth_state === "observed"
  );
  if (facts.length === 0) {
    return null;
  }

  const lines = ["## Verified Facts"];
  for (const fact of facts) {
    lines.push(`- [${fact.truth_state}] ${fact.text}`);
  }
  return lines.join("\n");
}

function renderBlockers(capsule) {
  const blockers = capsule.state.blockers ?? [];
  if (blockers.length === 0) {
    return null;
  }

  const lines = ["## Blockers"];
  for (const blocker of blockers) {
    lines.push(`- ${formatBlocker(blocker)}`);
  }
  return lines.join("\n");
}

function renderNextAction(capsule) {
  const nextAction = capsule.state.next_action?.trim();
  if (!nextAction) {
    return null;
  }

  return ["## Next Action", nextAction].join("\n");
}

function renderModelTrace(capsule, mode) {
  const traces = capsule.model_trace ?? [];
  if (traces.length === 0) {
    return null;
  }

  const selected = mode === "compact" ? traces.slice(-1) : traces.slice(-3);
  const lines = ["## Model Trace"];

  for (const trace of selected) {
    if (mode === "compact") {
      lines.push(`- ${trace.model_id} (${trace.request_id})`);
      continue;
    }

    lines.push(
      `- ${trace.model_id} via ${shortenAddress(trace.provider)} | request ${trace.request_id} | in ${trace.input_tokens} / out ${trace.output_tokens} | cost ${trace.billing?.total_cost ?? "0"} ${trace.billing?.currency ?? "neuron"}`
    );
  }

  return lines.join("\n");
}

function renderDecisions(capsule) {
  const decisions = capsule.decisions ?? [];
  if (decisions.length === 0) {
    return null;
  }

  const lines = ["## Decisions"];
  for (const decision of decisions) {
    lines.push(`- ${formatDecision(decision)}`);
  }
  return lines.join("\n");
}

function renderClaims(capsule) {
  const claims = (capsule.claims ?? []).filter((claim) => claim.truth_state === "claimed");
  if (claims.length === 0) {
    return null;
  }

  const lines = ["## Claims (Unverified)"];
  for (const claim of claims) {
    lines.push(`- ${claim.text}`);
  }
  return lines.join("\n");
}

function renderFailedAttempts(capsule) {
  const failed = [
    ...(capsule.facts ?? []).filter((item) => item.truth_state === "failed"),
    ...(capsule.claims ?? []).filter((item) => item.truth_state === "failed")
  ];

  if (failed.length === 0) {
    return null;
  }

  const lines = ["## Failed Attempts"];
  for (const item of failed) {
    lines.push(`- ${item.text}`);
  }
  return lines.join("\n");
}

function renderEvidenceExcerpts(capsule, events, depth) {
  const evidence = capsule.evidence ?? [];
  if (evidence.length === 0) {
    return null;
  }

  const limit = depth === "deep" ? evidence.length : Math.min(evidence.length, 3);
  const lines = ["## Evidence Excerpts"];

  for (const item of evidence.slice(0, limit)) {
    const event = events.find((entry) => entry.event_id === item.source_event);
    const excerpt = event ? summarizeEventOutput(event, depth) : `source ${item.source_event} (${item.kind})`;
    lines.push(`- ${item.id}: ${excerpt}`);
  }

  return lines.join("\n");
}

function renderModelOutputExcerpts(events, mode) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const limit = mode === "deep" ? events.length : Math.min(events.length, 2);
  const lines = ["## Model Output Excerpts"];

  for (const event of events.slice(-limit)) {
    const prompt = event.payload?.prompt ?? "";
    const response = event.payload?.response ?? event.payload?.text ?? "";
    lines.push(`### ${event.event_id}`);
    if (prompt) {
      lines.push(`Prompt: ${truncateText(prompt, mode === "deep" ? 500 : 200)}`);
    }
    if (response) {
      lines.push(`Response: ${truncateText(response, mode === "deep" ? 1200 : 400)}`);
    }
  }

  return lines.join("\n");
}

function renderRejectedHypotheses(capsule) {
  const rejected = [
    ...(capsule.claims ?? []).filter((item) => item.truth_state === "failed" || item.truth_state === "stale"),
    ...(capsule.facts ?? []).filter((item) => item.truth_state === "stale")
  ];

  if (rejected.length === 0) {
    return null;
  }

  const lines = ["## Rejected Hypotheses"];
  for (const item of rejected) {
    lines.push(`- [${item.truth_state}] ${item.text}`);
  }
  return lines.join("\n");
}

function renderOpenAlternatives(capsule) {
  const alternatives = [
    ...(capsule.claims ?? []).filter((item) => item.truth_state === "planned"),
    ...(capsule.facts ?? []).filter((item) => item.truth_state === "planned")
  ];

  if (alternatives.length === 0) {
    return null;
  }

  const lines = ["## Open Alternatives"];
  for (const item of alternatives) {
    lines.push(`- ${item.text}`);
  }
  return lines.join("\n");
}

function renderTaskHistory(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const lines = ["## Task History"];
  for (const event of events) {
    const prompt = truncateText(event.payload?.prompt ?? "", 120);
    const response = truncateText(event.payload?.response ?? event.payload?.text ?? "", 240);
    lines.push(`- ${event.timestamp} | ${event.source?.model_id ?? "unknown model"} | prompt: ${prompt} | response: ${response}`);
  }
  return lines.join("\n");
}

function estimateFullHistoryTokens(events, capsule) {
  if (Array.isArray(events) && events.length > 0) {
    const transcript = events
      .map((event) => {
        const prompt = event.payload?.prompt ?? "";
        const response = event.payload?.response ?? event.payload?.text ?? "";
        return `User: ${prompt}\nAssistant: ${response}`;
      })
      .join("\n\n");
    return estimateTokens(transcript);
  }

  return estimateTokens(JSON.stringify(capsule));
}

function computeReductionPercent(viewTokens, fullHistoryTokens) {
  if (fullHistoryTokens <= 0) {
    return null;
  }

  if (viewTokens >= fullHistoryTokens) {
    return 0;
  }

  return Math.round((1 - viewTokens / fullHistoryTokens) * 100);
}

function buildViewId(capsuleId, mode) {
  const base = String(capsuleId).replace(/^ctx_/, "");
  return `view_${sanitizeForId(base)}_${mode}`;
}

function sanitizeForId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

function shortenAddress(value) {
  if (typeof value !== "string" || value.length <= 12) {
    return value ?? "unknown";
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatBlocker(blocker) {
  if (typeof blocker === "string") {
    return blocker;
  }
  if (blocker && typeof blocker.text === "string") {
    return blocker.text;
  }
  return JSON.stringify(blocker);
}

function formatDecision(decision) {
  if (typeof decision === "string") {
    return decision;
  }
  if (decision && typeof decision.text === "string") {
    return decision.text;
  }
  return JSON.stringify(decision);
}

function summarizeEventOutput(event, depth) {
  const response = event.payload?.response ?? event.payload?.text ?? "";
  const limit = depth === "deep" ? 300 : 120;
  return truncateText(response || `event ${event.event_id}`, limit);
}

function truncateText(text, limit) {
  const cleaned = String(text).replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) {
    return cleaned;
  }
  return `${cleaned.slice(0, limit - 3)}...`;
}
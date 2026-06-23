import { buildContextView } from "./view-builder.mjs";

export function countVerifiedFacts(capsule) {
  return capsule.facts.filter((fact) => fact.truth_state === "verified" || fact.truth_state === "observed").length;
}

export function buildTaskMemorySummary({
  capsule,
  events = [],
  mode = "compact",
  model = null,
  transcriptIndependent = null
}) {
  const viewResult = buildContextView({ capsule, mode, events });
  const lines = [
    "--- Relay task memory ---",
    `Goal: ${capsule.task.goal}`,
    `Status: ${capsule.state.status}`,
    `Next action: ${capsule.state.next_action || "None"}`,
    `Verified facts: ${countVerifiedFacts(capsule)}`,
    `Claims: ${capsule.claims.length}`,
    `Handoff (${mode}): ${formatTokenCount(viewResult.estimates.viewTokens)} tokens`,
    `Full transcript: ${formatTokenCount(viewResult.estimates.fullHistoryTokens)} tokens`
  ];

  if (viewResult.estimates.reductionPercent !== null) {
    lines.push(`Context saved vs transcript: ${viewResult.estimates.reductionPercent}%`);
  }

  if (model) {
    lines.push(`Active model: ${model}`);
  }

  if (transcriptIndependent !== null) {
    lines.push(`Transcript replay avoided: ${transcriptIndependent ? "yes" : "no"}`);
  }

  lines.push(
    `Capsule: ${capsule.capsule_id}`,
    "Switch models with: relay task continue --to <model-id> --mode compact"
  );

  return {
    text: lines.join("\n"),
    estimates: viewResult.estimates,
    view: viewResult.view
  };
}

function formatTokenCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}
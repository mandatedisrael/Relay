export const TRUTH_STATES = Object.freeze([
  "observed",
  "verified",
  "claimed",
  "planned",
  "failed",
  "blocked",
  "stale"
]);

export const CONTEXT_MODES = Object.freeze([
  "compact",
  "standard",
  "deep"
]);

export function validateEvent(event) {
  const errors = [];

  requireObject(event, "event", errors);
  if (errors.length > 0) return result(errors);

  requireEqual(event.schema, "relay.event.v1", "event.schema", errors);
  requireString(event.event_id, "event.event_id", errors);
  requireString(event.timestamp, "event.timestamp", errors);
  requireString(event.kind, "event.kind", errors);
  requireObject(event.source, "event.source", errors);
  requireObject(event.payload, "event.payload", errors);
  requireSha256(event.content_hash, "event.content_hash", errors);

  if (event.source) {
    requireString(event.source.runtime, "event.source.runtime", errors);
  }

  if (event.trace !== undefined) {
    validateModelTrace(event.trace, "event.trace", errors);
  }

  return result(errors);
}

export function validateCapsule(capsule) {
  const errors = [];

  requireObject(capsule, "capsule", errors);
  if (errors.length > 0) return result(errors);

  requireEqual(capsule.schema, "relay.context.v1", "capsule.schema", errors);
  requireString(capsule.capsule_id, "capsule.capsule_id", errors);
  requireString(capsule.created_at, "capsule.created_at", errors);
  requireObject(capsule.task, "capsule.task", errors);
  requireObject(capsule.state, "capsule.state", errors);
  requireArray(capsule.facts, "capsule.facts", errors);
  requireArray(capsule.claims, "capsule.claims", errors);
  requireArray(capsule.decisions, "capsule.decisions", errors);
  requireArray(capsule.evidence, "capsule.evidence", errors);
  requireArray(capsule.model_trace, "capsule.model_trace", errors);
  requireObject(capsule.routing, "capsule.routing", errors);

  if (capsule.task) {
    requireString(capsule.task.goal, "capsule.task.goal", errors);
  }

  if (capsule.state) {
    requireString(capsule.state.status, "capsule.state.status", errors);
    requireString(capsule.state.next_action, "capsule.state.next_action", errors);
    requireArray(capsule.state.blockers, "capsule.state.blockers", errors);
  }

  const evidenceIds = new Set();
  if (Array.isArray(capsule.evidence)) {
    for (const [index, evidence] of capsule.evidence.entries()) {
      validateEvidence(evidence, `capsule.evidence[${index}]`, errors);
      if (evidence?.id) evidenceIds.add(evidence.id);
    }
  }

  for (const section of ["facts", "claims", "decisions"]) {
    if (!Array.isArray(capsule[section])) continue;
    for (const [index, item] of capsule[section].entries()) {
      validateStateItem(item, `capsule.${section}[${index}]`, evidenceIds, errors);
    }
  }

  if (Array.isArray(capsule.state?.blockers)) {
    for (const [index, item] of capsule.state.blockers.entries()) {
      validateStateItem(item, `capsule.state.blockers[${index}]`, evidenceIds, errors);
    }
  }

  if (Array.isArray(capsule.model_trace)) {
    for (const [index, trace] of capsule.model_trace.entries()) {
      validateModelTrace(trace, `capsule.model_trace[${index}]`, errors);
    }
  }

  if (capsule.routing) {
    requireStringAllowNull(capsule.routing.last_model, "capsule.routing.last_model", errors);
    requireString(capsule.routing.recommended_next_step, "capsule.routing.recommended_next_step", errors);
    requireEnum(capsule.routing.recommended_mode, CONTEXT_MODES, "capsule.routing.recommended_mode", errors);
  }

  return result(errors);
}

export function validateView(view) {
  const errors = [];

  requireObject(view, "view", errors);
  if (errors.length > 0) return result(errors);

  requireEqual(view.schema, "relay.view.v1", "view.schema", errors);
  requireString(view.view_id, "view.view_id", errors);
  requireString(view.source_capsule_id, "view.source_capsule_id", errors);
  requireEnum(view.mode, CONTEXT_MODES, "view.mode", errors);
  requireNonNegativeInteger(view.estimated_tokens, "view.estimated_tokens", errors);
  requireArray(view.sections, "view.sections", errors);

  if (Array.isArray(view.sections) && view.sections.length === 0) {
    errors.push("view.sections must include at least one section.");
  }

  return result(errors);
}

function validateStateItem(item, path, evidenceIds, errors) {
  requireObject(item, path, errors);
  if (!item || typeof item !== "object") return;

  requireString(item.id, `${path}.id`, errors);
  requireString(item.text, `${path}.text`, errors);
  requireEnum(item.truth_state, TRUTH_STATES, `${path}.truth_state`, errors);
  requireArray(item.evidence, `${path}.evidence`, errors);

  if (item.truth_state === "verified" && Array.isArray(item.evidence) && item.evidence.length === 0) {
    errors.push(`${path} is verified but has no evidence.`);
  }

  if (Array.isArray(item.evidence)) {
    for (const evidenceId of item.evidence) {
      if (typeof evidenceId !== "string") {
        errors.push(`${path}.evidence must contain only strings.`);
      } else if (!evidenceIds.has(evidenceId)) {
        errors.push(`${path}.evidence references missing evidence "${evidenceId}".`);
      }
    }
  }
}

function validateEvidence(evidence, path, errors) {
  requireObject(evidence, path, errors);
  if (!evidence || typeof evidence !== "object") return;

  requireString(evidence.id, `${path}.id`, errors);
  requireString(evidence.kind, `${path}.kind`, errors);
  requireString(evidence.source_event, `${path}.source_event`, errors);
  requireSha256(evidence.hash, `${path}.hash`, errors);
}

function validateModelTrace(trace, path, errors) {
  requireObject(trace, path, errors);
  if (!trace || typeof trace !== "object") return;

  requireString(trace.model_id, `${path}.model_id`, errors);
  requireString(trace.provider, `${path}.provider`, errors);
  requireString(trace.request_id, `${path}.request_id`, errors);
  requireNonNegativeInteger(trace.input_tokens, `${path}.input_tokens`, errors);
  requireNonNegativeInteger(trace.output_tokens, `${path}.output_tokens`, errors);
  requireObject(trace.billing, `${path}.billing`, errors);

  if (trace.billing) {
    requireString(trace.billing.currency, `${path}.billing.currency`, errors);
    requireString(trace.billing.input_cost, `${path}.billing.input_cost`, errors);
    requireString(trace.billing.output_cost, `${path}.billing.output_cost`, errors);
    requireString(trace.billing.total_cost, `${path}.billing.total_cost`, errors);
  }

  if (typeof trace.tee_verified !== "boolean" && trace.tee_verified !== null) {
    errors.push(`${path}.tee_verified must be a boolean or null.`);
  }
}

function requireObject(value, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object.`);
  }
}

function requireArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
  }
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string.`);
  }
}

function requireStringAllowNull(value, path, errors) {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    errors.push(`${path} must be a non-empty string or null.`);
  }
}

function requireEqual(value, expected, path, errors) {
  if (value !== expected) {
    errors.push(`${path} must equal "${expected}".`);
  }
}

function requireEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}.`);
  }
}

function requireNonNegativeInteger(value, path, errors) {
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${path} must be a non-negative integer.`);
  }
}

function requireSha256(value, path, errors) {
  if (typeof value !== "string" || !/^sha256:[a-fA-F0-9]{64}$/.test(value)) {
    errors.push(`${path} must be a sha256 digest.`);
  }
}

function result(errors) {
  return {
    ok: errors.length === 0,
    errors
  };
}

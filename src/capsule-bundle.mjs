import { canonicalJson, sha256Digest } from "./hash.mjs";
import { validateCapsule, validateEvent } from "./protocol.mjs";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /OG_INFERENCE_API_KEY\s*=\s*\S+/gi,
  /OG_STORAGE_PRIVATE_KEY\s*=\s*\S+/gi,
  /OG_MANAGEMENT_API_KEY\s*=\s*\S+/gi
];

export function buildCapsuleBundle({ capsule, events = [], traces = [], handoff = "" }) {
  if (!capsule || typeof capsule !== "object") {
    throw new Error("A Context Capsule is required to build a publish bundle.");
  }

  const redactedEvents = events.map((event) => redactEvent(event));
  const sanitizedHandoff = redactText(handoff);
  const manifest = {
    bundle_schema: "relay.capsule-bundle.v1",
    created_at: new Date().toISOString(),
    capsule_id: capsule.capsule_id,
    files: [
      "capsule.json",
      "events.jsonl",
      "handoff.md",
      "traces/"
    ],
    event_count: redactedEvents.length,
    trace_count: traces.length
  };

  const bundle = {
    schema: "relay.capsule-bundle.v1",
    manifest,
    capsule,
    events: redactedEvents,
    traces,
    handoff: sanitizedHandoff
  };

  bundle.manifest.content_hash = sha256Digest(canonicalJson({
    capsule,
    events: redactedEvents,
    traces,
    handoff: sanitizedHandoff
  }));

  return bundle;
}

export function serializeCapsuleBundle(bundle) {
  return Buffer.from(canonicalJson(bundle), "utf8");
}

export function parseCapsuleBundle(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  const bundle = JSON.parse(text);

  if (bundle?.schema !== "relay.capsule-bundle.v1") {
    throw new Error(`Unsupported bundle schema "${bundle?.schema ?? "unknown"}".`);
  }

  return bundle;
}

export function validateCapsuleBundle(bundle) {
  const errors = [];

  if (!bundle || typeof bundle !== "object") {
    return { ok: false, errors: ["bundle is required"] };
  }

  if (bundle.schema !== "relay.capsule-bundle.v1") {
    errors.push('bundle.schema must be "relay.capsule-bundle.v1".');
  }

  if (!bundle.manifest || typeof bundle.manifest !== "object") {
    errors.push("bundle.manifest is required.");
  } else if (!bundle.manifest.content_hash) {
    errors.push("bundle.manifest.content_hash is required.");
  } else {
    const expected = sha256Digest(canonicalJson({
      capsule: bundle.capsule,
      events: bundle.events ?? [],
      traces: bundle.traces ?? [],
      handoff: bundle.handoff ?? ""
    }));

    if (bundle.manifest.content_hash !== expected) {
      errors.push("bundle.manifest.content_hash does not match bundle contents.");
    }
  }

  const capsuleValidation = validateCapsule(bundle.capsule);
  if (!capsuleValidation.ok) {
    errors.push(...capsuleValidation.errors.map((error) => `capsule: ${error}`));
  }

  if (Array.isArray(bundle.events)) {
    for (const [index, event] of bundle.events.entries()) {
      const eventValidation = validateEvent(event);
      if (!eventValidation.ok) {
        errors.push(...eventValidation.errors.map((error) => `events[${index}]: ${error}`));
      }
    }
  } else {
    errors.push("bundle.events must be an array.");
  }

  if (!Array.isArray(bundle.traces)) {
    errors.push("bundle.traces must be an array.");
  }

  if (typeof bundle.handoff !== "string") {
    errors.push("bundle.handoff must be a string.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function resolveBundleEvents(capsule, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const referencedIds = new Set(
    (capsule.evidence ?? [])
      .map((item) => item.source_event)
      .filter(Boolean)
  );

  if (referencedIds.size === 0) {
    return events;
  }

  return events.filter((event) => referencedIds.has(event.event_id));
}

function redactEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  const copy = structuredClone(event);
  if (copy.payload && typeof copy.payload === "object") {
    for (const field of ["prompt", "response", "text"]) {
      if (typeof copy.payload[field] === "string") {
        copy.payload[field] = redactText(copy.payload[field]);
      }
    }
  }

  return copy;
}

function redactText(text) {
  let cleaned = String(text);
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }
  return cleaned;
}
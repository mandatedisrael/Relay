import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const BUILTIN_TARGETS = Object.freeze({
  codex: {
    label: "Codex",
    kind: "coding",
    modelCandidates: ["kimi-k2.7-code", "glm-5.1", "deepseek-v4-pro", "qwen3.7-plus", "0gm-1.0-35b-a3b"]
  },
  "claude-code": {
    label: "Claude Code",
    kind: "external",
    external: true
  },
  claude: {
    label: "Claude Code",
    kind: "external",
    external: true
  },
  glm: {
    label: "GLM",
    kind: "0g",
    modelId: "glm-5.1"
  },
  "0gm": {
    label: "0GM",
    kind: "0g",
    modelId: "0gm-1.0-35b-a3b"
  }
});

export async function loadTargetOverrides(projectRoot) {
  const path = join(projectRoot, ".relay", "targets.json");
  if (!existsSync(path)) {
    return {};
  }

  const contents = await readFile(path, "utf8");
  const parsed = JSON.parse(contents);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function resolveHandoffTarget(targetName, {
  overrides = {},
  allowedModelIds = [],
  catalogModelIds = []
} = {}) {
  if (typeof targetName !== "string" || targetName.trim().length === 0) {
    throw new Error("A handoff target is required. Example: relay to codex");
  }

  const normalized = targetName.trim().toLowerCase();
  const override = overrides[normalized] ?? overrides[targetName];
  const builtin = BUILTIN_TARGETS[normalized];
  const allowed = new Set(allowedModelIds);
  const catalog = new Set(catalogModelIds);

  if (override?.external === true || builtin?.external === true) {
    return {
      name: normalized,
      label: override?.label ?? builtin?.label ?? targetName,
      external: true,
      modelId: null
    };
  }

  const explicitModel = override?.model ?? override?.modelId ?? builtin?.modelId;
  if (explicitModel) {
    return build0gTarget(normalized, override?.label ?? builtin?.label ?? targetName, explicitModel, allowed, catalog);
  }

  const candidates = [
    ...(override?.modelCandidates ?? []),
    ...(builtin?.modelCandidates ?? []),
    normalized
  ];

  for (const candidate of candidates) {
    if (allowed.has(candidate)) {
      return {
        name: normalized,
        label: override?.label ?? builtin?.label ?? targetName,
        external: false,
        modelId: candidate
      };
    }

    if (!allowed.size && catalog.has(candidate)) {
      return {
        name: normalized,
        label: override?.label ?? builtin?.label ?? targetName,
        external: false,
        modelId: candidate,
        unverifiedAccess: true
      };
    }
  }

  if (allowed.size > 0) {
    throw new Error(
      `No allowed 0G model matched target "${targetName}". Run \`relay models --allowed\` or set .relay/targets.json.`
    );
  }

  return {
    name: normalized,
    label: override?.label ?? builtin?.label ?? targetName,
    external: true,
    modelId: null,
    reason: "no_inference_models_verified"
  };
}

function build0gTarget(name, label, modelId, allowed, catalog) {
  if (allowed.size > 0 && !allowed.has(modelId)) {
    throw new Error(`Target "${name}" maps to ${modelId}, but that model is not allowed for your API key.`);
  }

  if (!allowed.size && !catalog.has(modelId)) {
    throw new Error(`Target "${name}" maps to ${modelId}, which is not in the live 0G catalog.`);
  }

  return {
    name,
    label,
    external: false,
    modelId,
    unverifiedAccess: allowed.size === 0
  };
}
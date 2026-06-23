import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHandoffTarget } from "../src/model-targets.mjs";

describe("Relay handoff targets", () => {
  it("maps codex to the first allowed coding model", () => {
    const target = resolveHandoffTarget("codex", {
      allowedModelIds: ["glm-5.1", "0gm-1.0-35b-a3b"]
    });

    assert.equal(target.external, false);
    assert.equal(target.modelId, "glm-5.1");
    assert.equal(target.label, "Codex");
  });

  it("treats claude-code as an external paste handoff target", () => {
    const target = resolveHandoffTarget("claude-code", {
      allowedModelIds: ["glm-5.1"]
    });

    assert.equal(target.external, true);
    assert.equal(target.modelId, null);
  });

  it("respects project target overrides", () => {
    const target = resolveHandoffTarget("codex", {
      overrides: { codex: { model: "0gm-1.0-35b-a3b" } },
      allowedModelIds: ["0gm-1.0-35b-a3b", "glm-5.1"]
    });

    assert.equal(target.modelId, "0gm-1.0-35b-a3b");
  });
});
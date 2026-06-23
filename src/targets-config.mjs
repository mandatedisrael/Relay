import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./hash.mjs";

const DEFAULT_TARGETS = {
  codex: {
    label: "Codex",
    model: "glm-5.1"
  },
  "claude-code": {
    label: "Claude Code",
    external: true
  }
};

export async function ensureDefaultTargetsConfig(projectRoot) {
  const path = join(projectRoot, ".relay", "targets.json");
  if (existsSync(path)) {
    return null;
  }

  await writeFile(path, `${canonicalJson(DEFAULT_TARGETS)}\n`, "utf8");
  return path;
}
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadDotEnv(projectRoot = process.cwd()) {
  const path = join(projectRoot, ".env");
  if (!existsSync(path)) {
    return {};
  }

  const text = await readFile(path, "utf8");
  const env = {};

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      env[key] = value;
    }
  }

  return env;
}

export async function loadRuntimeEnv(projectRoot = process.cwd()) {
  const fileEnv = await loadDotEnv(projectRoot);
  return {
    ...fileEnv,
    ...process.env
  };
}
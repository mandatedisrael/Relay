import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./hash.mjs";

function activeTaskPath(projectRoot) {
  return join(projectRoot, ".relay", "active-task.json");
}

export async function readActiveTask(projectRoot) {
  try {
    const contents = await readFile(activeTaskPath(projectRoot), "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function saveActiveTask(projectRoot, task) {
  if (!task?.capsule_id) {
    throw new Error("Active task requires capsule_id.");
  }

  await mkdir(join(projectRoot, ".relay"), { recursive: true });
  const record = {
    capsule_id: task.capsule_id,
    goal: task.goal ?? null,
    last_model: task.last_model ?? null,
    updated_at: new Date().toISOString()
  };
  await writeFile(activeTaskPath(projectRoot), canonicalJson(record), "utf8");
  return record;
}

export async function clearActiveTask(projectRoot) {
  try {
    await unlink(activeTaskPath(projectRoot));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
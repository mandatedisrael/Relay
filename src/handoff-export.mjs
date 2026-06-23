import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writePortableHandoff({
  projectRoot,
  target,
  capsule,
  handoff,
  publishResult,
  continued = false,
  modelId = null
}) {
  const directory = join(projectRoot, ".relay", "handoffs");
  await mkdir(directory, { recursive: true });

  const body = buildPortableHandoffMarkdown({
    target,
    capsule,
    handoff,
    publishResult,
    continued,
    modelId
  });

  const targetFile = join(directory, `to-${target.name}.md`);
  const latestFile = join(directory, "latest.md");

  await writeFile(targetFile, body, "utf8");
  await writeFile(latestFile, body, "utf8");

  return {
    targetFile,
    latestFile,
    body
  };
}

function buildPortableHandoffMarkdown({
  target,
  capsule,
  handoff,
  publishResult,
  continued,
  modelId
}) {
  const lines = [
    `# Relay portable handoff → ${target.label}`,
    "",
    "Paste this into Claude Code, Codex, OpenCode, or another coding CLI to continue the same task.",
    "",
    "## Task",
    `- Goal: ${capsule.task.goal}`,
    `- Status: ${capsule.state.status}`,
    `- Next action: ${capsule.state.next_action || "None"}`,
    `- Capsule: ${capsule.capsule_id}`,
    "",
    "## Encrypted archive (0G Storage)",
    `- Relay URL: ${publishResult.relayUrl}`,
    `- Root hash: ${publishResult.upload.rootHash}`,
    `- Decryption key: ${publishResult.keyHex}`,
    "",
    "Restore on another machine:",
    "",
    "```sh",
    `relay capsule fetch ${publishResult.relayUrl}`,
    "```",
    "",
    "If the key is not stored locally, pass `--key <hex>`.",
    ""
  ];

  if (continued && modelId) {
    lines.push("## Already continued on 0G", `- Model: ${modelId}`, "");
  }

  lines.push("## Handoff memory", "", handoff.trim(), "");
  return lines.join("\n");
}
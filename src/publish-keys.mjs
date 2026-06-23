import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./hash.mjs";

function publishKeysDirectory(projectRoot) {
  return join(projectRoot, ".relay", "publish-keys");
}

function normalizeRootHash(rootHash) {
  return String(rootHash).toLowerCase();
}

export async function savePublishKey(projectRoot, record) {
  if (!record?.root_hash) {
    throw new Error("Publish key record requires root_hash.");
  }

  const directory = publishKeysDirectory(projectRoot);
  await mkdir(directory, { recursive: true });
  const id = normalizeRootHash(record.root_hash).replace(/^0x/, "");
  const body = {
    root_hash: record.root_hash,
    encryption: record.encryption ?? "aes256",
    key_hex: record.key_hex,
    network: record.network,
    mode: record.mode,
    relay_url: record.relay_url,
    capsule_id: record.capsule_id ?? null,
    saved_at: new Date().toISOString()
  };

  await writeFile(join(directory, `${id}.json`), canonicalJson(body), "utf8");
  return body;
}

export async function readPublishKey(projectRoot, rootHash) {
  const directory = publishKeysDirectory(projectRoot);
  const id = normalizeRootHash(rootHash).replace(/^0x/, "");

  try {
    const contents = await readFile(join(directory, `${id}.json`), "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
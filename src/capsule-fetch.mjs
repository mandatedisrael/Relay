import {
  parseCapsuleBundle,
  validateCapsuleBundle
} from "./capsule-bundle.mjs";
import { readPublishKey } from "./publish-keys.mjs";
import { loadStorageConfig, parseRelayStorageReference } from "./storage-config.mjs";
import {
  downloadEncryptedBytes,
  parseEncryptionKeyHex,
  peekEncryptionHeader
} from "./zerog-storage.mjs";
import { saveCapsule, saveEvent, saveTrace } from "./local-store.mjs";

export async function fetchCapsuleBundle({
  projectRoot,
  reference,
  storageConfig,
  encryptionKeyHex,
  env = {},
  deps
}) {
  const parsed = parseRelayStorageReference(reference);
  const effectiveStorageConfig = storageConfig ?? loadStorageConfig({
    ...env,
    ...(parsed.network ? { OG_STORAGE_NETWORK: parsed.network } : {})
  });

  const keyRecord = encryptionKeyHex
    ? { key_hex: encryptionKeyHex }
    : await readPublishKey(projectRoot, parsed.rootHash);

  if (!keyRecord?.key_hex) {
    throw new Error(
      "Decryption key not found. Pass --key <hex> or publish from this machine so Relay can load the local publish key."
    );
  }

  const encryptionKey = parseEncryptionKeyHex(keyRecord.key_hex);
  const header = await peekEncryptionHeader({
    rootHash: parsed.rootHash,
    storageConfig: effectiveStorageConfig,
    deps
  });

  if (header === null) {
    throw new Error("Fetched object is not encrypted. Relay capsule fetch expects an AES-256 encrypted bundle.");
  }

  if (header.version !== 1) {
    throw new Error(`Unsupported encryption header version ${header.version}. Relay publish/fetch expects AES-256 (version 1).`);
  }

  const bytes = await downloadEncryptedBytes({
    rootHash: parsed.rootHash,
    storageConfig: effectiveStorageConfig,
    encryptionKey,
    withProof: true,
    deps
  });

  const bundle = parseCapsuleBundle(bytes);
  const validation = validateCapsuleBundle(bundle);
  if (!validation.ok) {
    throw new Error(`Fetched capsule bundle failed validation: ${validation.errors.join("; ")}`);
  }

  return {
    bundle,
    rootHash: parsed.rootHash,
    network: parsed.network ?? effectiveStorageConfig.network,
    storageConfig: effectiveStorageConfig,
    proofVerified: true
  };
}

export async function importCapsuleBundle(projectRoot, bundle) {
  const capsuleRecord = await saveCapsule(projectRoot, bundle.capsule);

  const eventRecords = [];
  for (const event of bundle.events ?? []) {
    eventRecords.push(await saveEvent(projectRoot, event));
  }

  const traceRecords = [];
  for (const trace of bundle.traces ?? []) {
    if (trace?.request_id) {
      traceRecords.push(await saveTrace(projectRoot, trace));
    }
  }

  return {
    capsuleRecord,
    eventRecords,
    traceRecords
  };
}
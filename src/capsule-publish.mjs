import {
  buildCapsuleBundle,
  resolveBundleEvents,
  serializeCapsuleBundle,
  validateCapsuleBundle
} from "./capsule-bundle.mjs";
import { savePublishKey } from "./publish-keys.mjs";
import { buildRelayStorageUrl } from "./storage-config.mjs";
import { buildContextView } from "./view-builder.mjs";
import {
  formatEncryptionKeyHex,
  generateAes256Key,
  uploadEncryptedBytes
} from "./zerog-storage.mjs";

export async function publishCapsuleBundle({
  projectRoot,
  capsule,
  events = [],
  mode = "standard",
  storageConfig,
  encryptionKey = generateAes256Key(),
  deps
}) {
  const relatedEvents = resolveBundleEvents(capsule, events);
  const viewResult = buildContextView({
    capsule,
    mode,
    events: relatedEvents
  });

  const bundle = buildCapsuleBundle({
    capsule,
    events: relatedEvents,
    traces: capsule.model_trace ?? [],
    handoff: viewResult.handoff
  });

  const bundleValidation = validateCapsuleBundle(bundle);
  if (!bundleValidation.ok) {
    throw new Error(`Capsule bundle failed validation: ${bundleValidation.errors.join("; ")}`);
  }

  const bundleBytes = serializeCapsuleBundle(bundle);
  const upload = await uploadEncryptedBytes({
    bytes: bundleBytes,
    storageConfig,
    encryptionKey,
    deps
  });

  const relayUrl = buildRelayStorageUrl(storageConfig.network, upload.rootHash);
  const keyHex = formatEncryptionKeyHex(encryptionKey);

  const updatedCapsule = structuredClone(capsule);
  updatedCapsule.storage = {
    network: storageConfig.network,
    mode: storageConfig.mode,
    root_hash: upload.rootHash,
    relay_url: relayUrl,
    tx_hash: upload.txHash,
    encryption: "aes256",
    published_at: new Date().toISOString(),
    bundle_schema: bundle.schema,
    bundle_hash: bundle.manifest.content_hash,
    handoff_mode: mode
  };

  await savePublishKey(projectRoot, {
    root_hash: upload.rootHash,
    encryption: "aes256",
    key_hex: keyHex,
    network: storageConfig.network,
    mode: storageConfig.mode,
    relay_url: relayUrl,
    capsule_id: capsule.capsule_id
  });

  return {
    bundle,
    upload,
    relayUrl,
    encryptionKey,
    keyHex,
    updatedCapsule,
    view: viewResult.view
  };
}
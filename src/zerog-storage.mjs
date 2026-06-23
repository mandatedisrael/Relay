import { randomBytes } from "node:crypto";
import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

export function generateAes256Key() {
  return randomBytes(32);
}

export function parseEncryptionKeyHex(keyHex) {
  if (typeof keyHex !== "string" || keyHex.trim().length === 0) {
    throw new Error("An encryption key is required.");
  }

  const normalized = keyHex.trim().replace(/^0x/i, "");
  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("Encryption key must be 32 bytes encoded as 64 hex characters.");
  }

  return Buffer.from(normalized, "hex");
}

export function formatEncryptionKeyHex(keyBytes) {
  return `0x${Buffer.from(keyBytes).toString("hex")}`;
}

export function createDefaultStorageDeps() {
  return {
    async uploadEncryptedBytes({ bytes, storageConfig, encryptionKey }) {
      if (!storageConfig?.hasPrivateKey) {
        throw new Error("OG_STORAGE_PRIVATE_KEY is required to publish capsules to 0G Storage.");
      }

      const indexer = new Indexer(storageConfig.indexerUrl);
      const provider = new ethers.JsonRpcProvider(storageConfig.evmRpcUrl);
      const signer = new ethers.Wallet(storageConfig.privateKey, provider);
      const memData = new MemData(bytes);

      const [, treeErr] = await memData.merkleTree();
      if (treeErr !== null) {
        throw new Error(`0G Storage merkle tree error: ${treeErr}`);
      }

      const [tx, uploadErr] = await indexer.upload(
        memData,
        storageConfig.evmRpcUrl,
        signer,
        {
          encryption: {
            type: "aes256",
            key: encryptionKey
          }
        }
      );

      if (uploadErr !== null) {
        throw new Error(`0G Storage upload failed: ${uploadErr}`);
      }

      if (!tx || !("rootHash" in tx)) {
        throw new Error("0G Storage returned an unexpected fragmented upload response.");
      }

      return {
        rootHash: tx.rootHash,
        txHash: tx.txHash
      };
    },

    async downloadEncryptedBytes({ rootHash, storageConfig, encryptionKey, withProof = true }) {
      const indexer = new Indexer(storageConfig.indexerUrl);
      const [blob, downloadErr] = await indexer.downloadToBlob(rootHash, {
        proof: withProof,
        decryption: {
          symmetricKey: encryptionKey
        }
      });

      if (downloadErr !== null) {
        throw new Error(`0G Storage download failed: ${downloadErr}`);
      }

      return new Uint8Array(await blob.arrayBuffer());
    },

    async peekEncryptionHeader({ rootHash, storageConfig }) {
      const indexer = new Indexer(storageConfig.indexerUrl);
      const [header, peekErr] = await indexer.peekHeader(rootHash);

      if (peekErr !== null) {
        throw new Error(`0G Storage header peek failed: ${peekErr}`);
      }

      return header;
    }
  };
}

export async function uploadEncryptedBytes(options) {
  const deps = options.deps ?? createDefaultStorageDeps();
  return deps.uploadEncryptedBytes(options);
}

export async function downloadEncryptedBytes(options) {
  const deps = options.deps ?? createDefaultStorageDeps();
  return deps.downloadEncryptedBytes(options);
}

export async function peekEncryptionHeader(options) {
  const deps = options.deps ?? createDefaultStorageDeps();
  return deps.peekEncryptionHeader(options);
}
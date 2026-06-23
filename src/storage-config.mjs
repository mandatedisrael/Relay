export const STORAGE_NETWORKS = Object.freeze({
  testnet: {
    name: "testnet",
    evmRpcUrl: "https://evmrpc-testnet.0g.ai",
    chainId: 16602,
    indexer: {
      turbo: "https://indexer-storage-testnet-turbo.0g.ai",
      standard: "https://indexer-storage-testnet-standard.0g.ai"
    }
  },
  mainnet: {
    name: "mainnet",
    evmRpcUrl: "https://evmrpc.0g.ai",
    chainId: 16661,
    indexer: {
      turbo: "https://indexer-storage-turbo.0g.ai",
      standard: "https://indexer-storage.0g.ai"
    }
  }
});

export const STORAGE_MODES = Object.freeze(["turbo", "standard"]);

export function loadStorageConfig(env) {
  const networkName = (env.OG_STORAGE_NETWORK || "mainnet").toLowerCase();
  const mode = (env.OG_STORAGE_MODE || "turbo").toLowerCase();
  const network = STORAGE_NETWORKS[networkName];

  if (!network) {
    throw new Error(`Invalid OG_STORAGE_NETWORK "${networkName}". Expected testnet or mainnet.`);
  }

  if (!STORAGE_MODES.includes(mode)) {
    throw new Error(`Invalid OG_STORAGE_MODE "${mode}". Expected turbo or standard.`);
  }

  const privateKey = env.OG_STORAGE_PRIVATE_KEY || "";
  const evmRpcUrl = env.OG_EVM_RPC_URL || network.evmRpcUrl;
  const indexerUrl = env.OG_STORAGE_INDEXER_URL || network.indexer[mode];

  return {
    network: networkName,
    mode,
    evmRpcUrl,
    indexerUrl,
    privateKey,
    hasPrivateKey: Boolean(privateKey)
  };
}

export function buildRelayStorageUrl(network, rootHash) {
  return `relay://0g-storage/${network}/${rootHash}`;
}

export function parseRelayStorageReference(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("A relay storage URL or root hash is required.");
  }

  const value = input.trim();
  const relayMatch = value.match(/^relay:\/\/0g-storage\/([^/]+)\/(0x[a-fA-F0-9]{64})$/);
  if (relayMatch) {
    return {
      network: relayMatch[1],
      rootHash: relayMatch[2]
    };
  }

  if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return {
      network: null,
      rootHash: value
    };
  }

  throw new Error(`Invalid storage reference "${value}". Expected relay://0g-storage/<network>/<root-hash> or a 0x-prefixed root hash.`);
}
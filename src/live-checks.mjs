import { ethers } from "ethers";
import { loadConfig } from "./config.mjs";
import { loadStorageConfig } from "./storage-config.mjs";
import { fetchModelCatalog } from "./zerog-router.mjs";

export async function runLiveDoctorChecks({ env, fetchImpl = globalThis.fetch }) {
  const router = loadConfig(env);
  const storage = safeLoadStorageConfig(env);
  const checks = [];

  checks.push({
    name: "router_inference_key",
    ok: router.hasInferenceKey,
    detail: router.hasInferenceKey ? "configured" : "missing OG_INFERENCE_API_KEY"
  });

  checks.push({
    name: "storage_private_key",
    ok: storage.ok && storage.config.hasPrivateKey,
    detail: storage.ok
      ? (storage.config.hasPrivateKey ? "configured" : "missing OG_STORAGE_PRIVATE_KEY")
      : storage.error
  });

  let models = [];
  try {
    models = await fetchModelCatalog({ baseUrl: router.routerBaseUrl, fetchImpl });
    checks.push({
      name: "router_catalog",
      ok: models.length > 0,
      detail: `${models.length} live models`
    });
  } catch (error) {
    checks.push({
      name: "router_catalog",
      ok: false,
      detail: error.message
    });
  }

  if (storage.ok && storage.config.hasPrivateKey) {
    try {
      const provider = new ethers.JsonRpcProvider(storage.config.evmRpcUrl);
      const wallet = new ethers.Wallet(storage.config.privateKey, provider);
      const balance = await provider.getBalance(wallet.address);
      const balance0g = ethers.formatEther(balance);
      checks.push({
        name: "storage_wallet_balance",
        ok: balance > 0n,
        detail: `${wallet.address} | ${balance0g} 0G on ${storage.config.network}`
      });
    } catch (error) {
      checks.push({
        name: "storage_wallet_balance",
        ok: false,
        detail: error.message
      });
    }
  } else {
    checks.push({
      name: "storage_wallet_balance",
      ok: false,
      detail: "skipped until OG_STORAGE_PRIVATE_KEY is configured"
    });
  }

  return {
    router,
    storage: storage.ok ? storage.config : null,
    models,
    checks,
    readyForProof: checks.every((check) => check.ok)
  };
}

function safeLoadStorageConfig(env) {
  try {
    return {
      ok: true,
      config: loadStorageConfig(env)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}
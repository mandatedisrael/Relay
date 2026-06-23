export const DEFAULT_ROUTER_BASE_URL = "https://router-api.0g.ai/v1";

export function loadConfig(env) {
  return {
    routerBaseUrl: env.OG_ROUTER_BASE_URL || DEFAULT_ROUTER_BASE_URL,
    inferenceApiKey: env.OG_INFERENCE_API_KEY || "",
    hasInferenceKey: Boolean(env.OG_INFERENCE_API_KEY)
  };
}

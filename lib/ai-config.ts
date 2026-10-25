export type AIProvider = "xai" | "nvidia" | "groq";

const providers = {
  xai: { keyName: "XAI_API_KEY", modelName: "XAI_MODEL", defaultModel: "grok-4.7", baseURL: "https://api.x.ai/v1", label: "Grok" },
  nvidia: { keyName: "NVIDIA_API_KEY", modelName: "NVIDIA_MODEL", defaultModel: "openai/gpt-oss-20b", baseURL: "https://integrate.api.nvidia.com/v1", label: "NVIDIA" },
  groq: { keyName: "GROQ_API_KEY", modelName: "GROQ_MODEL", defaultModel: "openai/gpt-oss-20b", baseURL: "https://api.groq.com/openai/v1", label: "Groq" },
} as const;

export function getAIConfig(env: Record<string, string | undefined> = process.env) {
  const selected = env.AI_PROVIDER?.trim().toLowerCase() || "groq";
  const provider: AIProvider | null = selected === "xai" || selected === "nvidia" || selected === "groq" ? selected : null;
  const settings = providers[provider ?? "groq"];
  const { keyName, modelName, baseURL } = settings;
  const apiKey = provider ? env[keyName]?.trim() : undefined;
  return {
    provider,
    apiKey,
    keyName,
    modelName,
    model: env[modelName]?.trim() || settings.defaultModel,
    baseURL,
    configured: Boolean(provider && apiKey),
    missing: !provider ? ["AI_PROVIDER (groq, nvidia, or xai)"] : !apiKey ? [keyName] : [],
  };
}

export function aiProviderError(error: unknown, config: ReturnType<typeof getAIConfig>) {
  const label = providers[config.provider ?? "groq"].label;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  // Never forward a provider's raw error: some providers echo API credentials.
  if (status === 408 || (error instanceof Error && /timeout|timed out|aborted/i.test(error.message))) return `${label} took too long to respond. Try again; common attendance questions can still be retrieved directly from your records.`;
  if (status === 401 || status === 403) return `${label} rejected the API credentials. Check ${config.keyName} and the account's API permissions.`;
  if (status === 402) return `${label} requires API credits before it can answer. Check the provider account's billing.`;
  if (status === 404) return `The selected ${label} model is unavailable. Check ${config.modelName}.`;
  if (status === 429) return `${label} reached a rate or quota limit. Wait briefly or check the provider account's limits.`;
  if (status === 400 || status === 422) return `${label} rejected the model or tool request. Check that ${config.modelName} supports function calling.`;
  return `${label} could not complete the request. Try again shortly.`;
}

// Bun loads this app's .env.local. This sends no church records or credentials in prompts.
import { getAIConfig } from "../lib/ai-config";

const requested = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1];
for (const provider of ["xai", "nvidia", "groq"] as const) {
  if (requested && requested !== provider) continue;
  const config = getAIConfig({ ...process.env, AI_PROVIDER: provider });
  const key = config.apiKey;
  if (!key) {
    console.log(JSON.stringify({ provider, configured: false }));
    continue;
  }
  try {
    const response = await fetch(config.baseURL + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Reply with READY." }],
        max_tokens: 512,
        ...(config.model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json().catch(() => null);
    const detail = typeof body?.error === "string" ? body.error : body?.error?.message || body?.message || "";
    const reason = /incorrect.*key|invalid.*key/i.test(detail) ? "API key rejected."
      : /credit|balance|billing/i.test(detail) ? "API credits or billing required."
      : /region|country|geograph/i.test(detail) ? "Provider regional restriction."
      : /permission|access|authoriz/i.test(detail) ? "API access or permissions rejected."
      : "Provider rejected the request.";
    console.log(JSON.stringify({ provider, model: config.model, configured: true, status: response.status, authenticated: response.ok, completionReceived: Boolean(body?.choices?.[0]?.message), ...(!response.ok ? { reason } : {}) }));
  } catch {
    console.log(JSON.stringify({ provider, configured: true, error: "Provider connection failed or timed out." }));
  }
}

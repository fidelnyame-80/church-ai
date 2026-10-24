// Bun loads .env.local. Print only safe diagnostics, never provider error bodies.
import { getVoiceConfig } from "../lib/voice-config";

const config = getVoiceConfig();
if (!config.configured) {
  console.log(JSON.stringify({ configured: false, missing: "GROQ_API_KEY" }));
  process.exit(1);
}
try {
  const response = await fetch(config.baseURL + "/audio/speech", {
    method: "POST",
    headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.speechModel, voice: config.speechVoice, input: "Voice connection test.", response_format: "wav" }),
    signal: AbortSignal.timeout(20000),
  });
  if (response.ok) {
    console.log(JSON.stringify({ status: response.status, audioBytes: (await response.arrayBuffer()).byteLength }));
  } else {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof payload.error?.code === "string" && /^[a-z_]{1,60}$/.test(payload.error.code) ? payload.error.code : "unclassified";
    const message = typeof payload.error?.message === "string" ? payload.error.message : "";
    console.log(JSON.stringify({ status: response.status, code, reason: /terms|accept.*agreement/i.test(message)
      ? "Accept the speech model terms in the Groq console."
      : /voice.*invalid|invalid.*voice/i.test(message) ? "The speech voice is not supported by this model."
      : "Speech model unavailable; check model access and configuration." }));
  }
} catch {
  console.log(JSON.stringify({ error: "Groq speech connection failed or timed out." }));
  process.exitCode = 1;
}

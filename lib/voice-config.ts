export const maxVoiceAudioBytes = 4 * 1024 * 1024;
// Groq's Orpheus endpoint currently accepts at most 200 characters per call.
export const maxSpeechCharacters = 200;

export function getVoiceConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.GROQ_API_KEY?.trim();
  return {
    provider: "groq" as const,
    configured: Boolean(apiKey),
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
    transcriptionModel: env.GROQ_TRANSCRIPTION_MODEL?.trim() || "whisper-large-v3-turbo",
    speechModel: env.GROQ_SPEECH_MODEL?.trim() || "canopylabs/orpheus-v1-english",
    speechVoice: env.GROQ_SPEECH_VOICE?.trim() || "hannah",
  };
}

const audioExtensions = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "opus", "wav", "webm"]);
const audioMimeExtensions: Record<string, string> = {
  "audio/flac": "flac", "audio/x-flac": "flac",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mpga": "mpga",
  "audio/mp4": "mp4", "video/mp4": "mp4", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
  "audio/ogg": "ogg", "application/ogg": "ogg", "audio/opus": "ogg",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/webm": "webm", "video/webm": "webm",
};

export function validateVoiceAudio(value: unknown): { file: File; filename: string } | { error: string; status: number } {
  if (!(value instanceof File) || !value.size) return { error: "Send a nonempty audio recording in the audio field.", status: 400 };
  if (value.size > maxVoiceAudioBytes) return { error: "The recording is too large. Keep it below 4 MB and try a shorter question.", status: 413 };
  const mime = value.type.split(";")[0].trim().toLowerCase();
  const extension = value.name.split(".").at(-1)?.toLowerCase() || "";
  const mimeExtension = audioMimeExtensions[mime];
  if (!mimeExtension && !((!mime || mime === "application/octet-stream") && audioExtensions.has(extension))) {
    return { error: "Use a WebM, MP4, M4A, WAV, MP3, Ogg, or FLAC audio recording.", status: 400 };
  }
  // MediaRecorder can upload a File named just “blob”; give Groq a recognized extension.
  const safeExtension = extension === "opus" ? "ogg" : audioExtensions.has(extension) ? extension : mimeExtension;
  return { file: value, filename: `recording.${safeExtension}` };
}

export function validateSpeechText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length && text.length <= maxSpeechCharacters ? text : null;
}

export function voiceProviderError(error: unknown, stage: "transcription" | "speech"): { error: string; status: number; code: string } {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const detail = error && typeof error === "object" ? error as { code?: unknown; error?: { code?: unknown } } : undefined;
  if (detail?.code === "model_terms_required" || detail?.error?.code === "model_terms_required") {
    return { error: "Accept this voice model's terms in the Groq console to enable generated speech. Browser speech remains available.", status: 503, code: "VOICE_MODEL_TERMS_REQUIRED" };
  }
  const label = stage === "speech" ? "spoken audio" : "transcription";
  const modelSetting = stage === "speech" ? "GROQ_SPEECH_MODEL and GROQ_SPEECH_VOICE" : "GROQ_TRANSCRIPTION_MODEL";
  // Provider errors sometimes contain credentials or submitted text. Never forward them.
  if (status === 408 || (error instanceof Error && /timeout|timed out|aborted/i.test(error.message))) {
    return { error: `Groq ${label} took too long. Please try again.`, status: 504, code: "VOICE_TIMEOUT" };
  }
  if (status === 401) return { error: "Groq rejected the voice API credentials. Check GROQ_API_KEY.", status: 503, code: "VOICE_CREDENTIALS" };
  if (status === 403) return { error: "Groq voice model access is not enabled. Check model permissions in the Groq console.", status: 503, code: "VOICE_MODEL_ACCESS" };
  if (status === 429) return { error: `Groq ${label} reached a rate or quota limit. Wait briefly and try again.`, status: 429, code: "VOICE_RATE_LIMIT" };
  if (status === 400 || status === 404 || status === 422) {
    return { error: `Groq could not process the ${label} request. Check ${modelSetting} and the model's access permissions.`, status: 502, code: "VOICE_MODEL_UNAVAILABLE" };
  }
  return { error: `Groq ${label} is unavailable right now. Please try again.`, status: 502, code: "VOICE_UNAVAILABLE" };
}

import OpenAI, { toFile } from "openai";
import { NextResponse } from "next/server";
import { getVoiceConfig, maxVoiceAudioBytes, validateVoiceAudio, voiceProviderError } from "@/lib/voice-config";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const config = getVoiceConfig();
  if (!config.configured) return NextResponse.json({ error: "Voice transcription requires GROQ_API_KEY.", missing: ["GROQ_API_KEY"] }, { status: 503, headers });
  const declaredBytes = Number(request.headers.get("content-length"));
  if (declaredBytes > maxVoiceAudioBytes + 64 * 1024) return NextResponse.json({ error: "The recording is too large. Keep it below 4 MB.", code: "AUDIO_TOO_LARGE" }, { status: 413, headers });
  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the recording as multipart form data in the audio field." }, { status: 400, headers });
  }
  const validated = validateVoiceAudio(data.get("audio") ?? data.get("file"));
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: validated.status, headers });
  try {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 20000, maxRetries: 0 });
    const transcription = await client.audio.transcriptions.create({
      file: await toFile(await validated.file.arrayBuffer(), validated.filename, { type: validated.file.type || "application/octet-stream" }),
      model: config.transcriptionModel,
      language: "en",
      prompt: "Church attendance questions. First Love Church, New Gbawe, Sonta.",
      response_format: "json",
      temperature: 0,
    }, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]) });
    const text = transcription.text?.trim();
    if (!text) return NextResponse.json({ error: "No speech was detected. Please speak your question and try again.", code: "NO_SPEECH" }, { status: 422, headers });
    return NextResponse.json({ text }, { headers });
  } catch (error) {
    const failure = voiceProviderError(error, "transcription");
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers });
  }
}

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getVoiceConfig, maxSpeechCharacters, validateSpeechText, voiceProviderError } from "@/lib/voice-config";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const config = getVoiceConfig();
  if (!config.configured) return NextResponse.json({ error: "Spoken answers require GROQ_API_KEY.", missing: ["GROQ_API_KEY"] }, { status: 503, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON object containing the text to speak." }, { status: 400, headers });
  }
  const text = validateSpeechText(body && typeof body === "object" && "text" in body ? body.text : undefined);
  if (!text) return NextResponse.json({ error: `Speech text must contain between 1 and ${maxSpeechCharacters} characters.`, code: "INVALID_SPEECH_TEXT" }, { status: 400, headers });
  try {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: 20000, maxRetries: 0 });
    const speech = await client.audio.speech.create({ model: config.speechModel, voice: config.speechVoice, input: text, response_format: "wav" }, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]) });
    const audio = await speech.arrayBuffer();
    if (!audio.byteLength) return NextResponse.json({ error: "Groq returned no spoken audio. Please try again.", code: "EMPTY_SPEECH" }, { status: 502, headers });
    return new Response(audio, { headers: { ...headers, "Content-Type": "audio/wav", "Content-Length": String(audio.byteLength) } });
  } catch (error) {
    const failure = voiceProviderError(error, "speech");
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers });
  }
}

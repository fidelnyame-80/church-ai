import { NextResponse } from "next/server";
import { configStatus } from "@/lib/sheets";
import { getVoiceConfig } from "@/lib/voice-config";

export async function POST() {
  const config = configStatus();
  const voice = getVoiceConfig();
  const headers = { "Cache-Control": "no-store" };
  if (!config.sheetsConfigured || !voice.configured) {
    return NextResponse.json({ error: "Voice mode requires Google Sheets and GROQ_API_KEY.", missing: [...config.missing.filter((name) => name.startsWith("GOOGLE_")), ...(!voice.configured ? ["GROQ_API_KEY"] : [])] }, { status: 503, headers });
  }
  return NextResponse.json({ provider: voice.provider, transcriptionModel: voice.transcriptionModel, speechModel: voice.speechModel, speechVoice: voice.speechVoice }, { headers });
}

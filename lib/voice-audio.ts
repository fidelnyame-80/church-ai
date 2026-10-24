export type VoiceActivity = {
  startedAt: number; sampledAt: number; firstVoiceAt: number | null; lastVoiceAt: number | null; speechMs: number;
};

export function audioRms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let total = 0;
  for (let index = 0; index < samples.length; index++) total += samples[index] * samples[index];
  return Math.sqrt(total / samples.length);
}

export function createVoiceActivity(now: number): VoiceActivity {
  return { startedAt: now, sampledAt: now, firstVoiceAt: null, lastVoiceAt: null, speechMs: 0 };
}

export function sampleVoiceActivity(previous: VoiceActivity, level: number, now: number): { activity: VoiceActivity; action: "continue" | "discard" | "submit" } {
  const voiced = level >= 0.018;
  const elapsed = Math.max(0, Math.min(100, now - previous.sampledAt));
  const activity: VoiceActivity = {
    ...previous, sampledAt: now,
    firstVoiceAt: voiced ? previous.firstVoiceAt ?? now : previous.firstVoiceAt,
    lastVoiceAt: voiced ? now : previous.lastVoiceAt,
    speechMs: previous.speechMs + (voiced ? elapsed : 0),
  };
  const silentEnd = activity.lastVoiceAt !== null && now - activity.lastVoiceAt >= 1000;
  const maximumLength = activity.firstVoiceAt !== null && now - activity.firstVoiceAt >= 20000;
  if (silentEnd || maximumLength) return { activity, action: activity.speechMs >= 250 ? "submit" : "discard" };
  if (activity.firstVoiceAt === null && now - activity.startedAt >= 3000) return { activity, action: "discard" };
  return { activity, action: "continue" };
}

export function preferredRecordingType(supported: (mimeType: string) => boolean): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"].find(supported);
}

export function plainSpeechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ").trim();
}

export function splitSpeechText(text: string, limit = 200): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Speech chunks must contain between 1 and 200 characters.");
  let remaining = plainSpeechText(text);
  const chunks: string[] = [];
  while (remaining.length > limit) {
    let window = remaining.slice(0, limit);
    const lastUnit = window.charCodeAt(window.length - 1);
    if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) window = window.slice(0, -1);
    if (!window) throw new Error("The speech chunk limit cannot split a Unicode character.");
    const sentenceEnds = [...window.matchAll(/[.!?]["”’')\]]*\s+/g)];
    const sentence = sentenceEnds.at(-1);
    const sentenceCut = sentence ? (sentence.index ?? 0) + sentence[0].length : 0;
    const wordCut = window.lastIndexOf(" ");
    const boundary = sentenceCut >= window.length * 0.4 ? sentenceCut : wordCut > 0 ? wordCut : window.length;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining.length) chunks.push(remaining.trim());
  return chunks.filter(Boolean);
}

import type { ChatEvent } from "./ai-chat";
import type { AnalyticsResult, SourceVerification } from "./attendance";

export type ChatStreamEvent = ChatEvent
  | { type: "status"; message: string }
  | { type: "done"; answer: string; visualizations: AnalyticsResult[]; sources?: SourceVerification[]; timings?: { sheetsMs: number; aiMs: number; totalMs: number; modelCalls: number } }
  | { type: "error"; message: string };

class ChatStreamError extends Error {}

const unreadableResponse = "Church AI returned an unreadable response. Please try again.";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function analyticsResult(value: unknown): value is AnalyticsResult {
  return record(value) && typeof value.operation === "string" && typeof value.title === "string"
    && typeof value.summary === "string" && typeof value.fetchedAt === "string"
    && Array.isArray(value.columns) && Array.isArray(value.rows)
    && Array.isArray(value.notes) && Array.isArray(value.sources);
}

function streamEvent(value: unknown): value is ChatStreamEvent {
  if (!record(value)) return false;
  switch (value.type) {
    case "status":
    case "error": return typeof value.message === "string";
    case "text": return typeof value.delta === "string";
    case "analytics": return analyticsResult(value.result);
    case "done": {
      if (typeof value.answer !== "string" || !Array.isArray(value.visualizations) || !value.visualizations.every(analyticsResult)) return false;
      const timings = value.timings;
      if (timings === undefined) return true;
      if (!record(timings)) return false;
      return ["sheetsMs", "aiMs", "totalMs", "modelCalls"].every((key) =>
        typeof timings[key] === "number" && Number.isFinite(timings[key])
      );
    }
    default: return false;
  }
}

export async function readChatStream(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  let finished = false;
  const readLine = (line: string) => {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ChatStreamError(unreadableResponse);
    }
    if (!streamEvent(value)) throw new ChatStreamError(unreadableResponse);
    onEvent(value);
    if (value.type === "error") throw new ChatStreamError(value.message.trim() || "Church AI could not complete the request. Please try again.");
    if (value.type === "done") finished = true;
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1 && !finished) {
        readLine(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
      if (done && !finished) {
        readLine(buffered);
        if (!finished) throw new ChatStreamError("Church AI response ended before it finished. Please try again.");
      }
    }
    await reader.cancel().catch(() => {});
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ChatStreamError) throw error;
    throw new ChatStreamError("Church AI connection was interrupted. Please try again.");
  } finally {
    reader.releaseLock();
  }
}

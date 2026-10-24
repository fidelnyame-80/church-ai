import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { AnalyticsResult } from "./attendance";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatEvent = { type: "analytics"; result: AnalyticsResult } | { type: "text"; delta: string };

type ChatOptions = {
  messages: ChatMessage[];
  model: string;
  instructions: string;
  tool: { name: string; description: string; parameters: Record<string, unknown> };
  create: (params: ChatCompletionCreateParamsNonStreaming) => Promise<ChatCompletion>;
  stream?: (params: ChatCompletionCreateParamsStreaming) => Promise<AsyncIterable<ChatCompletionChunk>>;
  onEvent?: (event: ChatEvent) => void;
  execute: (args: unknown) => Promise<AnalyticsResult>;
};

export class ChatVerificationError extends Error {
  constructor() {
    super("I could not verify an answer from the connected church records. Please try again.");
    this.name = "ChatVerificationError";
  }
}

const maxToolBatches = 3;
const maxCallsPerBatch = 8;

function verifiedSummary(results: AnalyticsResult[]): string {
  const summaries = results.map((result) => [result.title, result.summary].filter(Boolean).join(": "));
  const notes = results.flatMap((result) => result.notes);
  return [...new Set([...summaries, ...notes].filter(Boolean))].join("\n\n")
    || "The verified church records are shown below.";
}

export async function runChurchChat(options: ChatOptions): Promise<{ answer: string; visualizations: AnalyticsResult[] }> {
  const conversation: ChatCompletionMessageParam[] = [
    { role: "system", content: options.instructions },
    ...options.messages.map((message) => ({ role: message.role, content: message.content })),
  ];
  const visualizations: AnalyticsResult[] = [];
  const tool = { type: "function" as const, function: {
    name: options.tool.name,
    description: options.tool.description,
    parameters: options.tool.parameters,
  } };
  const reasoning = options.model.toLowerCase().includes("gpt-oss") ? { reasoning_effort: "low" as const } : {};
  const verifiedAnswer = (answer?: string | null) => {
    if (!visualizations.length) throw new ChatVerificationError();
    return { answer: answer?.trim() || verifiedSummary(visualizations), visualizations };
  };
  const streamVerifiedAnswer = async () => {
    if (!visualizations.length) throw new ChatVerificationError();
    if (!options.stream) return verifiedAnswer();
    let answer = "";
    let finishReason: string | null = null;
    let unexpectedToolCall = false;
    try {
      const stream = await options.stream({
        model: options.model, messages: [...conversation], tools: [tool],
        tool_choice: "none", stream: true, max_tokens: 4096, ...reasoning,
      });
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta.tool_calls?.length) unexpectedToolCall = true;
        // Provider reasoning fields are deliberately ignored. Only final answer content is emitted.
        if (!unexpectedToolCall && !finishReason && typeof choice.delta.content === "string" && choice.delta.content) {
          answer += choice.delta.content;
          options.onEvent?.({ type: "text", delta: choice.delta.content });
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      return verifiedAnswer(finishReason === "stop" && !unexpectedToolCall ? answer : null);
    } catch {
      // The final result replaces any partial text and retains the already emitted verified charts.
      return verifiedAnswer();
    }
  };

  for (let batch = 0; batch <= maxToolBatches; batch++) {
    const response = await options.create({
      model: options.model,
      messages: [...conversation],
      tools: [tool],
      tool_choice: batch === 0
        ? { type: "function", function: { name: options.tool.name } }
        : batch === maxToolBatches ? "none" : "auto",
      max_tokens: batch === maxToolBatches ? 4096 : 2048,
      ...reasoning,
    });
    const choice = response.choices[0];
    const calls = choice?.message.tool_calls ?? [];

    // Incomplete model output is never a trustworthy final answer or tool request.
    if (!choice || choice.finish_reason === "length" || choice.finish_reason === "content_filter") {
      return verifiedAnswer();
    }
    if (!calls.length) {
      return verifiedAnswer(choice.finish_reason === "stop" ? choice.message.content : null);
    }
    // A provider can ignore tool_choice. Bound execution independently of its response.
    if (batch === maxToolBatches || calls.length > maxCallsPerBatch) return verifiedAnswer();
    const callIds = calls.map((call) => call.id);
    if (callIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(callIds).size !== callIds.length) {
      return verifiedAnswer();
    }

    conversation.push({ role: "assistant", content: choice.message.content, tool_calls: calls });
    for (const call of calls) {
      let output: AnalyticsResult | { error: string };
      if (call.type !== "function" || call.function.name !== options.tool.name) {
        output = { error: "Only the provided church analytics function is available." };
      } else {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          output = { error: "Analytics arguments must be a valid JSON object matching the tool schema." };
          conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
          continue;
        }
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          output = { error: "Analytics arguments must be a JSON object matching the tool schema." };
        } else {
          try {
            output = await options.execute(args);
          } catch {
            output = { error: "Church analytics could not be retrieved. Check the operation and its arguments before trying again." };
          }
        }
      }
      if (!("error" in output)) {
        visualizations.push(output);
        options.onEvent?.({ type: "analytics", result: output });
      }
      // Source links are for the user; the model only needs the verified calculation.
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ...output, verification: undefined }) });
    }
    if (options.stream && visualizations.length) return streamVerifiedAnswer();
  }
  return verifiedAnswer();
}

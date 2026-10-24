import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import type { AnalyticsResult } from "./attendance";
import { ChatVerificationError, runChurchChat, type ChatEvent } from "./ai-chat";

const tool = {
  name: "get_church_analytics",
  description: "Retrieve verified church analytics.",
  parameters: { type: "object", properties: { operation: { type: "string" } }, required: ["operation"] },
};
const result: AnalyticsResult = {
  operation: "overview", title: "Church overview", summary: "55 registered members.",
  columns: [{ key: "members", label: "Members" }], rows: [{ members: 55 }],
  notes: ["Missing submissions are unreported, never confirmed absences."],
  sources: ["Members", "Form Responses 1"], fetchedAt: "2026-10-24T12:00:00Z",
};

function call(id = "call-1", args = '{"operation":"overview"}', name = tool.name): ChatCompletionMessageToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}
function completion({ content = null, calls, finish }: { content?: string | null; calls?: ChatCompletionMessageToolCall[]; finish?: ChatCompletion["choices"][number]["finish_reason"] } = {}): ChatCompletion {
  return {
    id: "completion-1", object: "chat.completion", created: 0, model: "test-model",
    choices: [{ index: 0, finish_reason: finish ?? (calls?.length ? "tool_calls" : "stop"), logprobs: null,
      message: { role: "assistant", content, refusal: null, ...(calls ? { tool_calls: calls } : {}) } }],
  };
}
function chunk(content: string | null, finish: ChatCompletionChunk["choices"][number]["finish_reason"] = null): ChatCompletionChunk {
  return {
    id: "chunk-1", object: "chat.completion.chunk", created: 0, model: "test-model",
    choices: [{ index: 0, delta: { content }, finish_reason: finish, logprobs: null }],
  };
}
function setup(responses: ChatCompletion[], execute: (args: unknown) => Promise<AnalyticsResult> = async () => result, model = "test-model") {
  const requests: ChatCompletionCreateParamsNonStreaming[] = [];
  const executed: unknown[] = [];
  return {
    requests, executed,
    run: () => runChurchChat({
      messages: [{ role: "user", content: "How many members are registered?" }], instructions: "Use verified analytics.", tool, model,
      create: async (params) => {
        requests.push(structuredClone(params));
        const response = responses.shift();
        assert.ok(response, "The runner made an unexpected provider request.");
        return response;
      },
      execute: async (args) => { executed.push(args); return execute(args); },
    }),
  };
}

describe("grounded chat tool loop", () => {
  test("forces analytics first and returns matched tool results before the final answer", async () => {
    const chat = setup([completion({ calls: [call()] }), completion({ content: "There are 55 registered members." })]);
    const response = await chat.run();
    assert.equal(response.answer, "There are 55 registered members.");
    assert.deepEqual(response.visualizations, [result]);
    assert.deepEqual(chat.executed, [{ operation: "overview" }]);
    assert.deepEqual(chat.requests[0].tool_choice, { type: "function", function: { name: tool.name } });
    assert.equal(chat.requests[0].max_tokens, 2048);
    assert.equal(chat.requests[0].reasoning_effort, undefined);
    assert.deepEqual(chat.requests[0].tools, [{ type: "function", function: tool }]);
    assert.equal(chat.requests[1].tool_choice, "auto");
    assert.deepEqual(chat.requests[1].messages.at(-1), { role: "tool", tool_call_id: "call-1", content: JSON.stringify(result) });
  });

  test("rejects prose when a provider skips the required analytics call", async () => {
    const chat = setup([completion({ content: "There are 900 members." })]);
    await assert.rejects(chat.run(), ChatVerificationError);
    assert.equal(chat.executed.length, 0);
  });

  test("converts Responses tools without leaking extra schema fields", async () => {
    const sourceTool = { ...tool, type: "function", strict: false };
    const requests: ChatCompletionCreateParamsNonStreaming[] = [];
    const responses = [completion({ calls: [call()] }), completion({ content: "55 registered members." })];
    await runChurchChat({
      messages: [{ role: "user", content: "How many members?" }], model: "test-model", instructions: "Use verified analytics.",
      tool: sourceTool, execute: async () => result,
      create: async (params) => { requests.push(params); return responses.shift()!; },
    });
    for (const request of requests) {
      assert.deepEqual(request.tools, [{ type: "function", function: tool }]);
      const sentTool = request.tools?.[0];
      assert.equal(sentTool?.type, "function");
      if (sentTool?.type === "function") {
        assert.deepEqual(Object.keys(sentTool.function).sort(), ["description", "name", "parameters"]);
      }
    }
  });

  test("unknown tools, malformed JSON, and non-object arguments never execute", async () => {
    const chat = setup([
      completion({ calls: [call("unknown", "{}", "delete_members"), call("invalid-json", "{"), call("array", "[]"), call("null", "null")] }),
      completion({ content: "The church has 900 members." }),
    ]);
    await assert.rejects(chat.run(), ChatVerificationError);
    assert.equal(chat.executed.length, 0);
    const feedback = chat.requests[1].messages.filter((message) => message.role === "tool");
    assert.equal(feedback.length, 4);
    assert.deepEqual(feedback.map((message) => message.tool_call_id), ["unknown", "invalid-json", "array", "null"]);
    assert.ok(feedback.every((message) => JSON.parse(String(message.content)).error));
  });

  test("failed analytics cannot enable an unverified answer or leak execution errors", async () => {
    const chat = setup([completion({ calls: [call()] }), completion({ content: "There are 900 members." })], async () => { throw new Error("private-key-secret-value"); });
    await assert.rejects(chat.run(), ChatVerificationError);
    assert.equal(JSON.stringify(chat.requests).includes("private-key-secret-value"), false);
    assert.match(String(chat.requests[1].messages.at(-1)?.content), /could not be retrieved/);
  });

  test("successful parallel calls retain separate IDs and visualizations", async () => {
    const trend = { ...result, operation: "trend", title: "Attendance trend" };
    const chat = setup([
      completion({ calls: [call("overview"), call("trend", '{"operation":"trend"}')] }),
      completion({ content: "Here are the verified overview and trend." }),
    ], async (args) => (args as { operation: string }).operation === "trend" ? trend : result);
    const response = await chat.run();
    assert.deepEqual(response.visualizations, [result, trend]);
    assert.deepEqual(chat.requests[1].messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id), ["overview", "trend"]);
  });

  test("caps three tool batches and ignores calls returned after tools are disabled", async () => {
    const chat = setup([completion({ calls: [call("1")] }), completion({ calls: [call("2")] }), completion({ calls: [call("3")] }), completion({ calls: [call("4")], content: "Unverified tool-only prose." })]);
    const response = await chat.run();
    assert.equal(chat.executed.length, 3);
    assert.equal(chat.requests.length, 4);
    assert.equal(chat.requests[3].tool_choice, "none");
    assert.match(response.answer, /55 registered members/);
    assert.equal(response.answer.includes("Unverified tool-only prose"), false);
  });

  test("oversized batches and duplicate IDs do not execute ambiguous tool requests", async () => {
    for (const calls of [Array.from({ length: 9 }, (_, index) => call(String(index))), [call("duplicate"), call("duplicate")]]) {
      const chat = setup([completion({ calls })]);
      await assert.rejects(chat.run(), ChatVerificationError);
      assert.equal(chat.executed.length, 0);
    }
  });

  test("empty or truncated final answers fall back to verified summaries and notes", async () => {
    for (const last of [completion(), completion({ content: "The attendance is definitely 900", finish: "length" }), completion({ content: "Partial prose", finish: "tool_calls" }), { ...completion(), choices: [] }]) {
      const chat = setup([completion({ calls: [call()] }), last]);
      const response = await chat.run();
      assert.match(response.answer, /Church overview: 55 registered members/);
      assert.match(response.answer, /Missing submissions are unreported/);
      assert.equal(response.answer.includes("900"), false);
    }
  });

  test("truncated tool requests are never executed", async () => {
    const chat = setup([completion({ calls: [call()], finish: "length" })]);
    await assert.rejects(chat.run(), ChatVerificationError);
    assert.equal(chat.executed.length, 0);
  });

  test("sets low reasoning effort only for gpt-oss models", async () => {
    const chat = setup([completion({ calls: [call()] }), completion({ content: "55 registered members." })], undefined, "openai/gpt-oss-120b");
    await chat.run();
    assert.ok(chat.requests.every((request) => request.reasoning_effort === "low"));
  });

  test("streams verified analytics before final answer text with one planning request", async () => {
    const events: ChatEvent[] = [];
    const planning: ChatCompletionCreateParamsNonStreaming[] = [];
    const finalRequests: ChatCompletionCreateParamsStreaming[] = [];
    const response = await runChurchChat({
      messages: [{ role: "user", content: "How many members?" }], model: "openai/gpt-oss-20b", instructions: "Use verified analytics.", tool,
      create: async (params) => { planning.push(params); return completion({ calls: [call()] }); },
      execute: async () => result, onEvent: (event) => events.push(event),
      stream: async (params) => {
        finalRequests.push(params);
        assert.deepEqual(events, [{ type: "analytics", result }]);
        return (async function* () {
          yield { ...chunk(null), choices: [{ ...chunk(null).choices[0], delta: { reasoning_content: "Private reasoning." } }] } as unknown as ChatCompletionChunk;
          yield chunk("There are ");
          yield chunk("55 registered members.");
          yield chunk(null, "stop");
        })();
      },
    });
    assert.equal(response.answer, "There are 55 registered members.");
    assert.deepEqual(response.visualizations, [result]);
    assert.deepEqual(events, [{ type: "analytics", result }, { type: "text", delta: "There are " }, { type: "text", delta: "55 registered members." }]);
    assert.equal(planning.length, 1);
    assert.equal(finalRequests.length, 1);
    assert.equal(finalRequests[0].tool_choice, "none");
    assert.equal(finalRequests[0].stream, true);
    assert.equal(finalRequests[0].reasoning_effort, "low");
    assert.deepEqual(finalRequests[0].messages.at(-1), { role: "tool", tool_call_id: "call-1", content: JSON.stringify(result) });
  });

  test("never starts final streaming or emits text without successful analytics", async () => {
    const events: ChatEvent[] = [];
    let streamCalls = 0;
    await assert.rejects(runChurchChat({
      messages: [{ role: "user", content: "How many members?" }], model: "test-model", instructions: "Use verified analytics.", tool,
      create: async () => completion({ content: "900 members." }), execute: async () => result,
      onEvent: (event) => events.push(event), stream: async () => { streamCalls++; return (async function* () { yield chunk("900 members.", "stop"); })(); },
    }), ChatVerificationError);
    assert.equal(streamCalls, 0);
    assert.deepEqual(events, []);
  });

  test("preserves verified results when opening the final stream fails", async () => {
    const events: ChatEvent[] = [];
    const response = await runChurchChat({
      messages: [{ role: "user", content: "How many members?" }], model: "test-model", instructions: "Use verified analytics.", tool,
      create: async () => completion({ calls: [call()] }), execute: async () => result, onEvent: (event) => events.push(event),
      stream: async () => { throw new Error("secret provider failure"); },
    });
    assert.match(response.answer, /55 registered members/);
    assert.equal(response.answer.includes("secret provider failure"), false);
    assert.deepEqual(response.visualizations, [result]);
    assert.deepEqual(events, [{ type: "analytics", result }]);
  });

  test("replaces incomplete streamed text with a deterministic verified answer", async () => {
    for (const failure of ["throw", "length", "missing-stop", "tool-call"] as const) {
      const events: ChatEvent[] = [];
      const response = await runChurchChat({
        messages: [{ role: "user", content: "How many members?" }], model: "test-model", instructions: "Use verified analytics.", tool,
        create: async () => completion({ calls: [call()] }), execute: async () => result, onEvent: (event) => events.push(event),
        stream: async () => (async function* () {
          yield chunk("Partial answer");
          if (failure === "throw") throw new Error("stream timeout");
          if (failure === "length") yield chunk(null, "length");
          if (failure === "tool-call") yield { ...chunk(null, "tool_calls"), choices: [{ ...chunk(null, "tool_calls").choices[0], delta: { tool_calls: [{ index: 0, id: "unexpected", type: "function", function: { name: tool.name, arguments: "{}" } }] } }] };
        })(),
      });
      assert.match(response.answer, /55 registered members/);
      assert.equal(response.answer.includes("Partial answer"), false);
      assert.deepEqual(response.visualizations, [result]);
      assert.deepEqual(events, [{ type: "analytics", result }, { type: "text", delta: "Partial answer" }]);
    }
  });

  test("allows a bounded planning retry after failed analytics before streaming", async () => {
    const responses = [completion({ calls: [call("invalid", "{")] }), completion({ calls: [call("valid")] })];
    let plans = 0;
    const events: ChatEvent[] = [];
    const response = await runChurchChat({
      messages: [{ role: "user", content: "How many members?" }], model: "test-model", instructions: "Use verified analytics.", tool,
      create: async () => { plans++; return responses.shift()!; }, execute: async () => result, onEvent: (event) => events.push(event),
      stream: async () => (async function* () { yield chunk("55 registered members.", "stop"); })(),
    });
    assert.equal(plans, 2);
    assert.equal(response.answer, "55 registered members.");
    assert.deepEqual(events, [{ type: "analytics", result }, { type: "text", delta: "55 registered members." }]);
  });
});

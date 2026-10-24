import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsResult } from "./attendance";
import { readChatStream, type ChatStreamEvent } from "./chat-stream";

const encoder = new TextEncoder();
const result: AnalyticsResult = {
  operation: "overview", title: "Church overview", summary: "55 registered members.",
  columns: [{ key: "members", label: "Members" }], rows: [{ members: 55 }],
  notes: ["Missing submissions are unreported."], sources: ["Members", "Form Responses 1"], fetchedAt: "2026-10-24T12:00:00Z",
};

function stream(chunks: Uint8Array[], options: { keepOpen?: boolean; onCancel?: () => void } = {}) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!options.keepOpen) controller.close();
    },
    cancel: options.onCancel,
  });
}

describe("chat NDJSON stream parser", () => {
  test("decodes fragmented UTF8 bytes and preserves ordered analytics and text events", async () => {
    const expected: ChatStreamEvent[] = [
      { type: "status", message: "Reading church records…" },
      { type: "analytics", result },
      { type: "text", delta: "Ama 🙏🏾 — こんにちは" },
      { type: "done", answer: "Ama 🙏🏾 — こんにちは", visualizations: [result], timings: { sheetsMs: 5, aiMs: 20, totalMs: 25, modelCalls: 2 } },
    ];
    const bytes = encoder.encode(expected.map((event) => JSON.stringify(event)).join("\n") + "\n");
    const body = stream(Array.from(bytes, (byte) => new Uint8Array([byte])));
    const received: ChatStreamEvent[] = [];
    await readChatStream(body, (event) => received.push(event));
    assert.deepEqual(received, expected);
    assert.equal(body.locked, false);
  });

  test("handles multiple events, blank lines, CRLF, and a final line without newline", async () => {
    const expected: ChatStreamEvent[] = [{ type: "text", delta: "55 members." }, { type: "done", answer: "55 members.", visualizations: [] }];
    const body = stream([encoder.encode("\r\n" + expected.map((event) => JSON.stringify(event)).join("\r\n\n"))]);
    const received: ChatStreamEvent[] = [];
    await readChatStream(body, (event) => received.push(event));
    assert.deepEqual(received, expected);
    assert.equal(body.locked, false);
  });

  test("rejects EOF without a done event and releases the reader", async () => {
    const body = stream([encoder.encode('{"type":"text","delta":"Partial answer"}\n')]);
    const received: ChatStreamEvent[] = [];
    await assert.rejects(readChatStream(body, (event) => received.push(event)), /ended before it finished/);
    assert.deepEqual(received, [{ type: "text", delta: "Partial answer" }]);
    assert.equal(body.locked, false);
  });

  test("malformed JSON produces a safe error and cancels the remaining body", async () => {
    let canceled = false;
    const body = stream([encoder.encode('{private-secret-data}\n')], { keepOpen: true, onCancel: () => { canceled = true; } });
    await assert.rejects(readChatStream(body, () => assert.fail("No event should be emitted.")), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /unreadable response/);
      assert.equal(error.message.includes("private-secret-data"), false);
      return true;
    });
    assert.equal(canceled, true);
    assert.equal(body.locked, false);
  });

  test("emits server errors, rejects with their message, and cancels the reader", async () => {
    let canceled = false;
    const error: ChatStreamEvent = { type: "error", message: "The connected records could not be loaded." };
    const received: ChatStreamEvent[] = [];
    const body = stream([encoder.encode(JSON.stringify(error) + "\n")], { keepOpen: true, onCancel: () => { canceled = true; } });
    await assert.rejects(readChatStream(body, (event) => received.push(event)), /connected records could not be loaded/);
    assert.deepEqual(received, [error]);
    assert.equal(canceled, true);
    assert.equal(body.locked, false);
  });

  test("rejects invalid event shapes and malformed UTF8 safely", async () => {
    for (const data of [encoder.encode('{"type":"text","delta":null}\n'), new Uint8Array([0xff])]) {
      const body = stream([data]);
      await assert.rejects(readChatStream(body, () => assert.fail("No event should be emitted.")), /unreadable response|connection was interrupted/);
      assert.equal(body.locked, false);
    }
  });

  test("a done event terminates an open response and releases its reader", async () => {
    let canceled = false;
    const done: ChatStreamEvent = { type: "done", answer: "55 members.", visualizations: [result] };
    const body = stream([encoder.encode(JSON.stringify(done) + "\n")], { keepOpen: true, onCancel: () => { canceled = true; } });
    const received: ChatStreamEvent[] = [];
    await readChatStream(body, (event) => received.push(event));
    assert.deepEqual(received, [done]);
    assert.equal(canceled, true);
    assert.equal(body.locked, false);
  });

  test("reader failures do not expose raw transport errors", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("private transport details")); } });
    await assert.rejects(readChatStream(body, () => {}), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /connection was interrupted/);
      assert.equal(error.message.includes("private transport details"), false);
      return true;
    });
    assert.equal(body.locked, false);
  });
});

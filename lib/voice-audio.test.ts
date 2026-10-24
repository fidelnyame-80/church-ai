import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audioRms, createVoiceActivity, plainSpeechText, preferredRecordingType, sampleVoiceActivity, splitSpeechText } from "./voice-audio";

describe("voice audio boundaries", () => {
  test("RMS measures quiet and signed audio without cancellation", () => {
    assert.equal(audioRms([]), 0);
    assert.equal(audioRms(new Float32Array([0, 0, 0])), 0);
    assert.equal(audioRms([0.5, -0.5]), 0.5);
  });

  test("an idle microphone and short noise bursts never submit audio", () => {
    assert.equal(sampleVoiceActivity(createVoiceActivity(0), 0, 3000).action, "discard");
    let state = createVoiceActivity(0);
    for (const now of [50, 100, 150, 200]) state = sampleVoiceActivity(state, 0.04, now).activity;
    assert.equal(sampleVoiceActivity(state, 0, 1200).action, "discard");
  });

  test("at least 250ms of speech followed by one second silence submits once", () => {
    let state = createVoiceActivity(0);
    for (const now of [50, 100, 150, 200, 250]) state = sampleVoiceActivity(state, 0.04, now).activity;
    assert.equal(sampleVoiceActivity(state, 0, 1249).action, "continue");
    assert.equal(sampleVoiceActivity(state, 0, 1250).action, "submit");
  });

  test("continuous speech stops after 20 seconds and stalled timers cannot fake speech", () => {
    let state = createVoiceActivity(0);
    for (let now = 50; now < 20050; now += 50) state = sampleVoiceActivity(state, 0.04, now).activity;
    assert.equal(sampleVoiceActivity(state, 0.04, 20050).action, "submit");
    const stalled = sampleVoiceActivity(createVoiceActivity(0), 0.04, 10000).activity;
    assert.equal(sampleVoiceActivity(stalled, 0, 11000).action, "discard");
  });

  test("prefers Opus and selects MP4 for Safari support", () => {
    assert.equal(preferredRecordingType(() => true), "audio/webm;codecs=opus");
    assert.equal(preferredRecordingType((mime) => mime === "audio/mp4"), "audio/mp4");
    assert.equal(preferredRecordingType(() => false), undefined);
  });

  test("splits the complete spoken answer into provider-safe chunks without truncation", () => {
    const text = "There are **55 members** in the church. " + "Attendance is based on recorded Present and Absent statuses. ".repeat(12);
    const chunks = splitSpeechText(text);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((part) => part.length <= 200));
    assert.equal(chunks.join(" "), plainSpeechText(text));
  });

  test("speech chunks preserve Unicode and handle long unbroken words", () => {
    const text = "🙏🏾".repeat(205);
    const chunks = splitSpeechText(text);
    assert.ok(chunks.every((part) => part.length <= 200));
    assert.ok(chunks.every((part) => !/[\ud800-\udbff]$/.test(part) && !/^[\udc00-\udfff]/.test(part)));
    assert.equal(chunks.join(""), text);
    assert.deepEqual(splitSpeechText(""), []);
    assert.throws(() => splitSpeechText("hello", 0));
  });
});

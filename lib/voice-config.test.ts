import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getVoiceConfig, maxSpeechCharacters, maxVoiceAudioBytes, validateSpeechText, validateVoiceAudio, voiceProviderError } from "./voice-config";

describe("Groq voice configuration", () => {
  test("uses Groq voice models independently of the configured chat provider", () => {
    const config = getVoiceConfig({ AI_PROVIDER: "nvidia", XAI_API_KEY: "unused", GROQ_API_KEY: " test-key " });
    assert.equal(config.configured, true);
    assert.equal(config.provider, "groq");
    assert.equal(config.transcriptionModel, "whisper-large-v3-turbo");
    assert.equal(config.speechModel, "canopylabs/orpheus-v1-english");
    assert.equal(config.speechVoice, "hannah");
    assert.equal(getVoiceConfig({ XAI_API_KEY: "unused" }).configured, false);
    assert.equal(getVoiceConfig({ GROQ_API_KEY: "  " }).configured, false);
  });

  test("accepts explicit voice model and persona overrides", () => {
    const config = getVoiceConfig({ GROQ_TRANSCRIPTION_MODEL: " whisper-large-v3 ", GROQ_SPEECH_MODEL: " custom-model ", GROQ_SPEECH_VOICE: " troy " });
    assert.equal(config.transcriptionModel, "whisper-large-v3");
    assert.equal(config.speechModel, "custom-model");
    assert.equal(config.speechVoice, "troy");
  });
});

describe("voice input validation", () => {
  test("accepts recorder containers and gives unnamed blobs a supported filename", () => {
    for (const type of ["audio/webm;codecs=opus", "audio/mp4", "audio/wav", "audio/ogg;codecs=opus"]) {
      const validated = validateVoiceAudio(new File(["test audio"], "blob", { type }));
      assert.ok("file" in validated);
      assert.match(validated.filename, /^recording\.(webm|mp4|wav|ogg)$/);
      assert.equal(validated.file.size, 10);
    }
    assert.ok("file" in validateVoiceAudio(new File(["audio"], "test.m4a")));
  });

  test("rejects missing, empty, unsupported, and oversized recordings", () => {
    for (const input of [null, "not a file", new File([], "empty.wav", { type: "audio/wav" }), new File(["text"], "test.txt", { type: "text/plain" })]) {
      const validated = validateVoiceAudio(input);
      assert.ok("error" in validated);
      assert.equal(validated.status, 400);
    }
    const oversized = validateVoiceAudio(new File([new Uint8Array(maxVoiceAudioBytes + 1)], "large.webm", { type: "audio/webm" }));
    assert.ok("error" in oversized);
    assert.equal(oversized.status, 413);
  });

  test("enforces Orpheus's documented 200 character input boundary", () => {
    assert.equal(maxSpeechCharacters, 200);
    assert.equal(validateSpeechText("  Hello.  "), "Hello.");
    assert.equal(validateSpeechText("x".repeat(200)), "x".repeat(200));
    for (const input of ["x".repeat(201), "  ", null, 55]) assert.equal(validateSpeechText(input), null);
  });
});

describe("voice provider errors", () => {
  test("identifies model terms without forwarding provider details", () => {
    for (const failure of [{ status: 400, code: "model_terms_required" }, { status: 400, error: { code: "model_terms_required" } }]) {
      assert.equal(voiceProviderError(failure, "speech").code, "VOICE_MODEL_TERMS_REQUIRED");
      assert.match(voiceProviderError(failure, "speech").error, /Accept.*terms/);
    }
  });
  test("returns useful access, rate, timeout, and model errors without provider details", () => {
    for (const status of [400, 401, 403, 404, 408, 422, 429, 500]) {
      const failure = voiceProviderError({ status, message: "gsk_private-key private-record-text", error: "secret" }, "speech");
      assert.equal(JSON.stringify(failure).includes("private"), false);
      assert.ok(failure.status >= 400);
    }
    assert.equal(voiceProviderError({ status: 403 }, "speech").code, "VOICE_MODEL_ACCESS");
    assert.equal(voiceProviderError({ status: 429 }, "transcription").status, 429);
    assert.equal(voiceProviderError(new Error("Timed out with private details"), "transcription").status, 504);
    assert.match(voiceProviderError({ status: 404 }, "transcription").error, /GROQ_TRANSCRIPTION_MODEL/);
  });
});

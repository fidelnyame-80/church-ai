import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getAIConfig, aiProviderError } from "./ai-config";

describe("AI provider configuration", () => {
  test("explicit Groq selection uses its API endpoint and default model", () => {
    const config = getAIConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "test-groq-key", NVIDIA_API_KEY: "other-key", XAI_API_KEY: "another-key" });
    assert.equal(config.provider, "groq");
    assert.equal(config.baseURL, "https://api.groq.com/openai/v1");
    assert.equal(config.model, "openai/gpt-oss-20b");
    assert.equal(config.keyName, "GROQ_API_KEY");
    assert.equal(config.modelName, "GROQ_MODEL");
    assert.equal(config.configured, true);
    assert.deepEqual(config.missing, []);
  });
  test("explicit Groq selection requires its own key without falling back", () => {
    const config = getAIConfig({ AI_PROVIDER: "groq", NVIDIA_API_KEY: "test-nvidia-key", XAI_API_KEY: "test-xai-key" });
    assert.equal(config.provider, "groq");
    assert.equal(config.configured, false);
    assert.deepEqual(config.missing, ["GROQ_API_KEY"]);
    assert.equal(config.apiKey, undefined);
  });
  test("Groq respects its model override", () => {
    const config = getAIConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "test-key", GROQ_MODEL: "llama-3.3-70b-versatile", NVIDIA_MODEL: "other-model", XAI_MODEL: "grok-selected" });
    assert.equal(config.provider, "groq");
    assert.equal(config.model, "llama-3.3-70b-versatile");
  });
  test("implicit selection prefers Groq, then NVIDIA, then xAI", () => {
    assert.equal(getAIConfig({ GROQ_API_KEY: "groq-key", NVIDIA_API_KEY: "nvidia-key", XAI_API_KEY: "xai-key" }).provider, "groq");
    assert.equal(getAIConfig({ NVIDIA_API_KEY: "nvidia-key", XAI_API_KEY: "xai-key" }).provider, "nvidia");
    assert.equal(getAIConfig({ XAI_API_KEY: "xai-key" }).provider, "xai");
  });
  test("explicit NVIDIA selection wins over an available Groq key", () => {
    const config = getAIConfig({ AI_PROVIDER: "nvidia", GROQ_API_KEY: "groq-key", NVIDIA_API_KEY: "nvidia-key" });
    assert.equal(config.provider, "nvidia");
    assert.equal(config.apiKey, "nvidia-key");
    assert.equal(config.configured, true);
  });
  test("explicit NVIDIA selection does not fall back to an existing Grok key", () => {
    const config = getAIConfig({ AI_PROVIDER: "nvidia", XAI_API_KEY: "test-key" });
    assert.equal(config.provider, "nvidia");
    assert.equal(config.configured, false);
    assert.deepEqual(config.missing, ["NVIDIA_API_KEY"]);
  });
  test("adding NVIDIA selects its hosted endpoint without exposing the key in model settings", () => {
    const config = getAIConfig({ NVIDIA_API_KEY: "test-key", XAI_API_KEY: "other-key" });
    assert.equal(config.provider, "nvidia");
    assert.equal(config.model, "openai/gpt-oss-20b");
    assert.equal(config.baseURL, "https://integrate.api.nvidia.com/v1");
    assert.equal(config.configured, true);
  });
  test("explicit Grok selection wins over NVIDIA and custom models are respected", () => {
    const config = getAIConfig({ AI_PROVIDER: "xai", NVIDIA_API_KEY: "test-key", XAI_API_KEY: "other-key", XAI_MODEL: "grok-selected" });
    assert.equal(config.provider, "xai");
    assert.equal(config.model, "grok-selected");
  });
  test("invalid provider is unconfigured rather than silently choosing another service", () => {
    const config = getAIConfig({ AI_PROVIDER: "unknown", XAI_API_KEY: "test-key" });
    assert.equal(config.configured, false);
    assert.equal(config.provider, null);
    assert.deepEqual(config.missing, ["AI_PROVIDER (groq, nvidia, or xai)"]);
  });
  test("provider error details cannot echo credentials back to the browser", () => {
    const config = getAIConfig({ NVIDIA_API_KEY: "secret-test-key" });
    const message = aiProviderError({ status: 403, message: "Incorrect API key secret-test-key" }, config);
    assert.match(message, /NVIDIA_API_KEY/);
    assert.equal(message.includes("secret-test-key"), false);
    assert.equal(aiProviderError(new Error("secret-test-key"), config).includes("secret-test-key"), false);
  });
  test("provider timeouts explain the delay without leaking request details", () => {
    const config = getAIConfig({ NVIDIA_API_KEY: "secret-test-key" });
    const message = aiProviderError(new Error("Request timed out with secret-test-key"), config);
    assert.match(message, /took too long/);
    assert.equal(message.includes("secret-test-key"), false);
  });
  test("Groq errors name the correct provider and never expose credentials", () => {
    const config = getAIConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "secret-groq-test-key" });
    for (const error of [
      { status: 401, message: "Incorrect API key secret-groq-test-key" },
      { status: 404, message: "Unavailable model secret-groq-test-key" },
      { status: 429, message: "Quota secret-groq-test-key" },
      new Error("Request timed out with secret-groq-test-key"),
      new Error("secret-groq-test-key"),
    ]) {
      const message = aiProviderError(error, config);
      assert.match(message, /^(?:The selected )?Groq /);
      assert.equal(message.includes("Grok"), false);
      assert.equal(message.includes("secret-groq-test-key"), false);
    }
    assert.match(aiProviderError({ status: 401 }, config), /GROQ_API_KEY/);
    assert.match(aiProviderError({ status: 404 }, config), /GROQ_MODEL/);
  });
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getAppConfig } from "./app-config";

describe("deployment environment validation", () => {
  test("a blank deployment requests exact Google Sheets variables and Groq, never xAI", () => {
    const status = getAppConfig({});
    assert.equal(status.sheetsConfigured, false);
    assert.equal(status.aiProvider, "groq");
    assert.deepEqual(status.missing, ["GOOGLE_SHEET_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY", "GROQ_API_KEY"]);
    assert.equal(JSON.stringify(status).includes("XAI_API_KEY"), false);
  });
  test("reports only missing inline credentials and accepts supported Google alternatives", () => {
    assert.deepEqual(getAppConfig({ GOOGLE_SHEET_ID: "id", GOOGLE_CLIENT_EMAIL: "reader@example.test", GROQ_API_KEY: "test-key" }).missing, ["GOOGLE_PRIVATE_KEY"]);
    const inline = getAppConfig({ GOOGLE_SHEET_ID: "id", GOOGLE_CLIENT_EMAIL: "reader@example.test", GOOGLE_PRIVATE_KEY: "test-private-key", GROQ_API_KEY: "test-key" });
    assert.equal(inline.sheetsConfigured, true);
    assert.equal(inline.aiConfigured, true);
    assert.deepEqual(inline.missing, []);
    assert.equal(JSON.stringify(inline).includes("test-private-key"), false);
    const json = getAppConfig({ GOOGLE_SHEETS_SPREADSHEET_ID: "id", GOOGLE_SERVICE_ACCOUNT_JSON: "{}", GROQ_API_KEY: "test-key" });
    assert.equal(json.sheetsConfigured, true);
    assert.deepEqual(json.missing, []);
  });
  test("a deliberate alternative provider reports its own key", () => {
    assert.deepEqual(getAppConfig({ AI_PROVIDER: "nvidia", GOOGLE_SHEET_ID: "id", GOOGLE_APPLICATION_CREDENTIALS: "key.json" }).missing, ["NVIDIA_API_KEY"]);
  });
});

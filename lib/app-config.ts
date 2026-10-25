import { getAIConfig } from "./ai-config";

/** Return variable names and connection state only; never return credential values. */
export function getAppConfig(env: Record<string, string | undefined> = process.env) {
  const ai = getAIConfig(env);
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || env.GOOGLE_SHEET_ID?.trim();
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = env.GOOGLE_PRIVATE_KEY?.trim();
  const hasOtherCredentials = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
  const hasCredentials = hasOtherCredentials || Boolean(email && privateKey);
  return {
    sheetsConfigured: Boolean(spreadsheetId && hasCredentials),
    aiConfigured: ai.configured,
    aiProvider: ai.provider,
    aiModel: ai.model,
    missing: [
      ...(!spreadsheetId ? ["GOOGLE_SHEET_ID"] : []),
      ...(!hasCredentials && !email ? ["GOOGLE_CLIENT_EMAIL"] : []),
      ...(!hasCredentials && !privateKey ? ["GOOGLE_PRIVATE_KEY"] : []),
      ...ai.missing,
    ],
  };
}

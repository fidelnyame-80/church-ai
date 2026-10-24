import { loadEnvConfig } from "@next/env";
import { GoogleAuth, JWT } from "google-auth-library";

loadEnvConfig(process.cwd());

const expectedId = process.argv[2];
const expectedEmail = process.argv[3];
const idKey = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ? "GOOGLE_SHEETS_SPREADSHEET_ID" : "GOOGLE_SHEET_ID";
const emailKey = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "GOOGLE_SERVICE_ACCOUNT_EMAIL" : "GOOGLE_CLIENT_EMAIL";
const id = process.env[idKey] ?? "";
let email = process.env[emailKey] ?? "";
let key = process.env.GOOGLE_PRIVATE_KEY ?? "";
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string };
  email = credentials.client_email ?? "";
  key = credentials.private_key ?? "";
}
console.log(`runtime.idKey=${idKey}`);
console.log(`runtime.emailKey=${process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "GOOGLE_SERVICE_ACCOUNT_JSON" : emailKey}`);
console.log(`runtime.idMatchesVerified=${id === expectedId}`);
console.log(`runtime.emailMatchesVerified=${email === expectedEmail}`);

const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
let token: string | null | undefined;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: [scope] });
    token = await auth.getAccessToken();
  } else {
    token = (await new JWT({ email, key: key.replace(/\\n/g, "\n"), scopes: [scope] }).getAccessToken()).token;
  }
  console.log(`auth.tokenAcquired=${Boolean(token)}`);
} catch (error) {
  console.log(`auth.error=${error instanceof Error ? error.name : "Unknown authentication error"}`);
  process.exit(1);
}
if (!token) process.exit(1);

const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
function safeError(value: unknown): string {
  const payload = value as { error?: { message?: string } };
  return (payload?.error?.message ?? "Unknown Google API error")
    .replaceAll(id, "[spreadsheet ID]")
    .replaceAll(email, "[service account]")
    .replaceAll(token ?? "", "[token]")
    .replaceAll(key, "[private key]")
    .slice(0, 300);
}
async function request(label: string, url: string) {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json() as Record<string, unknown>;
    console.log(`${label}.status=${response.status}`);
    if (!response.ok) console.log(`${label}.error=${safeError(payload)}`);
    return response.ok ? payload : null;
  } catch (error) {
    console.log(`${label}.networkError=${error instanceof Error ? error.name : "Unknown network error"}`);
    return null;
  }
}

const metadata = await request("metadata", `${base}?fields=spreadsheetId,properties.title,sheets.properties.title`);
if (!metadata) process.exit(2);
const sheets = (metadata.sheets ?? []) as { properties?: { title?: string } }[];
console.log(`metadata.worksheetTitles=${sheets.map((sheet) => sheet.properties?.title ?? "").join(" | ")}`);
for (const [label, range] of [["membersA1", "Members!A1"], ["responsesA1", "'Form Responses 1'!A1"]] as const) {
  const values = await request(label, `${base}/values/${encodeURIComponent(range)}`);
  if (values) console.log(`${label}.cellPresent=${Boolean((values.values as unknown[][] | undefined)?.[0]?.[0])}`);
}
const batchUrl = new URL(`${base}/values:batchGet`);
batchUrl.searchParams.append("ranges", "'Members'!A:D");
batchUrl.searchParams.append("ranges", "'Form Responses 1'!A:G");
batchUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
const batch = await request("batchGet", batchUrl.toString());
if (batch) {
  const valueRanges = (batch.valueRanges ?? []) as { values?: unknown[][] }[];
  console.log(`batchGet.worksheetCount=${valueRanges.length}`);
  console.log(`batchGet.memberRows=${valueRanges[0]?.values?.length ?? 0}`);
  console.log(`batchGet.attendanceRows=${valueRanges[1]?.values?.length ?? 0}`);
}
if (expectedId && expectedId !== id) {
  await request("verifiedIdMetadata", `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(expectedId)}?fields=spreadsheetId,properties.title,sheets.properties.title`);
}

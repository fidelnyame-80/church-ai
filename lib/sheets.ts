import "server-only";
import { GoogleAuth, JWT } from "google-auth-library";
import { parseChurchData, type ChurchData } from "./attendance";
import { getAppConfig } from "./app-config";

let cache: { data: ChurchData; expires: number } | null = null;
let pendingData: Promise<ChurchData> | null = null;
let fileAuth: GoogleAuth | undefined;
let jwtAuth: JWT | undefined;
let metadataCache: { id: string; expires: number; tabs: Record<string, number> } | undefined;
const scope = "https://www.googleapis.com/auth/spreadsheets.readonly";
const spreadsheetId = () => process.env.GOOGLE_SHEETS_SPREADSHEET_ID || process.env.GOOGLE_SHEET_ID;
const serviceAccountEmail = () => process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;

export const configStatus = getAppConfig;

export async function googleSheetsAccessToken(): Promise<string> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = fileAuth ??= new GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS, scopes: [scope] });
    const token = await auth.getAccessToken();
    if (!token) throw new Error("Google service account did not return an access token.");
    return token;
  }
  let email = serviceAccountEmail();
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string };
    email = credentials.client_email;
    key = credentials.private_key;
  }
  if (!email || !key) throw new Error("Google service account credentials are not configured.");
  const client = jwtAuth ??= new JWT({ email, key: key.replace(/\\n/g, "\n"), scopes: [scope] });
  const result = await client.getAccessToken();
  if (!result.token) throw new Error("Google service account did not return an access token.");
  return result.token;
}

export async function loadChurchData(force = false): Promise<ChurchData> {
  if (!force && cache && cache.expires > Date.now()) return cache.data;
  // Status, dashboard, and chat share a refresh instead of making parallel Google reads.
  if (!pendingData) pendingData = readChurchData().finally(() => { pendingData = null; });
  return pendingData;
}

async function readChurchData(): Promise<ChurchData> {
  const id = spreadsheetId();
  if (!id) throw new Error("GOOGLE_SHEET_ID is not configured.");
  const token = await googleSheetsAccessToken();
  const url = new URL("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id) + "/values:batchGet");
  url.searchParams.append("ranges", "'Members'!A:D");
  url.searchParams.append("ranges", "'Form Responses 1'!A:G");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const [response, tabs] = await Promise.all([
    fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(15000) }),
    readSheetMetadata(id, token),
  ]);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Google Sheets read failed (" + response.status + "): " + detail.slice(0, 300));
  }
  const payload = await response.json() as { valueRanges?: { values?: unknown[][] }[] };
  const memberRows = payload.valueRanges?.[0]?.values ?? [];
  const responseRows = payload.valueRanges?.[1]?.values ?? [];
  if (!memberRows.length || !responseRows.length) throw new Error("Expected Members and Form Responses 1 worksheets with header rows.");
  const data = parseChurchData(memberRows, responseRows);
  data.sourceSheets = Object.fromEntries([["Members", memberRows], ["Form Responses 1", responseRows]].map(([title, rows]) => {
    const sheetTitle = title as string;
    return [sheetTitle, { url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit#gid=${tabs[sheetTitle]}`,
      headers: ((rows as unknown[][])[0] ?? []).map(String) }];
  }));
  cache = { data, expires: Date.now() + 30_000 };
  return data;
}

async function readSheetMetadata(id: string, token: string): Promise<Record<string, number>> {
  if (metadataCache?.id === id && metadataCache.expires > Date.now()) return metadataCache.tabs;
  const url = new URL("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(id));
  url.searchParams.set("fields", "sheets.properties(sheetId,title)");
  const response = await fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Google Sheets metadata retrieval failed (${response.status}).`);
  const payload = await response.json() as { sheets?: { properties?: { title?: string; sheetId?: number } }[] };
  const tabs = Object.fromEntries((payload.sheets ?? []).flatMap(({ properties }) => properties?.title && typeof properties.sheetId === "number" ? [[properties.title, properties.sheetId]] : []));
  if (tabs.Members === undefined || tabs["Form Responses 1"] === undefined) throw new Error("The spreadsheet must contain Members and Form Responses 1 worksheets.");
  metadataCache = { id, tabs, expires: Date.now() + 300_000 };
  return tabs;
}

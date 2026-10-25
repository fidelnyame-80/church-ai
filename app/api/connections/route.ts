import { NextRequest, NextResponse } from "next/server";
import { loadConnectedSchema } from "@/lib/connected-sheets";
import { adminConfigured, checkAdminPassword, makeSheetSession, readSheetSession, sheetCookieName, sheetCookieOptions, spreadsheetIdFromUrl } from "@/lib/sheet-session";

const headers = { "Cache-Control": "no-store" };
const currentIds = (request: NextRequest) => readSheetSession(request.cookies.get(sheetCookieName)?.value);

export async function GET(request: NextRequest) {
  const ids = currentIds(request);
  if (!adminConfigured()) return NextResponse.json({ configured: false, authenticated: false, sheets: [] }, { headers });
  if (!ids) return NextResponse.json({ configured: true, authenticated: false, sheets: [] }, { headers });
  try {
    const sheets = await Promise.allSettled(ids.map(loadConnectedSchema));
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL
      || (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? (JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email?: string }).client_email : undefined);
    return NextResponse.json({ configured: true, authenticated: true,
      sheets: sheets.map((result, index) => result.status === "fulfilled" ? result.value : { id: ids[index], title: "Connection unavailable", worksheets: [], error: "The service account can no longer open this sheet." }),
      serviceAccountEmail }, { headers });
  } catch (error) {
    return NextResponse.json({ configured: true, authenticated: true, sheets: [], error: error instanceof Error ? error.message : "Could not read connected sheets." }, { headers });
  }
}

export async function POST(request: NextRequest) {
  if (!adminConfigured()) return NextResponse.json({ error: "Set CHURCH_AI_ADMIN_PASSWORD in the server environment to enable additional sheets." }, { status: 503, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415, headers });
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Send valid JSON." }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || typeof body.action !== "string") return NextResponse.json({ error: "Choose an action." }, { status: 400, headers });
  const previous = currentIds(request);
  if (body.action === "login") {
    if (!checkAdminPassword(body.password as string)) return NextResponse.json({ error: "Incorrect admin password." }, { status: 401, headers });
    const response = NextResponse.json({ authenticated: true }, { headers });
    response.cookies.set(sheetCookieName, makeSheetSession(previous ?? []), sheetCookieOptions);
    return response;
  }
  if (body.action === "logout") {
    const response = NextResponse.json({ authenticated: false }, { headers });
    response.cookies.delete(sheetCookieName);
    return response;
  }
  if (!previous) return NextResponse.json({ error: "Unlock sheet connections in Settings first." }, { status: 401, headers });
  if (body.action === "connect") {
    const id = typeof body.url === "string" ? spreadsheetIdFromUrl(body.url) : null;
    if (!id) return NextResponse.json({ error: "Paste a valid Google Sheets URL." }, { status: 400, headers });
    if (!previous.includes(id) && previous.length >= 8) return NextResponse.json({ error: "Up to eight additional spreadsheets can be connected." }, { status: 400, headers });
    try {
      const sheet = await loadConnectedSchema(id);
      const response = NextResponse.json({ sheet }, { headers });
      response.cookies.set(sheetCookieName, makeSheetSession([...new Set([...previous, id])]), sheetCookieOptions);
      return response;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not open that spreadsheet." }, { status: 502, headers });
    }
  }
  if (body.action === "remove") {
    const id = typeof body.id === "string" ? body.id : "";
    const response = NextResponse.json({ removed: previous.includes(id) }, { headers });
    response.cookies.set(sheetCookieName, makeSheetSession(previous.filter((item) => item !== id)), sheetCookieOptions);
    return response;
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400, headers });
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { executeAnalytics } from "@/lib/analytics-tool";
import { readSheetSession, sheetCookieName } from "@/lib/sheet-session";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ids = readSheetSession((await cookies()).get(sheetCookieName)?.value) ?? [];
    const result = await executeAnalytics(body, ids);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analytics request failed." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { executeAnalytics } from "@/lib/analytics-tool";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await executeAnalytics(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analytics request failed." }, { status: 400 });
  }
}

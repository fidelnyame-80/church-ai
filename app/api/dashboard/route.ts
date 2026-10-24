import { NextResponse } from "next/server";
import { loadChurchData } from "@/lib/sheets";
import { runAnalytics } from "@/lib/attendance";

export async function GET() {
  try {
    const data = await loadChurchData();
    return NextResponse.json({
      overview: runAnalytics(data, { operation: "overview" }),
      ministries: runAnalytics(data, { operation: "ministry_comparison" }),
      trend: runAnalytics(data, { operation: "trend", count: 12 }),
      members: data.members,
      fetchedAt: data.fetchedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dashboard could not be loaded." }, { status: 503 });
  }
}

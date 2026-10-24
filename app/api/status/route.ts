import { NextResponse } from "next/server";
import { connection } from "next/server";
import { configStatus, loadChurchData } from "@/lib/sheets";
import { sundayDates } from "@/lib/attendance";

export async function GET() {
  await connection();
  const config = configStatus();
  if (!config.sheetsConfigured) return NextResponse.json({ ...config, connected: false });
  try {
    const data = await loadChurchData();
    return NextResponse.json({
      ...config, connected: true, members: data.members.length,
      attendanceRecords: data.attendance.length,
      ministries: new Set(data.members.map((member) => member.ministry).filter(Boolean)).size,
      sundays: sundayDates(data).length, fetchedAt: data.fetchedAt,
    });
  } catch (error) {
    return NextResponse.json({ ...config, connected: false, error: error instanceof Error ? error.message : "Google Sheets could not be read." }, { status: 502 });
  }
}

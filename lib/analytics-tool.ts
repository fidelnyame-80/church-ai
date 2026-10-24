import { runAnalytics, type AnalyticsArgs, type AnalyticsResult } from "./attendance";
import { loadChurchData } from "./sheets";

const operations = ["overview", "member_count", "attendance_list", "absent_last_sunday", "consecutive_absences", "ministry_comparison", "top_ministry", "trend", "member_history", "member_search", "ministries"] as const;
export const analyticsTool = {
  type: "function" as const,
  name: "get_church_analytics",
  description: "Retrieve verified First Love Church member, attendance, ministry, and trend analytics from the connected Google Sheet. Use this for every factual church-data answer. Missing submissions are not absences.",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: operations, description: "Use member_count for roster counts. Use attendance_list with status, ministryNames and optional date to list who was present/absent. overview is whole-church statistics." },
      count: { type: "integer", description: "Number of recent Sundays, for trend or consecutive absences. Use 12 for 12 Sundays; use 3 for three consecutive Sundays." },
      memberName: { type: "string", description: "Name, ID, or email for member search or history." },
      ministryNames: { type: "array", items: { type: "string" }, description: "Ministry names to count or compare. Use this to scope member_count to the requested ministry. Omit for all ministries." },
      date: { type: "string", description: "For attendance_list only: service date as YYYY-MM-DD. Omit for the latest recorded Sunday (last Sunday)." },
      status: { type: "string", enum: ["present", "absent", "excused", "unreported", "conflict"], description: "For attendance_list: recorded status to list. Use present for attendees; absent for confirmed absences." },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  strict: false,
};

export function parseAnalyticsArgs(value: unknown): AnalyticsArgs {
  if (!value || typeof value !== "object") throw new Error("Analytics arguments must be an object.");
  const input = value as Record<string, unknown>;
  if (!operations.includes(input.operation as AnalyticsArgs["operation"])) throw new Error("Unknown analytics operation.");
  if (input.date !== undefined && (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date))) throw new Error("Use an ISO service date.");
  if (input.status !== undefined && !["present", "absent", "excused", "unreported", "conflict"].includes(String(input.status))) throw new Error("Unknown attendance status.");
  if ((input.date !== undefined || input.status !== undefined) && input.operation !== "attendance_list") throw new Error("Date and status filters require attendance_list.");
  return {
    operation: input.operation as AnalyticsArgs["operation"],
    count: typeof input.count === "number" ? input.count : undefined,
    memberName: typeof input.memberName === "string" ? input.memberName.slice(0, 120) : undefined,
    ministryNames: Array.isArray(input.ministryNames) ? input.ministryNames.filter((name): name is string => typeof name === "string").slice(0, 20) : undefined,
    date: typeof input.date === "string" ? input.date : undefined,
    status: input.status as AnalyticsArgs["status"],
  };
}
export async function executeAnalytics(value: unknown): Promise<AnalyticsResult> {
  const args = parseAnalyticsArgs(value);
  const data = await loadChurchData();
  return runAnalytics(data, args);
}

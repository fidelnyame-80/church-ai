import { runAnalytics, type AnalyticsArgs, type AnalyticsResult } from "./attendance";
import { loadChurchData } from "./sheets";
import { queryConnectedSheet, type SheetQuery } from "./connected-sheets";

const operations = ["overview", "member_count", "attendance_list", "recent_absences", "absent_last_sunday", "consecutive_absences", "ministry_comparison", "top_ministry", "trend", "member_history", "member_search", "ministries", "query_sheet"] as const;
export const analyticsTool = {
  type: "function" as const,
  name: "get_church_analytics",
  description: "Retrieve verified First Love Church attendance analytics or query an additional Google Sheet connected by the admin. Sonta means ministry/group; 'various Sontas' means all groups. Use this for every factual answer about connected data. Missing attendance submissions are not absences.",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: operations, description: "Use member_count for roster counts; attendance_list for one Sunday; recent_absences with count 2 to list recorded absentees by Sonta on each of the last two Sundays. overview is whole-church statistics." },
      count: { type: "integer", description: "Number of recent recorded Sundays. Use 2 for absentees from the last two Sundays; use 3 for three consecutive absences; use 12 for a trend." },
      memberName: { type: "string", description: "Name, ID, or email for member search or history." },
      ministryNames: { type: "array", items: { type: "string" }, description: "Specific named Sontas from the Members sheet's Ministry / Group column. Omit for all/various Sontas; never pass 'Sonta' or 'Sontas' as a name." },
      date: { type: "string", description: "For attendance_list only: service date as YYYY-MM-DD. Omit for the latest recorded Sunday (last Sunday)." },
      status: { type: "string", enum: ["present", "absent", "excused", "unreported", "conflict"], description: "For attendance_list only: recorded status to list. recent_absences already filters to explicit Absent." },
      spreadsheetId: { type: "string", description: "For query_sheet: one of the additional spreadsheet IDs listed in the system-provided connected schema." },
      worksheet: { type: "string", description: "For query_sheet: exact worksheet title from the connected schema." },
      mode: { type: "string", enum: ["rows", "count", "group_count"], description: "For query_sheet: list matching rows, count matching rows, or count matching rows by a column." },
      filters: { type: "array", items: { type: "object", properties: { column: { type: "string" }, operator: { type: "string", enum: ["equals", "contains", "gt", "gte", "lt", "lte"] }, value: { type: "string" } }, required: ["column", "operator", "value"] }, description: "For query_sheet: up to three exact column filters. Use only header names supplied in connected schema." },
      groupBy: { type: "string", description: "For query_sheet group_count: exact header to count rows by." },
      selectColumns: { type: "array", items: { type: "string" }, description: "For query_sheet rows: exact headers to show. Select only the columns needed to answer." },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  strict: false,
};

export function parseAnalyticsArgs(value: unknown): AnalyticsArgs {
  if (!value || typeof value !== "object") throw new Error("Analytics arguments must be an object.");
  const input = value as Record<string, unknown>;
  if (!operations.includes(input.operation as typeof operations[number]) || input.operation === "query_sheet") throw new Error("Unknown analytics operation.");
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
export async function executeAnalytics(value: unknown, connectedIds: string[] = []): Promise<AnalyticsResult> {
  if (value && typeof value === "object" && (value as Record<string, unknown>).operation === "query_sheet") {
    const input = value as Record<string, unknown>;
    if (typeof input.spreadsheetId !== "string" || typeof input.worksheet !== "string"
      || !["rows", "count", "group_count"].includes(String(input.mode))) throw new Error("Choose a connected spreadsheet, worksheet and query mode.");
    if (input.filters !== undefined && (!Array.isArray(input.filters) || input.filters.length > 3 || !input.filters.every((filter) =>
      filter && typeof filter === "object" && typeof filter.column === "string" && typeof filter.value === "string"
      && ["equals", "contains", "gt", "gte", "lt", "lte"].includes(String(filter.operator))
      && filter.column.length <= 120 && filter.value.length <= 200))) throw new Error("Invalid sheet filters.");
    if (input.selectColumns !== undefined && (!Array.isArray(input.selectColumns) || input.selectColumns.length > 18
      || !input.selectColumns.every((item) => typeof item === "string" && item.length <= 120))) throw new Error("Invalid selected columns.");
    const query: SheetQuery = { spreadsheetId: input.spreadsheetId, worksheet: input.worksheet, mode: input.mode as SheetQuery["mode"],
      filters: input.filters as SheetQuery["filters"], groupBy: typeof input.groupBy === "string" ? input.groupBy.slice(0, 120) : undefined,
      selectColumns: input.selectColumns as string[] | undefined };
    return queryConnectedSheet(connectedIds, query);
  }
  const args = parseAnalyticsArgs(value);
  const data = await loadChurchData();
  return runAnalytics(data, args);
}

import "server-only";
import type { AnalyticsResult, SourceVerification } from "./attendance";
import { googleSheetsAccessToken } from "./sheets";

export type ConnectedWorksheet = { title: string; gid: number; headers: string[] };
export type ConnectedSchema = { id: string; title: string; worksheets: ConnectedWorksheet[] };
export type SheetQuery = {
  spreadsheetId: string; worksheet: string; mode: "rows" | "count" | "group_count";
  filters?: { column: string; operator: "equals" | "contains" | "gt" | "gte" | "lt" | "lte"; value: string }[];
  groupBy?: string; selectColumns?: string[];
};

const schemaCache = new Map<string, { expires: number; value: ConnectedSchema }>();
const dataCache = new Map<string, { expires: number; values: string[][] }>();

function sheetUrl(id: string, gid: number): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit#gid=${gid}`;
}
function quoted(title: string): string { return `'${title.replace(/'/g, "''")}'`; }
function normalized(value: string): string { return value.toLocaleLowerCase().trim(); }

async function sheetsGet(url: URL): Promise<Response> {
  const token = await googleSheetsAccessToken();
  return fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
}

export async function loadConnectedSchema(id: string): Promise<ConnectedSchema> {
  const cached = schemaCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "properties.title,sheets.properties(sheetId,title)");
  const response = await sheetsGet(url);
  if (!response.ok) throw new Error(response.status === 404 ? "The service account cannot access that spreadsheet. Share it as Viewer and check its URL." : `Google Sheets could not open that spreadsheet (${response.status}).`);
  const metadata = await response.json() as { properties?: { title?: string }; sheets?: { properties?: { title?: string; sheetId?: number } }[] };
  const tabs = (metadata.sheets ?? []).flatMap((item) => typeof item.properties?.title === "string" && typeof item.properties.sheetId === "number"
    ? [{ title: item.properties.title, gid: item.properties.sheetId }] : []);
  if (!tabs.length || tabs.length > 20) throw new Error("The spreadsheet must have between 1 and 20 worksheets.");
  const headersUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchGet`);
  for (const tab of tabs) headersUrl.searchParams.append("ranges", `${quoted(tab.title)}!A1:AZ1`);
  headersUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const headerResponse = await sheetsGet(headersUrl);
  if (!headerResponse.ok) throw new Error(`Google Sheets could not read worksheet headers (${headerResponse.status}).`);
  const headerPayload = await headerResponse.json() as { valueRanges?: { values?: unknown[][] }[] };
  const schema: ConnectedSchema = { id, title: metadata.properties?.title?.slice(0, 160) || "Untitled spreadsheet", worksheets: tabs.map((tab, index) => ({
    ...tab, headers: (headerPayload.valueRanges?.[index]?.values?.[0] ?? []).map((header) => String(header).slice(0, 120)),
  })) };
  schemaCache.set(id, { value: schema, expires: Date.now() + 300_000 });
  return schema;
}

export async function loadConnectedSchemas(ids: string[]): Promise<ConnectedSchema[]> {
  const results = await Promise.allSettled(ids.map(loadConnectedSchema));
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

function columnIndex(headers: string[], requested: string): number {
  const matches = headers.flatMap((header, index) => normalized(header) === normalized(requested) ? [index] : []);
  if (matches.length !== 1) throw new Error(matches.length ? `Column "${requested}" is ambiguous.` : `Column "${requested}" was not found.`);
  return matches[0];
}

function compare(actual: string, operator: NonNullable<SheetQuery["filters"]>[number]["operator"], expected: string): boolean {
  if (operator === "equals") return normalized(actual) === normalized(expected);
  if (operator === "contains") return normalized(actual).includes(normalized(expected));
  const left = Number(actual.replace(/,/g, "")), right = Number(expected.replace(/,/g, ""));
  if (!actual.trim() || !expected.trim() || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  return operator === "gt" ? left > right : operator === "gte" ? left >= right : operator === "lt" ? left < right : left <= right;
}

export async function queryConnectedSheet(allowedIds: string[], query: SheetQuery): Promise<AnalyticsResult> {
  if (!allowedIds.includes(query.spreadsheetId)) throw new Error("That spreadsheet is not connected in this session.");
  if (!query.worksheet || !["rows", "count", "group_count"].includes(query.mode)) throw new Error("Choose a worksheet and query mode.");
  if ((query.filters?.length ?? 0) > 3) throw new Error("Use at most three filters.");
  const schema = await loadConnectedSchema(query.spreadsheetId);
  const tab = schema.worksheets.find((item) => item.title === query.worksheet);
  if (!tab) throw new Error("That worksheet was not found. Check the connected worksheet titles.");
  const cacheKey = `${schema.id}:${tab.gid}`;
  let values = dataCache.get(cacheKey)?.expires && dataCache.get(cacheKey)!.expires > Date.now() ? dataCache.get(cacheKey)!.values : undefined;
  if (!values) {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(schema.id)}/values/${encodeURIComponent(`${quoted(tab.title)}!A1:AZ2001`)}`);
    url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
    const response = await sheetsGet(url);
    if (!response.ok) throw new Error(`Google Sheets could not read that worksheet (${response.status}).`);
    const payload = await response.json() as { values?: unknown[][] };
    values = (payload.values ?? []).map((row) => row.map((cell) => String(cell ?? "")));
    dataCache.set(cacheKey, { values, expires: Date.now() + 30_000 });
  }
  const headers = values[0] ?? [];
  if (!headers.length) throw new Error("The worksheet needs a header row in row 1.");
  const filters = (query.filters ?? []).map((filter) => ({ ...filter, index: columnIndex(headers, filter.column) }));
  const matches = values.slice(1).flatMap((row, index) => row.some((cell) => cell.trim()) && filters.every((filter) => compare(row[filter.index] ?? "", filter.operator, filter.value))
    ? [{ row, sheetRow: index + 2 }] : []);
  const sourceUrl = sheetUrl(schema.id, tab.gid);
  const range = `A1:AZ${Math.max(1, values.length)}`;
  const verification: SourceVerification = { fetchedAt: new Date().toISOString(),
    calculation: `Read up to the first 2,000 data rows in ${tab.title}; apply ${filters.length} exact column filter(s) before ${query.mode === "group_count" ? "counting rows by group" : query.mode === "count" ? "counting rows" : "listing matching rows"}.`,
    filters: filters.map((filter) => `${filter.column} ${filter.operator} ${filter.value}`), dates: [],
    sheets: [{ title: `${schema.title} / ${tab.title}`, url: sourceUrl, headers,
      ranges: [{ label: range, url: `${sourceUrl}&range=${encodeURIComponent(range)}` }], rowCount: matches.length }],
  };
  const result: AnalyticsResult = { operation: "query_sheet", title: `${schema.title} · ${tab.title}`,
    summary: `${matches.length} matching ${matches.length === 1 ? "row" : "rows"} in ${tab.title}.`,
    columns: [], rows: [], notes: [], sources: [`${schema.title} / ${tab.title}`], fetchedAt: verification.fetchedAt, verification };
  if (values.length >= 2001) result.notes.push("Only the first 2,000 data rows were scanned; more rows may exist.");
  if (query.mode === "count") {
    result.columns = [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }];
    result.rows = [{ metric: "Matching rows", value: matches.length }];
  } else if (query.mode === "group_count") {
    if (!query.groupBy) throw new Error("Choose a groupBy column.");
    const index = columnIndex(headers, query.groupBy);
    const counts = new Map<string, number>();
    for (const item of matches) { const key = item.row[index] || "(blank)"; counts.set(key, (counts.get(key) ?? 0) + 1); }
    result.columns = [{ key: "group", label: query.groupBy }, { key: "count", label: "Rows" }];
    result.rows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([group, count]) => ({ group, count }));
    result.summary = `${matches.length} matching rows across ${counts.size} ${query.groupBy} values.`;
    if (counts.size > 50) result.notes.push("Showing the 50 largest groups.");
  } else {
    const selected = query.selectColumns?.length ? query.selectColumns.map((name) => columnIndex(headers, name)) : headers.map((_, index) => index);
    const active = [...new Set(selected)].slice(0, 18).flatMap((index) => headers[index] ? [{ key: `c${index}`, label: headers[index] }] : []);
    result.columns = [{ key: "sheetRow", label: "Sheet row" }, ...active];
    result.rows = matches.slice(0, 30).map((item) => Object.fromEntries([["sheetRow", item.sheetRow], ...active.map((column) => [column.key, (item.row[Number(column.key.slice(1))] ?? "").slice(0, 160)])]));
    if (matches.length > 30) result.notes.push("Showing the first 30 matching rows.");
    if (selected.length > 18) result.notes.push("Showing the first 18 selected columns.");
  }
  return result;
}

export type AttendanceStatus = "present" | "absent" | "excused" | "unreported" | "conflict";
export type Member = { id: string; name: string; ministry: string; email: string; sourceRow?: number };
export type AttendanceRecord = {
  timestamp: string; email: string; date: string; serviceType: string;
  ministry: string; name: string; status: AttendanceStatus; rawStatus: string; sourceRow?: number;
};
export type ChurchData = { members: Member[]; attendance: AttendanceRecord[]; fetchedAt: string; sourceSheets?: Record<string, { url: string; headers: string[] }> };
export type SourceVerification = {
  fetchedAt: string; calculation: string; filters: string[]; dates: string[];
  sheets: { title: string; url?: string; headers: string[]; ranges: { label: string; url?: string }[]; rowCount: number }[];
};
export type TableColumn = { key: string; label: string };
export type ChartData = { type: "bar" | "line"; labels: string[]; series: { name: string; values: number[] }[]; unit: string };
export type AnalyticsResult = {
  operation: string; title: string; summary: string;
  columns: TableColumn[]; rows: Record<string, string | number>[];
  chart?: ChartData; notes: string[]; sources: string[];
  fetchedAt: string; verification?: SourceVerification;
};
export type AnalyticsArgs = {
  operation: "overview" | "member_count" | "attendance_list" | "absent_last_sunday" | "consecutive_absences" | "ministry_comparison" | "top_ministry" | "trend" | "member_history" | "member_search" | "ministries";
  count?: number; memberName?: string; ministryNames?: string[]; date?: string; status?: AttendanceStatus;
};

function clean(value: unknown): string { return String(value ?? "").trim(); }
function normalize(value: string): string { return value.toLowerCase().trim().replace(/\s+/g, " "); }
function columnsToObjects(rows: unknown[][]): { values: Record<string, string>; sourceRow: number }[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((value) => normalize(clean(value)));
  return body.flatMap((row, index) => row.some((value) => clean(value)) ? [{
    values: Object.fromEntries(keys.map((key, column) => [key, clean(row[column])])), sourceRow: index + 2,
  }] : []);
}
export function normalizeDate(value: string): string {
  const text = clean(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  const numeric = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (numeric) {
    const day = Number(numeric[1]), month = Number(numeric[2]), year = Number(numeric[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}
export function normalizeStatus(value: string): AttendanceStatus {
  const status = normalize(value);
  if (["present", "attended", "here", "yes"].includes(status)) return "present";
  if (["absent", "missed", "no"].includes(status)) return "absent";
  if (["excused", "approved absence"].includes(status)) return "excused";
  return "unreported";
}
export function parseChurchData(memberRows: unknown[][], responseRows: unknown[][], fetchedAt = new Date().toISOString()): ChurchData {
  const members = columnsToObjects(memberRows).map(({ values: row, sourceRow }) => ({
    id: row["member id"] ?? "", name: row["full name"] ?? "",
    ministry: row["ministry / group"] ?? "", email: row["demo email"] ?? "", sourceRow,
  })).filter((member) => member.name);
  const attendance = columnsToObjects(responseRows).map(({ values: row, sourceRow }) => ({
    timestamp: row.timestamp ?? "", email: row["email address"] ?? "",
    date: normalizeDate(row["service date"] ?? ""), serviceType: row["service type"] ?? "",
    ministry: row["ministry / group"] ?? "", name: row["full name"] ?? "",
    status: normalizeStatus(row["attendance status"] ?? ""), rawStatus: row["attendance status"] ?? "", sourceRow,
  })).filter((record) => record.date && (record.name || record.email));
  return { members, attendance, fetchedAt };
}
export function sundayDates(data: ChurchData): string[] {
  return [...new Set(data.attendance.filter((record) =>
    record.serviceType.toLowerCase().includes("sunday") || new Date(record.date + "T12:00:00Z").getUTCDay() === 0
  ).map((record) => record.date))].sort();
}
function matchesMember(record: AttendanceRecord, member: Member, uniqueName: boolean): boolean {
  const memberEmail = normalize(member.email), recordEmail = normalize(record.email);
  if (memberEmail && recordEmail && memberEmail === recordEmail) return true;
  return uniqueName && normalize(record.name) === normalize(member.name);
}
export function statusFor(data: ChurchData, member: Member, date: string): AttendanceStatus {
  const uniqueName = data.members.filter((entry) => normalize(entry.name) === normalize(member.name)).length === 1;
  const statuses = data.attendance.filter((record) => record.date === date && matchesMember(record, member, uniqueName)).map((record) => record.status);
  if (statuses.includes("present") && statuses.includes("absent")) return "conflict";
  if (statuses.includes("present")) return "present";
  if (statuses.includes("absent")) return "absent";
  if (statuses.includes("excused")) return "excused";
  return "unreported";
}
function countsFor(data: ChurchData, members: Member[], dates: string[]) {
  const counts = { present: 0, absent: 0, excused: 0, unreported: 0, conflict: 0 };
  for (const date of dates) for (const member of members) counts[statusFor(data, member, date)]++;
  return counts;
}
function rate(present: number, absent: number): number {
  return present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : 0;
}
function base(data: ChurchData, operation: string, title: string, summary: string): AnalyticsResult {
  return { operation, title, summary, columns: [], rows: [], notes: [
    "Only explicit Present and Absent statuses count toward attendance rate. Missing submissions are unreported, never confirmed absences.",
  ], sources: ["Members", "Form Responses 1"], fetchedAt: data.fetchedAt };
}
function ministryNames(data: ChurchData): string[] {
  return [...new Set(data.members.map((member) => member.ministry).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function resolveMinistries(data: ChurchData, requestedNames?: string[]): { names: string[]; error?: string } {
  const available = ministryNames(data);
  const matched = new Set<string>();
  for (const requestedName of (requestedNames ?? []).map((name) => name.trim()).filter(Boolean)) {
    const exact = available.filter((name) => normalize(name) === normalize(requestedName));
    const matches = exact.length ? exact : available.filter((name) => normalize(name).includes(normalize(requestedName)));
    if (matches.length !== 1) return { names: [], error: matches.length
      ? `Which ministry do you mean? Matching ministries: ${matches.join(", ")}.`
      : `I couldn't find a ministry named "${requestedName}" in the member roster.` };
    matched.add(matches[0]);
  }
  return { names: [...matched] };
}

function sourceVerification(data: ChurchData, args: AnalyticsArgs, result: AnalyticsResult): SourceVerification {
  const allDates = sundayDates(data);
  const count = Math.min(Math.max(Math.floor(args.count || 3), 1), 52);
  const rosterOnly = args.operation === "member_count" || args.operation === "member_search";
  const scope = resolveMinistries(data, args.ministryNames);
  let members = scope.error ? [] : data.members.filter((member) => !scope.names.length || scope.names.includes(member.ministry));
  const filters = scope.names.length ? ["Ministry / Group = " + scope.names.join("; ")] : [];
  if (args.operation === "member_search" || args.operation === "member_history") {
    const query = normalize(args.memberName ?? "");
    members = members.filter((member) => query && (normalize(member.name).includes(query) || normalize(member.id) === query || normalize(member.email) === query));
    filters.push("Member lookup = " + (args.memberName ?? ""));
  }
  let dates = rosterOnly ? [] : allDates;
  if (args.operation === "trend" || args.operation === "consecutive_absences") dates = allDates.slice(-count);
  if (args.operation === "attendance_list" || args.operation === "absent_last_sunday") {
    dates = [args.date ?? allDates.at(-1) ?? ""].filter(Boolean);
    filters.push("Service Date = " + (dates[0] ?? "unavailable"));
    filters.push("Recorded status = " + (args.operation === "absent_last_sunday" ? "absent" : args.status ?? "present"));
    if (!args.date) filters.push("Last Sunday means the latest recorded Sunday in this sheet.");
  }
  const attendance = rosterOnly ? [] : data.attendance.filter((record) => dates.includes(record.date)
    && members.some((member) => matchesMember(record, member, data.members.filter((entry) => normalize(entry.name) === normalize(member.name)).length === 1)));
  function sheet(title: string, sourceRows: (number | undefined)[], lastColumn: string): SourceVerification["sheets"][number] {
    const rows = [...new Set(sourceRows.filter((row): row is number => row !== undefined))].sort((a, b) => a - b);
    const groups: { first: number; last: number }[] = [];
    for (const row of rows) {
      const previous = groups.at(-1);
      if (previous && previous.last + 1 === row) previous.last = row;
      else groups.push({ first: row, last: row });
    }
    const source = data.sourceSheets?.[title];
    return { title, url: source?.url, headers: source?.headers ?? [], rowCount: rows.length,
      ranges: groups.map(({ first, last }) => {
        const range = `A${first}:${lastColumn}${last}`;
        return { label: range, url: source?.url ? source.url + "&range=" + encodeURIComponent(range) : undefined };
      }),
    };
  }
  const sheets = [sheet("Members", members.map((member) => member.sourceRow), "D")];
  if (!rosterOnly) sheets.push(sheet("Form Responses 1", attendance.map((record) => record.sourceRow), "G"));
  const calculation = args.operation === "member_count" ? "Count the matching member rows in Members; attendance submissions are not used."
    : args.operation === "member_search" ? "Match member name, ID, or email in Members."
    : "Sunday totals use distinct Service Date values, not columns. Match attendance to roster members by email or unique name; conflicting statuses are excluded. Attendance rate = Present / (Present + Absent). Missing submissions stay unreported.";
  return { fetchedAt: result.fetchedAt, calculation, filters, dates, sheets };
}

export function runAnalytics(data: ChurchData, args: AnalyticsArgs): AnalyticsResult {
  const result = calculateAnalytics(data, args);
  return { ...result, verification: sourceVerification(data, args, result) };
}
function calculateAnalytics(data: ChurchData, args: AnalyticsArgs): AnalyticsResult {
  const dates = sundayDates(data);
  const latest = dates.at(-1) ?? "";
  const requested = Math.min(Math.max(Math.floor(args.count || 3), 1), 52);
  switch (args.operation) {
    case "attendance_list": {
      const date = args.date ?? latest;
      const status = args.status ?? "present";
      const result = base(data, args.operation, "Recorded attendance", "");
      result.notes = [];
      const scope = resolveMinistries(data, args.ministryNames);
      if (scope.error) { result.summary = scope.error; return result; }
      if (!date || !dates.includes(date)) { result.summary = date ? `No Sunday attendance records are available for ${date}.` : "No Sunday attendance dates found."; return result; }
      const members = data.members.filter((member) => !scope.names.length || scope.names.includes(member.ministry));
      result.rows = members.filter((member) => statusFor(data, member, date) === status).map((member) => ({ name: member.name, ministry: member.ministry, date, status }));
      result.columns = [{ key: "name", label: "Member" }, { key: "ministry", label: "Ministry" }, { key: "date", label: "Service date" }, { key: "status", label: "Recorded status" }];
      result.summary = `${result.rows.length} ${scope.names.length ? scope.names.join(" and ") + " " : ""}${result.rows.length === 1 ? "member" : "members"} recorded ${status} on Sunday ${date}.`;
      return result;
    }
    case "member_count": {
      const result = base(data, args.operation, "Member count", "");
      result.notes = [];
      result.sources = ["Members"];
      result.columns = [{ key: "ministry", label: "Ministry" }, { key: "members", label: "Members" }];
      const requestedNames = (args.ministryNames ?? []).map((name) => name.trim()).filter(Boolean);
      if (!requestedNames.length) {
        result.rows = [{ ministry: "All ministries", members: data.members.length }];
        result.summary = `There are ${data.members.length} members in the church roster.`;
        return result;
      }
      const available = ministryNames(data);
      const matched = new Set<string>();
      for (const requestedName of requestedNames) {
        const exact = available.filter((name) => normalize(name) === normalize(requestedName));
        const matches = exact.length ? exact : available.filter((name) => normalize(name).includes(normalize(requestedName)));
        if (matches.length !== 1) {
          result.summary = matches.length ? `Which ministry do you mean? Matching ministries: ${matches.join(", ")}.` : `I couldn't find a ministry named "${requestedName}" in the member roster.`;
          return result;
        }
        matched.add(matches[0]);
      }
      result.rows = [...matched].map((ministry) => ({ ministry, members: data.members.filter((member) => member.ministry === ministry).length }));
      result.summary = result.rows.map((row) => `${row.ministry} has ${row.members} ${row.members === 1 ? "member" : "members"}.`).join(" ");
      return result;
    }
    case "overview": {
      const counts = latest ? countsFor(data, data.members, [latest]) : countsFor(data, [], []);
      const result = base(data, args.operation, "Church overview", latest ? "Latest Sunday: " + latest : "No Sunday attendance dates found.");
      result.rows = [
        { metric: "Members", value: data.members.length }, { metric: "Ministries", value: ministryNames(data).length },
        { metric: "Sundays recorded", value: dates.length }, { metric: "Present last Sunday", value: counts.present },
        { metric: "Explicitly absent last Sunday", value: counts.absent }, { metric: "Unreported last Sunday", value: counts.unreported },
        { metric: "Attendance rate last Sunday", value: rate(counts.present, counts.absent) + "%" },
      ];
      result.columns = [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }];
      return result;
    }
    case "absent_last_sunday": {
      const result = base(data, args.operation, "Explicit absences last Sunday", latest ? "Sunday " + latest : "No Sunday attendance date found.");
      result.rows = latest ? data.members.filter((member) => statusFor(data, member, latest) === "absent").map((member) => ({ name: member.name, ministry: member.ministry, date: latest })) : [];
      result.columns = [{ key: "name", label: "Member" }, { key: "ministry", label: "Ministry" }, { key: "date", label: "Service date" }];
      const unreported = latest ? data.members.filter((member) => statusFor(data, member, latest) === "unreported").length : 0;
      result.notes.push(unreported + " member(s) have no usable status for this Sunday.");
      return result;
    }
    case "consecutive_absences": {
      const selected = dates.slice(-requested);
      const result = base(data, args.operation, "Explicit absences across consecutive Sundays", selected.length ? selected[0] + " to " + selected.at(-1) : "No Sunday dates found.");
      result.rows = selected.length === requested ? data.members.filter((member) => selected.every((date) => statusFor(data, member, date) === "absent")).map((member) => ({ name: member.name, ministry: member.ministry, sundays: requested })) : [];
      result.columns = [{ key: "name", label: "Member" }, { key: "ministry", label: "Ministry" }, { key: "sundays", label: "Consecutive Sundays" }];
      if (selected.length < requested) result.notes.push("Only " + selected.length + " Sunday date(s) are available; no consecutive-absence claim was made.");
      return result;
    }
    case "ministry_comparison":
    case "top_ministry":
    case "ministries": {
      const requestedNames = (args.ministryNames ?? []).map(normalize);
      const names = ministryNames(data).filter((name) => !requestedNames.length || requestedNames.some((requestedName) => normalize(name).includes(requestedName)));
      const result = base(data, args.operation, args.operation === "top_ministry" ? "Ministry attendance ranking" : "Ministry attendance comparison", "Across " + dates.length + " recorded Sundays.");
      result.rows = names.map((name) => {
        const members = data.members.filter((member) => member.ministry === name);
        const counts = countsFor(data, members, dates);
        return { ministry: name, members: members.length, present: counts.present, absent: counts.absent, unreported: counts.unreported, rate: rate(counts.present, counts.absent) };
      }).sort((a, b) => Number(b.rate) - Number(a.rate));
      result.columns = [{ key: "ministry", label: "Ministry" }, { key: "members", label: "Members" }, { key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "unreported", label: "Unreported" }, { key: "rate", label: "Rate %" }];
      result.chart = { type: "bar", labels: result.rows.map((row) => String(row.ministry)), series: [{ name: "Attendance rate", values: result.rows.map((row) => Number(row.rate)) }], unit: "%" };
      if (args.operation === "top_ministry" && result.rows.length) result.summary = "Highest reported attendance rate: " + result.rows[0].ministry + " (" + result.rows[0].rate + "%).";
      return result;
    }
    case "trend": {
      const selected = dates.slice(-Math.min(requested, dates.length));
      const result = base(data, args.operation, "Sunday attendance trend", selected.length ? selected[0] + " to " + selected.at(-1) : "No Sunday dates found.");
      result.rows = selected.map((date) => {
        const counts = countsFor(data, data.members, [date]);
        return { date, present: counts.present, absent: counts.absent, unreported: counts.unreported, rate: rate(counts.present, counts.absent) };
      });
      result.columns = [{ key: "date", label: "Sunday" }, { key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "unreported", label: "Unreported" }, { key: "rate", label: "Rate %" }];
      result.chart = { type: "line", labels: selected, series: [{ name: "Present", values: result.rows.map((row) => Number(row.present)) }, { name: "Explicitly absent", values: result.rows.map((row) => Number(row.absent)) }], unit: "people" };
      return result;
    }
    case "member_history":
    case "member_search": {
      const query = normalize(args.memberName ?? "");
      const found = query ? data.members.filter((member) => normalize(member.name).includes(query) || normalize(member.id) === query || normalize(member.email) === query) : [];
      const result = base(data, args.operation, args.operation === "member_history" ? "Member attendance history" : "Member search", found.length === 1 ? found[0].name : found.length + " matching members.");
      if (args.operation === "member_search" || found.length !== 1) {
        result.rows = found.map((member) => ({ id: member.id, name: member.name, ministry: member.ministry, email: member.email }));
        result.columns = [{ key: "id", label: "ID" }, { key: "name", label: "Member" }, { key: "ministry", label: "Ministry" }, { key: "email", label: "Email" }];
      } else {
        result.rows = dates.map((date) => ({ date, status: statusFor(data, found[0], date) }));
        result.columns = [{ key: "date", label: "Sunday" }, { key: "status", label: "Recorded status" }];
      }
      return result;
    }
  }
}

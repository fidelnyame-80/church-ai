import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseChurchData, runAnalytics, statusFor, sundayDates } from "./attendance";

const members = [
  ["Member ID", "Full Name", "Ministry / Group", "Demo Email"],
  ["M1", "Ama Mensah", "Choir", "ama@example.test"],
  ["M2", "Kojo Agyeman", "Ushers", "kojo@example.test"],
  ["M3", "Esi Owusu", "Choir", "esi@example.test"],
];
const header = ["Timestamp", "Email Address", "Service Date", "Service Type", "Ministry / Group", "Full Name", "Attendance Status"];
function row(date: string, name: string, status: string, email = "") {
  return ["", email, date, "Sunday Service", "", name, status];
}

describe("attendance calculations", () => {
  test("counts distinct row dates rather than columns or submissions", () => {
    const data = parseChurchData(members, [header,
      row("04/10/2026", "Ama Mensah", "Present"), row("04/10/2026", "Kojo Agyeman", "Absent"),
      row("11/10/2026", "Ama Mensah", "Present"),
    ]);
    assert.equal(header.length, 7);
    assert.deepEqual(sundayDates(data), ["2026-10-04", "2026-10-11"]);
    assert.equal(runAnalytics(data, { operation: "overview" }).rows.find((item) => item.metric === "Sundays recorded")?.value, 2);
  });
  test("lists confirmed attendees for the requested ministry and service date", () => {
    const data = parseChurchData(members, [header,
      row("11/10/2026", "Esi Owusu", "Present"),
      row("18/10/2026", "Ama Mensah", "Present"), row("18/10/2026", "Kojo Agyeman", "Present"),
      row("18/10/2026", "Esi Owusu", "Absent"),
    ]);
    const args = { operation: "attendance_list", ministryNames: ["Choir"], status: "present" } as const;
    const result = runAnalytics(data, { ...args, ministryNames: [...args.ministryNames] });
    assert.deepEqual(result.rows.map((item) => item.name), ["Ama Mensah"]);
    assert.match(result.summary, /2026-10-18/);
    assert.deepEqual(result.verification?.dates, ["2026-10-18"]);
    assert.deepEqual(runAnalytics(data, { operation: "attendance_list", ministryNames: ["Choir"], date: "2026-10-11", status: "present" }).rows.map((item) => item.name), ["Esi Owusu"]);
    assert.equal(runAnalytics(data, { operation: "attendance_list", ministryNames: ["Unknown"], status: "present" }).rows.length, 0);
  });
  test("source links retain original sheet row numbers across blank and rejected rows", () => {
    const data = parseChurchData([members[0], [], members[1], ["M0", "", "Choir", ""], members[2]],
      [header, [], row("18/10/2026", "Ama Mensah", "Present")]);
    data.sourceSheets = { Members: { url: "https://docs.google.com/spreadsheets/d/test/edit#gid=7", headers: members[0] } };
    const count = runAnalytics(data, { operation: "member_count", ministryNames: ["Choir"] });
    assert.deepEqual(count.verification?.sheets[0].ranges, [{ label: "A3:D3", url: "https://docs.google.com/spreadsheets/d/test/edit#gid=7&range=A3%3AD3" }]);
    const attendance = runAnalytics(data, { operation: "attendance_list", status: "present" });
    assert.deepEqual(attendance.verification?.sheets[1].ranges.map((range) => range.label), ["A3:G3"]);
  });
  test("ministry member counts use the roster and do not depend on attendance submissions", () => {
    const data = parseChurchData(members, []);
    const result = runAnalytics(data, { operation: "member_count", ministryNames: ["choir"] });
    assert.deepEqual(result.rows, [{ ministry: "Choir", members: 2 }]);
    assert.equal(result.summary, "Choir has 2 members.");
    assert.deepEqual(result.sources, ["Members"]);
    assert.deepEqual(result.notes, []);
    assert.equal(runAnalytics(data, { operation: "member_count", ministryNames: ["Ushers"] }).summary, "Ushers has 1 member.");
  });
  test("unknown and ambiguous ministry names do not become a whole-church count", () => {
    const data = parseChurchData([...members, ["M4", "Abena", "Children Choir", ""]], []);
    const missing = runAnalytics(data, { operation: "member_count", ministryNames: ["Unknown"] });
    assert.deepEqual(missing.rows, []);
    assert.match(missing.summary, /couldn't find/);
    const ambiguous = runAnalytics(data, { operation: "member_count", ministryNames: ["cho"] });
    assert.deepEqual(ambiguous.rows, []);
    assert.match(ambiguous.summary, /Which Sonta/);
    assert.equal(runAnalytics(data, { operation: "member_count", ministryNames: ["Choir"] }).rows[0].members, 2);
  });
  test("missing submissions stay unreported and do not become absences", () => {
    const data = parseChurchData(members, [header, row("04/10/2026", "Ama Mensah", "Present", "ama@example.test"), row("04/10/2026", "Kojo Agyeman", "Absent")]);
    assert.equal(data.attendance[0].date, "2026-10-04");
    assert.equal(statusFor(data, data.members[2], "2026-10-04"), "unreported");
    const overview = runAnalytics(data, { operation: "overview" });
    assert.equal(overview.rows.find((item) => item.metric === "Unreported last Sunday")?.value, 1);
    assert.equal(overview.rows.find((item) => item.metric === "Attendance rate last Sunday")?.value, "50%");
  });
  test("lists explicit absences for each of the latest two recorded Sundays by Sonta", () => {
    const data = parseChurchData(members, [header,
      row("04/10/2026", "Ama Mensah", "Absent"),
      row("11/10/2026", "Ama Mensah", "Absent"),
      row("11/10/2026", "Kojo Agyeman", "Present"),
      row("18/10/2026", "Kojo Agyeman", "Absent"),
      row("18/10/2026", "Esi Owusu", "Absent"),
      row("18/10/2026", "Esi Owusu", "Present"),
    ]);
    const result = runAnalytics(data, { operation: "recent_absences", ministryNames: ["various sontas"] });
    assert.deepEqual(result.rows, [
      { date: "2026-10-18", sonta: "Ushers", name: "Kojo Agyeman" },
      { date: "2026-10-11", sonta: "Choir", name: "Ama Mensah" },
    ]);
    assert.deepEqual(result.verification?.dates, ["2026-10-11", "2026-10-18"]);
    assert.equal(result.verification?.sheets[1].rowCount, 2);
    assert.match(result.summary, /2 recorded absences across 2 Sundays/);
    assert.equal(runAnalytics(data, { operation: "member_count", ministryNames: ["sontas"] }).rows[0].members, 3);
  });

  test("three consecutive Sundays requires three explicit Absent statuses", () => {
    const data = parseChurchData(members, [header,
      row("04/10/2026", "Ama Mensah", "Absent"), row("11/10/2026", "Ama Mensah", "Absent"), row("18/10/2026", "Ama Mensah", "Absent"),
      row("04/10/2026", "Kojo Agyeman", "Absent"), row("11/10/2026", "Kojo Agyeman", "Absent"),
      row("18/10/2026", "Esi Owusu", "Present"),
    ]);
    const result = runAnalytics(data, { operation: "consecutive_absences", count: 3 });
    assert.deepEqual(result.rows.map((item) => item.name), ["Ama Mensah"]);
    assert.deepEqual(runAnalytics(data, { operation: "absent_last_sunday" }).rows.map((item) => item.name), ["Ama Mensah"]);
  });

  test("contradictory statuses are excluded from attendance rates", () => {
    const data = parseChurchData(members, [header,
      row("18/10/2026", "Ama Mensah", "Present"), row("18/10/2026", "Ama Mensah", "Absent"),
      row("18/10/2026", "Kojo Agyeman", "Absent"),
    ]);
    assert.equal(statusFor(data, data.members[0], "2026-10-18"), "conflict");
    const overview = runAnalytics(data, { operation: "overview" });
    assert.equal(overview.rows.find((item) => item.metric === "Attendance rate last Sunday")?.value, "0%");
  });
});

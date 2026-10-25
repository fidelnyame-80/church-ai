import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseChurchData, runAnalytics, type AnalyticsResult } from "./attendance";
import { formatQuickAnswer, getLocalReply, getQuickQuery } from "./quick-answer";

describe("local product help", () => {
  test("answers greetings and capabilities without making church data claims", () => {
    assert.match(getLocalReply("  What can you do? ")!, /retrieve member records/);
    assert.match(getLocalReply("HELP")!, /connected Google Sheet/);
    assert.match(getLocalReply("Hello!")!, /Ask me/);
    assert.equal(getLocalReply("okay"), "Okay. What would you like to check next?");
    for (const question of ["Hi, how many members?", "What can you do for the choir?", "Help compare October attendance"])
      assert.equal(getLocalReply(question), null);
  });
});

describe("deterministic question selection", () => {
  test("retrieves a named ministry count without overview statistics", () => {
    for (const question of ["How many members are in Culinary Stars?", "how many members does the culinary stars havve", "how many members in culinary stars"]) {
      assert.deepEqual(getQuickQuery(question, true), { operation: "member_count", ministryNames: ["culinary stars"] });
    }
  });
  test("retrieves the scoped attendee list shown in the reported failure", () => {
    assert.deepEqual(getQuickQuery("give me a list of those present in church for only dancing stars last sunday", true),
      { operation: "attendance_list", ministryNames: ["dancing stars"], status: "present" });
    assert.deepEqual(getQuickQuery("Who was present in Dancing Stars last Sunday?", false),
      { operation: "attendance_list", ministryNames: ["dancing stars"], status: "present" });
    assert.equal(getQuickQuery("list those present in Dancing Stars and Choir last Sunday", false), null);
  });
  test("routes the user's two-Sunday Sonta absence request to verified analytics", () => {
    assert.deepEqual(getQuickQuery("list absentees from last two weeks sunday for the various sontas", true),
      { operation: "recent_absences", count: 2 });
  });
  test("uses conversation context to repair a one-Sunday answer instead of repeating it after okay", () => {
    const earlier = [
      { role: "user", content: "list absentees from last two weeks sunday for the various sontas" },
      { role: "assistant", content: "15 members absent on Sunday 2026-10-18." },
    ];
    assert.deepEqual(getQuickQuery("i asked for last two sundays", true, earlier), { operation: "recent_absences", count: 2 });
    const correction = [...earlier, { role: "user", content: "i asked for last two sundays" }, { role: "assistant", content: "15 members absent on Sunday 2026-10-18." }];
    assert.deepEqual(getQuickQuery("okay", true, correction), { operation: "recent_absences", count: 2 });
    const repaired = [...correction, { role: "assistant", content: "2026-10-11 and 2026-10-18 were checked." }];
    assert.equal(getQuickQuery("okay", true, repaired), null);
    assert.equal(getQuickQuery("i asked for last two sundays", true, [{ role: "user", content: "show me last two weeks of giving" }]), null);
  });
  test("routes exact suggestion prompts to supported calculations", () => {
    const questions = [
      ["Who missed the last three Sunday services?", { operation: "consecutive_absences", count: 3 }],
      ["Compare attendance across all ministries.", { operation: "ministry_comparison" }],
      ["Which ministry has the highest attendance rate?", { operation: "top_ministry" }],
      ["Show attendance trends over the past 12 Sundays.", { operation: "trend", count: 12 }],
    ] as const;
    for (const [question, expected] of questions) {
      assert.deepEqual(getQuickQuery(question, false), expected);
      assert.deepEqual(getQuickQuery(question, true), expected);
    }
  });

  test("routes total roster counts, last Sunday absences, and ministry lists", () => {
    for (const question of ["How many members in total are there?", "How many members in total are in the church?", "How many members are in the church roster?", "How many members do we have in total?"])
      assert.deepEqual(getQuickQuery(question, true), { operation: "member_count" });
    assert.deepEqual(getQuickQuery("Who was absent last Sunday?", false), { operation: "absent_last_sunday" });
    assert.deepEqual(getQuickQuery("Who missed last Sunday?", false), { operation: "absent_last_sunday" });
    assert.deepEqual(getQuickQuery("List all ministries", true), { operation: "ministries" });
  });

  test("keeps abbreviated questions on the model when earlier context could scope them", () => {
    for (const question of ["How many members?", "How many members are there?", "total members", "List ministries", "Who was absent last Sunday?"]) {
      assert.notEqual(getQuickQuery(question, false), null, question);
      assert.equal(getQuickQuery(question, true), null, question);
    }
    for (const question of ["How many are there?", "What about them?", "And last week?", "Compare those ministries"])
      assert.equal(getQuickQuery(question, true), null, question);
  });

  test("never drops date filters, ministry scopes, or a second requested operation", () => {
    const questions = [
      "How many members joined in October?",
      "How many members in total are in the choir?",
      "How many members are in the church roster as of January 2026?",
      "How many members are in the church roster? Also show attendance.",
      "Compare attendance across all ministries in September.",
      "Compare attendance across all ministries and list absences.",
      "Which ministry has the highest attendance rate last Sunday?",
      "Show attendance trends over the past 12 Sundays for Choir.",
      "Who missed the last three Sunday services in October?",
      "Who was absent last Sunday and why?",
      "Who was absent on 2026-10-18?",
      "List ministries with attendance under 50%.",
    ];
    for (const question of questions) for (const prior of [false, true])
      assert.equal(getQuickQuery(question, prior), null, question);
  });
});

describe("verified quick answer formatting", () => {
  test("takes the member count from the live-shaped result rather than fixed text", () => {
    for (const count of [0, 2, 55]) {
      const rows = Array.from({ length: count }, (_, index) => [`M${index}`, `Member ${index}`, "Choir", ""]);
      const data = parseChurchData([["Member ID", "Full Name", "Ministry / Group", "Demo Email"], ...rows], []);
      const result = runAnalytics(data, { operation: "overview" });
      assert.equal(formatQuickAnswer(result), `There are ${count} members in the church roster.`);
    }
  });

  test("does not invent a member count from another metric or malformed result", () => {
    const result: AnalyticsResult = {
      operation: "overview", title: "Church overview", summary: "Verified summary.",
      columns: [], rows: [{ metric: "Ministries", value: 55 }], notes: [], sources: [], fetchedAt: "",
    };
    assert.equal(formatQuickAnswer(result), "Church overview: Verified summary.");
    result.rows = [{ metric: "Members", value: Number.NaN }];
    assert.equal(formatQuickAnswer(result), "Church overview: Verified summary.");
  });

  test("retains dates and missing-data warnings in other analytics answers", () => {
    const data = parseChurchData([["Member ID", "Full Name", "Ministry / Group", "Demo Email"], ["M1", "Ama", "Choir", ""]], []);
    const result = runAnalytics(data, { operation: "consecutive_absences", count: 3 });
    const answer = formatQuickAnswer(result);
    assert.match(answer, /No Sunday dates found/);
    assert.match(answer, /no consecutive-absence claim was made/);
    assert.match(answer, /Missing submissions are unreported/);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { wantsAnalyticsDisplay } from "./chat-presentation";

test("simple factual questions do not request analytics cards", () => {
  for (const question of ["How many members are in Culinary Stars?", "How many members does the church have?", "Which ministry has the highest attendance rate?", "Who was absent last Sunday?"]) {
    assert.equal(wantsAnalyticsDisplay(question), false, question);
  }
});
test("explicit charts, comparisons, trends and reports still show results", () => {
  for (const question of ["Compare attendance across all ministries.", "Show attendance trends over the past 12 Sundays.", "Show that as a table.", "Give me a church overview.", "Generate a ministry report."]) {
    assert.equal(wantsAnalyticsDisplay(question), true, question);
  }
});
test("requests for a plain answer override chart keywords", () => {
  for (const question of ["Compare them without charts.", "No analytics, just the count.", "Don't show a table; just answer.", "Report the number only, without any charts."]) {
    assert.equal(wantsAnalyticsDisplay(question), false, question);
  }
});

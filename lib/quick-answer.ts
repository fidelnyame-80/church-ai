import type { AnalyticsArgs, AnalyticsResult } from "./attendance";

function normalize(question: string): string {
  return question.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

/** Fixed product help needs neither spreadsheet data nor a provider request. */
export function getLocalReply(question: string): string | null {
  const text = normalize(question);
  if (/^(?:ok|okay|alright|got it)$/.test(text)) return "Okay. What would you like to check next?";
  if (/^(?:thanks|thank you)$/.test(text)) return "You're welcome.";
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)$/.test(text)) {
    return "Hello. Ask me about church members, attendance, Sontas, or Sunday attendance trends.";
  }
  if (/^(?:help|what can you do|what do you do|how can you help(?: me)?)$/.test(text)) {
    return "I can retrieve member records, find recorded absences, compare Sonta attendance, and show Sunday attendance trends from your connected Google Sheet. Try asking: “How many members are in the church roster?” Missing submissions are treated as unreported.";
  }
  return null;
}

type QuickRule = { pattern: RegExp; args: AnalyticsArgs; standalone: boolean };

// Full matches deliberately exclude added dates, named ministries, and compound questions.
const rules: QuickRule[] = [
  {
    pattern: /^how many members (?:are (?:registered )?in|are there in|do we have in|in) (?:the |our )?(?:church|church roster|roster)(?: in total)?$/,
    args: { operation: "member_count" }, standalone: true,
  },
  {
    pattern: /^how many members in total(?: (?:are there|do we have|are (?:registered )?in (?:the |our )?(?:church|church roster|roster)))?$/,
    args: { operation: "member_count" }, standalone: true,
  },
  {
    pattern: /^how many (?:registered )?members(?: (?:are there|do we have|are registered))? in total$/,
    args: { operation: "member_count" }, standalone: true,
  },
  {
    pattern: /^(?:how many (?:registered )?members(?: (?:are there|do we have|are registered))?|total (?:number of )?members)$/,
    args: { operation: "member_count" }, standalone: false,
  },
  {
    pattern: /^who missed the last (?:three|3) sunday services$/,
    args: { operation: "consecutive_absences", count: 3 }, standalone: true,
  },
  {
    pattern: /^compare attendance across all (?:ministries|sontas)$/,
    args: { operation: "ministry_comparison" }, standalone: true,
  },
  {
    pattern: /^which (?:ministry|sonta) has the highest attendance rate$/,
    args: { operation: "top_ministry" }, standalone: true,
  },
  {
    pattern: /^show attendance trends over the past (?:12|twelve) sundays$/,
    args: { operation: "trend", count: 12 }, standalone: true,
  },
  {
    pattern: /^(?:who (?:was absent|missed(?: the)?(?: service)?) last sunday|(?:list|show) (?:the )?(?:members )?(?:absent|absences) last sunday)$/,
    args: { operation: "absent_last_sunday" }, standalone: false,
  },
  {
    pattern: /^(?:(?:list|show) all (?:church )?(?:ministries|sontas)|(?:what|which) (?:ministries|sontas) are in (?:the|our) church)$/,
    args: { operation: "ministries" }, standalone: true,
  },
  {
    pattern: /^(?:(?:list|show) (?:the )?(?:ministries|sontas)|(?:what|which) (?:ministries|sontas) (?:are there|do we have))$/,
    args: { operation: "ministries" }, standalone: false,
  },
];

/** Select only supported, complete questions; leave interpretation to the model. */
export function getQuickQuery(question: string, hasPriorUserMessage: boolean, context: { role: string; content: string }[] = []): AnalyticsArgs | null {
  const text = normalize(question);
  const earlierUsers = context.filter((message) => message.role === "user");
  const absenceContext = earlierUsers.some((message) => /\b(?:absentees?|absent|absences|missed)\b/i.test(message.content));
  const lastUser = normalize(earlierUsers.at(-1)?.content ?? "");
  const lastAssistant = context.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
  const asksForTwoSundays = /\b(?:last|past) (?:two|2) (?:weeks'? )?sundays?\b/.test(text);
  const acknowledgesIncompleteCorrection = /^(?:ok|okay|alright|got it)$/.test(text)
    && /\b(?:last|past) (?:two|2) (?:weeks'? )?sundays?\b/.test(lastUser)
    && new Set(lastAssistant.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []).size < 2;
  if (absenceContext && (asksForTwoSundays || acknowledgesIncompleteCorrection)
    && (asksForTwoSundays && /^(?:i (?:asked|said|meant|wanted) (?:for )?|i need (?:the )?|the )?(?:last|past) (?:two|2) (?:weeks'? )?sundays?\b/.test(text)
      || acknowledgesIncompleteCorrection)) return { operation: "recent_absences", count: 2 };
  if (/^(?:(?:list|show)(?: me)?|give me (?:a |the )?list of) (?:the )?(?:absentees|absent members|members absent|those absent) (?:from|for|in|across) (?:the )?last (?:two|2) (?:weeks'? )?sundays? (?:for|across|in|by) (?:the )?(?:various|all|each|different) (?:sontas|ministries|groups)$/.test(text)
    || /^(?:(?:list|show)(?: me)?|give me (?:a |the )?list of) (?:the )?(?:absentees|absent members|members absent|those absent) by (?:sonta|ministry|group) (?:for|from|in) (?:the )?last (?:two|2) (?:weeks'? )?sundays?$/.test(text)) {
    return { operation: "recent_absences", count: 2 };
  }
  const match = rules.find((rule) => (!hasPriorUserMessage || rule.standalone) && rule.pattern.test(text));
  if (match) return { ...match.args };
  const attendanceList = text.match(/^(?:(?:give me (?:a |the )?list of|list|show(?: me)?|who (?:was|were)) (?:the )?(?:members|those|people)?\s*(?:who (?:was|were) )?)(present|absent)(?: in church)? (?:for|from|in) (?:only )?(.+?) last sunday$/);
  if (attendanceList) {
    const ministry = attendanceList[2].replace(/^the\s+/, "").replace(/\s+(?:ministry|group)$/, "").trim();
    if (ministry && ministry.length <= 100 && !/\b(?:and|or|with|where|since|this|previous|month|year)\b|[?;:]|\d{4}/.test(ministry)) {
      return { operation: "attendance_list", ministryNames: [ministry], status: attendanceList[1] as "present" | "absent" };
    }
  }
  const scopedCount = text.match(/^how many (?:registered )?members (?:are(?: there)? in|in) (.+)$/)
    ?? text.match(/^how many (?:registered )?members (?:does|do) (.+?) hav+e$/);
  if (!scopedCount) return null;
  const ministry = scopedCount[1].replace(/^the\s+/, "").replace(/\s+(?:ministry|group)$/, "").trim();
  if (!ministry || ministry.length > 100 || /\b(?:and|or|with|where|total|last|sunday|present|absent|attendance|as of|since|this|previous|month|year)\b|[?;:]|\d{4}/.test(ministry)) return null;
  return { operation: "member_count", ministryNames: [ministry] };
}

/** Answer using only the result calculated from the connected spreadsheet. */
export function formatQuickAnswer(result: AnalyticsResult): string {
  if (result.operation === "member_count") return result.summary;
  if (result.operation === "recent_absences") {
    const lines = [result.summary];
    let previousDate = "", previousSonta = "";
    for (const row of result.rows) {
      const date = String(row.date), sonta = String(row.sonta);
      if (date !== previousDate) { lines.push("", `Sunday ${date}`); previousDate = date; previousSonta = ""; }
      if (sonta !== previousSonta) { lines.push(`${sonta}:`); previousSonta = sonta; }
      lines.push(`• ${row.name}`);
    }
    return lines.join("\n");
  }
  if (result.operation === "attendance_list" || result.operation === "absent_last_sunday") {
    const names = result.rows.map((row) => String(row.name));
    return names.length ? result.summary + "\n\n" + names.map((name) => "• " + name).join("\n") : result.summary;
  }
  if (result.operation === "overview") {
    const members = result.rows.find((row) => row.metric === "Members")?.value;
    if (typeof members === "number" && Number.isFinite(members) && members >= 0) {
      return `There are ${members} members in the church roster.`;
    }
  }
  const answer = [result.title, result.summary].filter(Boolean).join(": ");
  return [answer, ...new Set(result.notes.filter(Boolean))].filter(Boolean).join("\n\n");
}

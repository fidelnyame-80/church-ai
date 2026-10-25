/** Verified tool results are evidence; visual cards are shown only when requested. */
export function wantsAnalyticsDisplay(question: string): boolean {
  const text = question.toLowerCase().replace(/[’]/g, "'");
  if (/\b(?:no|without)\s+(?:any\s+)?(?:charts?|graphs?|tables?|reports?|analytics)\b/.test(text)
    || /\b(?:don't|do not)\s+(?:show|include|display)\b/.test(text)
    || /\b(?:just|only)\s+(?:the\s+)?(?:answer|number|count|text)\b/.test(text)) return false;
  if (/\b(?:list|show|give me a list of)\b/.test(text)
    && /\b(?:absentees?|absent members|members absent)\b/.test(text)
    && /\b(?:two|2)\b/.test(text)
    && /\b(?:sontas?|ministries|groups|sundays?|weeks?)\b/.test(text)) return true;
  return /\b(?:charts?|graphs?|plots?|tables?|reports?|dashboard|trends?|compare|comparison|breakdown|analytics|overview)\b/.test(text);
}

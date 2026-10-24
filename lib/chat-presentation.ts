/** Verified tool results are evidence; visual cards are shown only when requested. */
export function wantsAnalyticsDisplay(question: string): boolean {
  const text = question.toLowerCase().replace(/[’]/g, "'");
  if (/\b(?:no|without)\s+(?:any\s+)?(?:charts?|graphs?|tables?|reports?|analytics)\b/.test(text)
    || /\b(?:don't|do not)\s+(?:show|include|display)\b/.test(text)
    || /\b(?:just|only)\s+(?:the\s+)?(?:answer|number|count|text)\b/.test(text)) return false;
  return /\b(?:charts?|graphs?|plots?|tables?|reports?|dashboard|trends?|compare|comparison|breakdown|analytics|overview)\b/.test(text);
}

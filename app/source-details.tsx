import type { SourceVerification } from "@/lib/attendance";

export function SourceDetails({ sources }: { sources?: SourceVerification[] }) {
  if (!sources?.length) return null;
  return <details className="source-details">
    <summary>Check source</summary>
    <div className="source-details-body">{sources.map((source, index) => <section key={index}>
      <p>{source.calculation}</p>
      {source.filters.length > 0 && <p>{source.filters.join(" · ")}</p>}
      {source.dates.length > 0 && <p><strong>{source.dates.length} distinct service {source.dates.length === 1 ? "date" : "dates"}:</strong> {source.dates.join(", ")}</p>}
      {source.sheets.map((sheet) => <div className="source-sheet" key={sheet.title}>
        <p><strong>{sheet.url ? <a href={sheet.url} target="_blank" rel="noopener noreferrer">{sheet.title}</a> : sheet.title}</strong> · {sheet.rowCount} source rows inspected</p>
        {sheet.headers.length > 0 && <p>Columns: {sheet.headers.join(" · ")}</p>}
        <div className="source-row-links">{sheet.ranges.map((range) => range.url
          ? <a key={range.label} href={range.url} target="_blank" rel="noopener noreferrer">{range.label}</a>
          : <span key={range.label}>{range.label}</span>)}</div>
      </div>)}
      <p className="source-updated">Read from Google Sheets: {new Date(source.fetchedAt).toLocaleString()}</p>
    </section>)}</div>
  </details>;
}

"use client";

import { useMemo, useState } from "react";
import type { AnalyticsResult } from "@/lib/attendance";

export function AnalyticsVisual({ result }: { result: AnalyticsResult }) {
  const [view, setView] = useState<"chart" | "table">(result.chart ? "chart" : "table");
  const [hovered, setHovered] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState("");
  const [descending, setDescending] = useState(false);
  const rows = useMemo(() => {
    if (!sortKey) return result.rows;
    return [...result.rows].sort((a, b) => {
      const left = a[sortKey], right = b[sortKey];
      const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return descending ? -order : order;
    });
  }, [result.rows, sortKey, descending]);
  const chart = result.chart;
  const count = chart?.labels.length ?? 0;
  const max = chart ? Math.max(1, ...chart.series.flatMap((series) => series.values)) : 1;
  const linePoints = chart?.series.map((series) => series.values.map((value, index) => ({
    x: 72 + (count > 1 ? index * (670 / (count - 1)) : 335),
    y: 235 - (value / max) * 188,
  }))) ?? [];

  return <section className="analytics-card" aria-label={result.title}>
    <div className="analytics-top"><div><span className="analytics-kicker">LIVE SHEET ANALYTICS</span><h3>{result.title}</h3><p>{result.summary}</p></div>{chart && <div className="analytics-toggle" role="group" aria-label="Result view"><button className={view === "chart" ? "selected" : ""} onClick={() => setView("chart")}>Chart</button><button className={view === "table" ? "selected" : ""} onClick={() => setView("table")}>Table</button></div>}</div>
    {view === "chart" && chart ? <>
      <div className="chart-selected">{hovered === null ? "Hover or focus a data point for details" : <><strong>{chart.labels[hovered]}</strong><span>{chart.series.map((series) => series.name + ": " + series.values[hovered] + chart.unit).join(" · ")}</span></>}</div>
      <div className="chart-scroll">
        {chart.type === "bar" ? <svg className="data-chart bar-chart" role="img" aria-label={result.title + " bar chart"} viewBox={"0 0 800 " + Math.max(210, count * 45 + 40)} preserveAspectRatio="xMinYMin meet">
          {chart.labels.map((label, index) => {
            const value = chart.series[0]?.values[index] ?? 0;
            return <g key={label} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} tabIndex={0} aria-label={label + ": " + value + chart.unit}>
              <text x="8" y={index * 45 + 31} className="chart-label">{label.length > 28 ? label.slice(0, 27) + "…" : label}</text>
              <rect x="258" y={index * 45 + 11} width="470" height="27" rx="6" fill="#edf0e9" />
              <rect x="258" y={index * 45 + 11} width={Math.max(2, (value / Math.max(max, chart.unit === "%" ? 100 : max)) * 470)} height="27" rx="6" fill={hovered === index ? "#a15f3f" : "#b77d58"} />
              <text x="740" y={index * 45 + 31} className="chart-value">{value}{chart.unit}</text>
            </g>;
          })}
        </svg> : <svg className="data-chart line-chart" role="img" aria-label={result.title + " line chart"} viewBox="0 0 800 300">
          {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1="72" x2="742" y1={235 - fraction * 188} y2={235 - fraction * 188} stroke="#dfe5dc" /><text x="55" y={240 - fraction * 188} textAnchor="end" className="axis-label">{Math.round(max * fraction)}</text></g>)}
          {linePoints.map((series, seriesIndex) => <g key={chart.series[seriesIndex].name}><polyline fill="none" stroke={seriesIndex === 0 ? "#b77d58" : "#708f78"} strokeWidth="4" strokeLinejoin="round" points={series.map((point) => point.x + "," + point.y).join(" ")} />{series.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={hovered === index ? 8 : 6} fill={seriesIndex === 0 ? "#b77d58" : "#708f78"} stroke="#fff" strokeWidth="2" tabIndex={0} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} aria-label={chart.labels[index] + ": " + chart.series[seriesIndex].values[index] + " " + chart.series[seriesIndex].name} />)}</g>)}
          {chart.labels.map((label, index) => <text key={label} x={72 + (count > 1 ? index * (670 / (count - 1)) : 335)} y="270" textAnchor="middle" className="axis-label">{label.slice(5)}</text>)}
        </svg>}
      </div>
      <div className="chart-legend">{chart.series.map((series, index) => <span key={series.name}><i className={index === 0 ? "legend-primary" : "legend-secondary"} />{series.name}</span>)}</div>
    </> : <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr>{result.columns.map((column) => <th key={column.key}><button onClick={() => { setDescending(sortKey === column.key ? !descending : false); setSortKey(column.key); }}>{column.label}{sortKey === column.key ? descending ? " ↓" : " ↑" : ""}</button></th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td key={column.key}>{row[column.key] ?? "—"}</td>)}</tr>) : <tr><td colSpan={result.columns.length}>No matching records were found.</td></tr>}</tbody></table></div>}
    <div className="analytics-footer"><span>Source: {result.sources.join(" + ")}</span><span>Updated {new Date(result.fetchedAt).toLocaleString()}</span></div>
    {result.notes.map((note, index) => <p className="analytics-note" key={index}>{note}</p>)}
  </section>;
}

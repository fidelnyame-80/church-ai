"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnalyticsVisual } from "./analytics-visual";
import { SheetConnections } from "./sheet-connections";
import { SourceDetails } from "./source-details";
import type { AnalyticsResult, Member, SourceVerification } from "@/lib/attendance";
import { readChatStream } from "@/lib/chat-stream";
import { useGroqVoice } from "./use-groq-voice";

type IconName = "ask" | "overview" | "members" | "ministries" | "reports" | "settings" | "plus" | "mic" | "up" | "arrow" | "menu" | "close" | "volume" | "upload" | "stop";
function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    ask: <><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4.1-1L3 20l1.1-4.2A8.5 8.5 0 1 1 20 11.5Z" /><path d="M8 11.5h7M8 15h4.5" /></>,
    overview: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
    members: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3ZM17 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1h-3" /></>,
    ministries: <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 7v5M12 12l-7 4M12 12l7 4" /></>,
    reports: <><path d="M4 20h16M6 16V9m6 7V4m6 12v-5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    mic: <><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" /></>,
    up: <path d="M12 20V4m-6.5 6.5L12 4l6.5 6.5" />,
    arrow: <path d="M4 12h16m-7-7 7 7-7 7" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M5 5 19 19M19 5 5 19" />,
    volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" /></>,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Page = "ask" | "overview" | "members" | "ministries" | "reports" | "settings";
type Message = { role: "user" | "assistant"; content: string; visualizations?: AnalyticsResult[]; sources?: SourceVerification[] };
type Thread = { id: string; title: string; messages: Message[] };
type Status = { connected: boolean; sheetsConfigured: boolean; grokConfigured: boolean; missing: string[]; members?: number; attendanceRecords?: number; ministries?: number; sundays?: number; fetchedAt?: string; error?: string };
type Dashboard = { overview: AnalyticsResult; ministries: AnalyticsResult; trend: AnalyticsResult; members: Member[]; fetchedAt: string };
type RecognitionResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: RecognitionResult) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type VoiceWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const nav: { id: Page; label: string; icon: IconName }[] = [
  { id: "ask", label: "Ask AI", icon: "ask" },
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "members", label: "Members", icon: "members" },
  { id: "ministries", label: "Sontas", icon: "ministries" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "settings", label: "Settings", icon: "settings" },
];
const suggestions = [
  "Who missed the last three Sunday services?",
  "Compare attendance across all Sontas.",
  "Which Sonta has the highest attendance rate?",
  "Show attendance trends over the past 12 Sundays.",
];

export default function Home() {
  const [page, setPage] = useState<Page>("ask");
  const [threads, setThreads] = useState<Thread[]>([{ id: "initial", title: "New conversation", messages: [] }]);
  const [activeId, setActiveId] = useState("initial");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Checking church records…");
  const [status, setStatus] = useState<Status | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { state: voiceState, phase: voicePhase, error: voiceError, transcript: voiceTranscript, analytics: voiceAnalytics, start: startVoice, stop: endVoice, setError: setVoiceError } = useGroqVoice();
  const [dictating, setDictating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const activeThread = threads.find((thread) => thread.id === activeId) ?? threads[0];

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not check the Google Sheets connection.");
        const current = await response.json() as Status;
        if (cancelled) return;
        setStatus(current);
        if (current.connected) {
          const dashResponse = await fetch("/api/dashboard", { cache: "no-store" });
          if (!dashResponse.ok) throw new Error("Could not load the live dashboard.");
          const data = await dashResponse.json() as Dashboard;
          if (!cancelled) {
            setDashboard(data);
            setDashboardError("");
          }
        } else {
          setDashboard(null);
        }
      } catch (error) {
        if (!cancelled) setDashboardError(error instanceof Error ? error.message : "Connection failed.");
      } finally {
        loading = false;
      }
    }
    function refreshOnFocus() {
      if (document.visibilityState === "visible") void load();
    }
    load();
    const interval = window.setInterval(load, 30000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [activeThread.messages.length, busy]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [page]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("voice") !== "1") return;
    const frame = requestAnimationFrame(() => setVoiceOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!voiceOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { endVoice(); setVoiceOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [voiceOpen, endVoice]);
  useEffect(() => () => {
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);

  function newConversation() {
    const id = String(Date.now());
    setThreads((current) => [{ id, title: "New conversation", messages: [] }, ...current]);
    setActiveId(id); setDraft(""); setPage("ask"); setMenuOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }
  function selectPage(next: Page) { setPage(next); setMenuOpen(false); }
  async function ask(question = draft) {
    const text = question.trim();
    if (!text || busy) return;
    const history = activeThread.messages;
    const nextMessages: Message[] = [...history, { role: "user", content: text }];
    setThreads((current) => current.map((thread) => thread.id === activeId ? { ...thread, title: thread.messages.length ? thread.title : text.slice(0, 42), messages: nextMessages } : thread));
    setPage("ask"); setDraft(""); setBusy(true); setBusyLabel("Checking church records…");
    let reply: Message = { role: "assistant", content: "", visualizations: [] };
    function updateReply(change: Partial<Message>) {
      reply = { ...reply, ...change };
      const currentReply = reply;
      setThreads((current) => current.map((thread) => thread.id === activeId ? { ...thread, messages: [...nextMessages, currentReply] } : thread));
    }
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ messages: nextMessages.map(({ role, content }) => ({ role, content })) }) });
      if (response.ok && response.headers.get("content-type")?.includes("application/x-ndjson")) {
        if (!response.body) throw new Error("The answer connection was interrupted. Please try again.");
        let text = "";
        await readChatStream(response.body, (event) => {
          if (event.type === "status") setBusyLabel(event.message);
          else if (event.type === "analytics") {
            updateReply({ content: text || "Here are the verified results. Preparing the summary…", visualizations: [...(reply.visualizations ?? []), event.result] });
            setBusyLabel("Preparing the answer…");
          } else if (event.type === "text") {
            text += event.delta;
            updateReply({ content: text });
            setBusyLabel("Writing the answer…");
          } else if (event.type === "done") updateReply({ content: event.answer, visualizations: event.visualizations, sources: event.sources });
        });
        return;
      }
      const payload = await response.json() as { answer?: string; visualizations?: AnalyticsResult[]; sources?: SourceVerification[]; error?: string; missing?: string[] };
      if (!response.ok) throw new Error(payload.missing?.length ? "Configuration needed: " + payload.missing.join(", ") : payload.error || "Request failed.");
      updateReply({ content: payload.answer || "No verified answer was returned.", visualizations: payload.visualizations, sources: payload.sources });
    } catch (error) {
      const verified = reply.visualizations ?? [];
      updateReply({ content: verified.length
        ? verified.map((result) => [result.title, result.summary].filter(Boolean).join(": ")).join("\n\n") + "\n\nThe written summary was interrupted. The verified results are shown below."
        : error instanceof Error ? error.message : "Church AI could not complete this request." });
    } finally { setBusy(false); }
  }
  function dictate() {
    if (dictating) { recognitionRef.current?.stop(); setDictating(false); return; }
    const browser = window as VoiceWindow;
    const SpeechRecognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceError("Voice dictation is unavailable in this browser."); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US"; recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = (event) => setDraft(Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" "));
    recognition.onerror = () => setDictating(false);
    recognition.onend = () => setDictating(false);
    recognitionRef.current = recognition;
    recognition.start(); setDictating(true);
  }
  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = .94;
    window.speechSynthesis.speak(utterance);
  }
  function exportReport(result: AnalyticsResult, name: string) {
    const rows = [result.columns.map((column) => column.label), ...result.rows.map((row) => result.columns.map((column) => String(row[column.key] ?? "")))];
    const csv = rows.map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  }
  const filteredMembers = dashboard?.members.filter((member) => [member.name, member.id, member.ministry, member.email].some((value) => value.toLowerCase().includes(memberFilter.toLowerCase()))) ?? [];

  return <div className="app-shell">
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={"sidebar" + (menuOpen ? " sidebar-open" : "")}>
      <div className="sidebar-top"><div className="brand"><span className="brand-mark"><span /></span><span className="brand-name">Church AI<span>.</span></span></div><button className="sidebar-close icon-button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close" size={26} /></button></div>
      <div className="church-identity">FIRST LOVE CHURCH<span>New Gbawe · Sonta</span></div>
      <button className="new-chat-button" onClick={newConversation}><Icon name="plus" size={25} />New Conversation</button>
      <nav className="main-nav" aria-label="Main navigation"><div className="nav-heading">WORKSPACE</div>{nav.map((item) => <button key={item.id} className={"nav-item" + (page === item.id ? " active" : "")} onClick={() => selectPage(item.id)} aria-current={page === item.id ? "page" : undefined}><Icon name={item.icon} size={23} />{item.label}</button>)}</nav>
      <div className="sidebar-recent"><div className="nav-heading">RECENT AI CONVERSATIONS</div>{threads.filter((thread) => thread.messages.length).slice(0, 5).map((thread) => <button className={"recent-item" + (thread.id === activeId ? " recent-active" : "")} key={thread.id} onClick={() => { setActiveId(thread.id); setPage("ask"); setMenuOpen(false); }}><span className="recent-dot" />{thread.title}</button>)}{!threads.some((thread) => thread.messages.length) && <p>Your conversations will appear here.</p>}</div>
      <div className="sidebar-bottom"><div className="sidebar-divider" /><div className="sidebar-note"><span className="note-icon"><Icon name="reports" size={21} /></span><span>Attendance & Sonta<br />intelligence</span></div></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" size={27} /></button><span className="topbar-label">First Love Church</span><span className="topbar-separator">/</span><span className="topbar-current">{nav.find((item) => item.id === page)?.label}</span></div><div className="topbar-right"><span className={"status-dot" + (status?.connected ? "" : " empty")} />{status?.connected ? "Google Sheets connected" : "Data connection needed"}</div></header>
      <main className={"workspace" + (page === "ask" ? " ai-workspace" : " data-workspace")}>
        {page === "ask" ? <>
          {activeThread.messages.length ? <div className="chat-thread"><div className="conversation-header"><div><p className="eyebrow">CHURCH AI CONVERSATION</p><h1>{activeThread.title}</h1></div></div><div className="message-list" aria-live="polite">{activeThread.messages.map((message, index) => <div className={"message-row " + message.role} key={index}><span className="message-avatar">{message.role === "user" ? "You" : "AI"}</span><div className="message-content"><p>{message.content.replace(/\*\*/g, "")}</p>{message.role === "assistant" && <button className="speak-button" onClick={() => speak(message.content)}><Icon name="volume" size={21} />Listen</button>}{message.role === "assistant" && <SourceDetails sources={message.sources} />}{message.visualizations?.map((result, resultIndex) => <AnalyticsVisual key={resultIndex} result={result} />)}</div></div>)}{busy && <div className="thinking"><span className="thinking-mark">AI</span>{busyLabel}</div>}<div ref={endRef} /></div></div> : <div className="welcome-view"><section className="intro-section"><div className="intro-copy"><p className="eyebrow"><span className="eyebrow-line" />INTELLIGENT CHURCH ANALYTICS</p><h1>What would you like to know about your church?</h1><p className="intro-description">Explore attendance, understand Sonta performance, and uncover insights from your church data.</p></div><aside className="source-card" aria-label="Data connection"><div className="source-card-top">LIVE DATA <span className={"source-card-dot" + (status?.connected ? "" : " offline")} /></div><div className="source-card-number">{status?.connected ? String(status.attendanceRecords ?? 0) : "—"}</div><p>attendance records</p><div className="source-card-bottom">{status?.connected ? String(status.members ?? 0) + " members · " + String(status.ministries ?? 0) + " Sontas" : "Connect Google Sheets in Settings"}</div></aside></section><section className="starter-section" aria-labelledby="starter-heading"><div className="section-heading-row"><h2 id="starter-heading">Start with a question</h2><span>Every answer is grounded in your records.</span></div><div className="suggestion-grid">{suggestions.map((question, index) => <button className="suggestion-card" key={question} onClick={() => ask(question)} disabled={busy}><span className="suggestion-number">0{index + 1}</span><strong>{question}</strong><Icon name="arrow" size={24} /></button>)}</div></section></div>}
          <section className="composer-section" aria-label="Ask Church AI"><div className="composer"><label className="sr-only" htmlFor="question">Ask Church AI</label><textarea id="question" ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="Ask about attendance, members, or Sontas..." rows={2} /><div className="composer-actions"><div className="voice-actions"><button className={"voice-trigger" + (dictating ? " dictating" : "")} onClick={dictate} aria-label={dictating ? "Stop dictation" : "Dictate a question"}><Icon name="mic" size={28} /><span>{dictating ? "Listening…" : "Dictate"}</span></button><button className="voice-mode-button" onClick={() => setVoiceOpen(true)}><Icon name="volume" size={24} />Voice mode</button></div><button className="send-button" onClick={() => ask()} disabled={!draft.trim() || busy}><span>Ask AI</span><Icon name="up" size={23} /></button></div></div><p className="composer-footnote">Attendance figures come from recorded submissions. Missing entries are never treated as confirmed absences.</p></section>
        </> : <div className="data-page">
          <div className="data-page-heading"><p className="eyebrow"><span className="eyebrow-line" />FIRST LOVE CHURCH · NEW GBAWE · SONTA</p><h1>{page === "overview" ? "Church at a glance" : page === "members" ? "Member directory" : page === "ministries" ? "Sonta performance" : page === "reports" ? "Attendance reports" : "Settings & connection"}</h1><p>{page === "overview" ? "A clear view of the latest attendance and your Sonta community." : page === "members" ? "Find members and see the Sonta they belong to." : page === "ministries" ? "Compare participation across every Sonta." : page === "reports" ? "Explore trends and export the figures behind them." : "Manage the connection to your church attendance data."}</p></div>
          {!dashboard && page !== "settings" ? <div className="data-empty"><Icon name="reports" size={32} /><h2>Live data is not available yet.</h2><p>{dashboardError || status?.error || "Add the Google Sheets credentials in .env.local to load your church records."}</p><button onClick={() => selectPage("settings")}>View setup<Icon name="arrow" size={22} /></button></div> : null}
          {page === "overview" && dashboard && <><div className="stat-grid">{dashboard.overview.rows.slice(0, 6).map((row) => <div className="stat-card" key={String(row.metric)}><span>{row.metric}</span><strong>{row.value}</strong></div>)}</div><div className="report-stack"><AnalyticsVisual result={dashboard.trend} /><AnalyticsVisual result={dashboard.ministries} /></div></>}
          {page === "members" && dashboard && <div className="directory-panel"><div className="directory-top"><h2>{filteredMembers.length} members</h2><input value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)} placeholder="Search name, ID, Sonta, or email" aria-label="Search members" /></div><div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>Member ID</th><th>Full name</th><th>Sonta</th><th>Demo email</th></tr></thead><tbody>{filteredMembers.map((member) => <tr key={member.id || member.email}><td>{member.id}</td><td><button className="member-link" onClick={() => { selectPage("ask"); ask("Show " + member.name + "'s attendance history."); }}>{member.name}</button></td><td>{member.ministry}</td><td>{member.email}</td></tr>)}</tbody></table></div></div>}
          {page === "ministries" && dashboard && <AnalyticsVisual result={dashboard.ministries} />}
          {page === "reports" && dashboard && <div className="report-stack"><div className="report-heading"><h2>Sunday attendance trend</h2><button onClick={() => exportReport(dashboard.trend, "attendance-trend.csv")}><Icon name="upload" size={20} />Export CSV</button></div><AnalyticsVisual result={dashboard.trend} /><div className="report-heading"><h2>Sonta comparison</h2><button onClick={() => exportReport(dashboard.ministries, "sonta-comparison.csv")}><Icon name="upload" size={20} />Export CSV</button></div><AnalyticsVisual result={dashboard.ministries} /></div>}
          {page === "settings" && <div className="settings-grid"><div className="setting-card"><h2>Google Sheets</h2><p>Reads the <strong>Members</strong> and <strong>Form Responses 1</strong> worksheets using the service account shared with the spreadsheet.</p><div className="setting-state"><span className={"status-dot" + (status?.connected ? "" : " empty")} />{status?.connected ? "Connected" : "Not connected"}</div>{status?.error && <p className="setting-error">{status.error}</p>}<dl><div><dt>Members</dt><dd>{status?.members ?? "—"}</dd></div><div><dt>Attendance records</dt><dd>{status?.attendanceRecords ?? "—"}</dd></div><div><dt>Sontas</dt><dd>{status?.ministries ?? "—"}</dd></div><div><dt>Sundays</dt><dd>{status?.sundays ?? "—"}</dd></div></dl></div><div className="setting-card"><h2>Configuration</h2><p>For local use, set these in <code>.env.local</code>. On Vercel, add them as Production environment variables and redeploy.</p><ul><li><code>GOOGLE_SHEET_ID</code></li><li><code>GOOGLE_CLIENT_EMAIL</code></li><li><code>GOOGLE_PRIVATE_KEY</code></li><li><code>AI_PROVIDER=groq</code></li><li><code>GROQ_API_KEY</code></li></ul><p className="setting-detail">The service account must have access to the spreadsheet. Credentials stay on the server.</p></div><SheetConnections /></div>}
        </div>}
      </main>
    </div>
    {voiceOpen && <div className="voice-overlay" role="dialog" aria-modal="true" aria-labelledby="voice-heading">
      <div className="voice-panel">
        <div className="voice-topbar"><span className="voice-brand"><span className="voice-brand-mark">AI</span> Church AI · Groq Voice</span><button className="voice-close icon-button" aria-label="Close voice mode" onClick={() => { endVoice(); setVoiceOpen(false); }}><Icon name="close" size={27} /></button></div>
        <div className="voice-center">
          <p className="voice-eyebrow">YOUR CHURCH RECORDS, IN CONVERSATION</p>
          <h2 id="voice-heading">{voiceState === "connecting" ? "Connecting your microphone…" : voiceState === "idle" ? "Start a voice conversation." : voicePhase === "listening" ? "Ask about your church." : voicePhase === "transcribing" ? "Hearing your question…" : voicePhase === "thinking" ? "Checking your church records…" : "Here’s what I found."}</h2>
          <p className="voice-subtitle">Ask about attendance, members, or Sontas. Pause when you finish, and I’ll look up the records and answer aloud.</p>
          <div className={"voice-orb" + (voiceState === "connected" ? " voice-orb-active" : "")} data-phase={voicePhase} aria-hidden="true"><div className="voice-orb-core" /><div className="voice-orb-ring ring-one" /><div className="voice-orb-ring ring-two" /></div>
          <div className="voice-transcript" aria-live="polite">{voiceError || voiceTranscript || (voiceState === "connected" ? "Listening for your question…" : "Your conversation will appear here.")}</div>
          {voiceError.includes("localhost") && <a className="voice-local-link" href="http://localhost:3000/?voice=1">Open voice on this computer<Icon name="arrow" size={24} /></a>}
          {voiceAnalytics.at(-1) && <div className="voice-result">{voiceAnalytics.at(-1)?.title}: {voiceAnalytics.at(-1)?.summary}</div>}
        </div>
        <div className="voice-controls">{voiceState === "idle" ? <button className="voice-start-button" onClick={startVoice}><Icon name="mic" size={31} />Start conversation</button> : <button className="voice-end-button" onClick={endVoice}><Icon name="stop" size={28} />End conversation</button>}</div>
        <p className="voice-control-hint">Groq voice · Microphone access requires localhost or HTTPS.</p>
      </div>
    </div>}
  </div>;
}

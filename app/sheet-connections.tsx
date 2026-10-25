"use client";

import { useEffect, useState } from "react";

type Sheet = { id: string; title: string; worksheets: { title: string; headers: string[] }[]; error?: string };
type State = { configured: boolean; authenticated: boolean; sheets: Sheet[]; serviceAccountEmail?: string; error?: string };

export function SheetConnections() {
  const [state, setState] = useState<State | null>(null);
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/connections", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not check connected sheets.");
    setState(await response.json() as State);
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connections", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check connected sheets.");
        return response.json() as Promise<State>;
      })
      .then((value) => { if (!cancelled) setState(value); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not check connected sheets."); });
    return () => { cancelled = true; };
  }, []);

  async function action(body: Record<string, string>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not update connected sheets.");
      setPassword("");
      if (body.action === "connect") setUrl("");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update connected sheets."); }
    finally { setBusy(false); }
  }

  return <section className="setting-card extra-sheets" aria-labelledby="additional-sheets-heading">
    <h2 id="additional-sheets-heading">Additional spreadsheets</h2>
    <p>Connect a Google Sheet with any worksheet names. The assistant can inspect its columns, list matching rows, count records, and show grouped analytics.</p>
    {!state ? <p>Checking connections…</p> : !state.configured ? <p className="setting-error">Add <code>CHURCH_AI_ADMIN_PASSWORD</code> to the server environment to enable this connector.</p> : !state.authenticated ? <form className="sheet-connection-form" onSubmit={(event) => { event.preventDefault(); void action({ action: "login", password }); }}>
      <label htmlFor="sheets-password">Admin password</label>
      <div className="sheet-connection-row"><input id="sheets-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={12} /><button disabled={busy || password.length < 12}>Unlock connections</button></div>
      <p className="setting-detail">Only an unlocked browser session can query additional sheets. Your password stays on the server.</p>
    </form> : <>
      <form className="sheet-connection-form" onSubmit={(event) => { event.preventDefault(); void action({ action: "connect", url }); }}>
        <label htmlFor="sheet-url">Google Sheets URL</label>
        <div className="sheet-connection-row"><input id="sheet-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" required /><button disabled={busy || !url.trim()}>Connect sheet</button></div>
      </form>
      <p className="setting-detail">First share the sheet with the service account as a Viewer{state.serviceAccountEmail ? <>: <strong>{state.serviceAccountEmail}</strong></> : "."} Put column names in row 1 of each worksheet.</p>
      {state.sheets.length ? <div className="connected-sheet-list">{state.sheets.map((sheet) => <div className="connected-sheet" key={sheet.id}>
        <div><strong>{sheet.title}</strong><span>{sheet.error || sheet.worksheets.map((tab) => tab.title).join(" · ")}</span></div>
        <button type="button" disabled={busy} onClick={() => void action({ action: "remove", id: sheet.id })}>Remove</button>
      </div>)}</div> : <p>No additional sheets connected in this browser yet.</p>}
      <div className="sheet-connection-bottom"><span>Ask about a connected sheet by its title or worksheet name.</span><button type="button" disabled={busy} onClick={() => void action({ action: "logout" })}>Lock connections</button></div>
    </>}
    {(error || state?.error) && <p className="setting-error" role="alert">{error || state?.error}</p>}
  </section>;
}

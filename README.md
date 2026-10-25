# Church AI

Attendance and ministry intelligence for First Love Church, New Gbawe · Sonta.

## Connect the live spreadsheet

Copy .env.example to .env.local and set:

- GOOGLE_SHEET_ID: the ID between /d/ and /edit in the Google Sheets URL.
- Service account credentials: either GOOGLE_CLIENT_EMAIL plus GOOGLE_PRIVATE_KEY, GOOGLE_APPLICATION_CREDENTIALS pointing to the JSON key, or GOOGLE_SERVICE_ACCOUNT_JSON.
- An AI provider key; see the text chat configuration below.

Keep credentials on the server. The spreadsheet must be shared with the service account. The app reads Members!A:D and Form Responses 1!A:G through the Google Sheets API with read-only scope. Restart the server after changing .env.local.

Run bun install, then bun run dev. Open http://localhost:3000. Settings shows the connection state and actual row counts. No demo figures are substituted when the spreadsheet is unavailable.

## Attendance rules

Member rows provide the directory and ministry roster. Response rows provide service dates and explicit attendance statuses. A missing response is **unreported**, not absent. Conflicting Present and Absent rows for one member and date are **conflict** and excluded from the rate. Attendance rate is Present / (Present + explicit Absent); excused, unreported, and conflict entries are excluded. Ghana-style DD/MM/YYYY dates are parsed day first.

The text assistant uses the selected provider's Chat Completions function calling to request deterministic analytics. It must successfully retrieve analytics before returning an answer. Charts and tables render the calculated results, including worksheet source names and refresh time. Provider failures return an error; they never substitute invented records or silently switch providers.

## Check an answer against the spreadsheet

Simple questions return a direct answer. Charts and tables appear for requested comparisons, trends, reports, and charts. Each factual answer has a collapsed **Check source** section showing the calculation, exact ministry and date filters, original worksheet row ranges, column headers, and read time. Row links open the corresponding tab and cells in Google Sheets; your normal Google sharing permissions still apply.

Attendance is stored as rows, with Service Date in column C and Attendance Status in column G of Form Responses 1. The number of Sundays is the number of distinct service dates, never the number of columns. “Last Sunday” refers to the latest recorded Sunday, and answers state its actual date. Roster counts use Members, independently of attendance submissions. Scoped attendee lists resolve the ministry and date before checking each member's recorded status; conflicting Present and Absent entries do not count as present.

The church calls its ministry/group categories **Sontas**. The spreadsheet still labels this field `Ministry / Group`; its values are the names of individual Sontas. Questions about “various Sontas” cover every group. A request for absentees from the last two Sundays checks the two latest recorded Sunday dates separately and lists only explicit Absent statuses by date and Sonta.

## Connect additional spreadsheets

Set `CHURCH_AI_ADMIN_PASSWORD` to a unique password of at least 12 characters in `.env.local` and in Vercel's Production environment variables. Redeploy after adding it to Vercel. In Settings, unlock the connector with that password, share another spreadsheet with the same Google service account as a Viewer, and paste its full Google Sheets URL. The app confirms the spreadsheet title and worksheet tabs. Connections are held in a signed, HTTP-only cookie for seven days in that browser; they are not shared across browsers or accounts. Locking connections removes access from the current browser.

The assistant can query these worksheets using the header row in row 1, with up to three column filters. It can list matching rows, count rows, and count rows by a column. Query results link back to the source worksheet and show the scanned range. Each query scans up to the first 2,000 data rows and 52 columns per worksheet; a full scan limit is disclosed in the answer. The displayed row list is limited to 30 rows and 18 selected columns. Up to eight extra spreadsheets and 20 worksheets per spreadsheet are supported. This connector does not change the fixed Members and Form Responses 1 attendance calculations.

The admin password protects these additional sheets. The original church dashboard and member APIs remain public in this starter; put the deployed app behind access control before treating its records as private.

## Connect text chat

Edit `.env.local` in this directory, alongside `package.json` (the inner `church-ai-assistant` folder).

For Groq hosting of the same GPT-OSS model:

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=your_private_key
GROQ_MODEL=openai/gpt-oss-20b
```

Create a key in the [Groq console](https://console.groq.com/keys). Groq is a different provider from xAI's Grok and NVIDIA. The [Groq model page](https://console.groq.com/docs/model/openai/gpt-oss-20b) lists tool use, streaming, model limits, and pricing. It uses the existing retrieval and streaming code through Groq's compatible endpoint. To verify just this provider without printing credentials, run `bun scripts/check-ai.ts --provider=groq`.

For NVIDIA's hosted development endpoint:

```dotenv
AI_PROVIDER=nvidia
NVIDIA_API_KEY=your_private_key
NVIDIA_MODEL=openai/gpt-oss-20b
```

Generate the key on the [NVIDIA model page](https://build.nvidia.com/openai/gpt-oss-20b). NVIDIA lists this model with a free endpoint and tool support. Free hosted access is for prototyping and testing, subject to model availability and limits; review the [NVIDIA access terms](https://docs.api.nvidia.com/nim/docs/product) and the catalog's data handling terms before sending personal member information. Use an appropriate paid or private deployment for production records.

For Grok instead:

```dotenv
AI_PROVIDER=xai
XAI_API_KEY=your_private_key
XAI_MODEL=grok-4.7
```

If `AI_PROVIDER` is omitted, the app selects Groq and reports `GROQ_API_KEY` when its key is missing. NVIDIA and xAI require an explicit `AI_PROVIDER` value. Restart the server after changing environment values. Run `bun scripts/check-ai.ts --provider=groq` to check Groq authentication without printing credentials, then ask a question in the app to verify retrieval and the generated answer together.

## Groq voice conversations

Voice mode uses `GROQ_API_KEY` for speech recognition and generated speech, together with the same grounded `/api/chat` retrieval flow. It requires no xAI key. Set `AI_PROVIDER=groq` for Groq answers as well. The speech defaults are:

```dotenv
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
GROQ_SPEECH_MODEL=canopylabs/orpheus-v1-english
GROQ_SPEECH_VOICE=hannah
```

Start a conversation, speak, and pause to send your question. The microphone waits while records are retrieved and the answer is spoken, then resumes listening. Ending the conversation stops recording, audio playback, and outstanding requests. Audio uploads go through the server; the API key is never sent to the browser. Orpheus speech is generated in chunks within Groq's 200-character limit. If hosted speech is unavailable, the browser can read the answer aloud instead.

If Groq returns `model_terms_required`, accept the speech model's terms in the Groq console to enable hosted speech. This does not prevent browser speech playback. Run `bun scripts/check-voice.ts` to check the speech endpoint without printing credentials or provider error bodies.

Browser microphone access requires localhost or HTTPS. On the computer running the app, use [localhost voice mode](http://localhost:3000/?voice=1). A plain HTTP LAN IP such as `http://10.193.79.45:3000` cannot grant microphone access; remote devices need HTTPS. The voice screen provides a localhost link when that restriction applies. Chat input dictation and its Listen buttons use browser speech features.

## Response latency

Help and greetings are answered locally. Supported standalone roster totals and starter questions run the existing spreadsheet analytics directly, so they do not wait for an AI provider. Other questions use one planning request, show verified charts as soon as retrieval succeeds, and stream the final answer. If final generation fails, the calculated results remain visible with a verified summary. Ambiguous follow-ups and extra date or ministry filters continue through the model.

The browser requests newline-delimited JSON from `/api/chat`. Callers without that Accept header still receive a complete JSON response. Responses include timing metadata, and JSON responses have a `Server-Timing` header, to distinguish Sheets reads from AI response time. No questions, member values, or credentials are added to these timings. Sheets refreshes are shared across concurrent requests, with the existing 30-second data freshness window and cached Google access tokens.

Streaming improves how soon results appear; it cannot remove latency inside the hosted model. Changing SDKs alone does not change that provider time.

## Local development note

This starter has no user authentication. Keep it local or behind access control before exposing member records on a public deployment.

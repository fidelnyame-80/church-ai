"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyticsResult } from "@/lib/attendance";
import { readChatStream } from "@/lib/chat-stream";
import { audioRms, createVoiceActivity, preferredRecordingType, sampleVoiceActivity, splitSpeechText } from "@/lib/voice-audio";

type VoiceState = "idle" | "connecting" | "connected";
type VoicePhase = "listening" | "transcribing" | "thinking" | "speaking";
type VoiceMessage = { role: "user" | "assistant"; content: string };
type VoiceSession = {
  id: number; controller: AbortController; context: AudioContext; history: VoiceMessage[];
  media: MediaStream | null; source: MediaStreamAudioSourceNode | null; analyser: AnalyserNode | null;
  recorder: MediaRecorder | null; vadTimer: number | null; resumeTimer: number | null; playbackTimer: number | null;
  playback: AudioBufferSourceNode | null; utterance: SpeechSynthesisUtterance | null; finishPlayback: (() => void) | null;
};

function releaseSession(session: VoiceSession | null) {
  if (!session) return;
  session.controller.abort();
  if (session.vadTimer !== null) window.clearInterval(session.vadTimer);
  if (session.resumeTimer !== null) window.clearTimeout(session.resumeTimer);
  if (session.playbackTimer !== null) window.clearTimeout(session.playbackTimer);
  const recorder = session.recorder;
  if (recorder) {
    recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
    if (recorder.state !== "inactive") { try { recorder.stop(); } catch {} }
  }
  session.recorder = null;
  if (session.playback) {
    try { session.playback.stop(); } catch {}
    session.playback.disconnect();
  }
  if (session.utterance) {
    session.utterance.onend = null; session.utterance.onerror = null;
    window.speechSynthesis?.cancel();
  }
  session.finishPlayback?.();
  session.media?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
  session.source?.disconnect(); session.analyser?.disconnect();
  if (session.context.state !== "closed") void session.context.close().catch(() => {});
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch { return fallback; }
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "Microphone permission was denied. Allow microphone access in your browser and start again.";
    if (error.name === "NotFoundError") return "No microphone was found. Connect a microphone and start again.";
    if (error.name === "NotReadableError") return "The microphone is unavailable. Close other apps using it and start again.";
  }
  return error instanceof Error ? error.message : "Voice could not start. Please try again.";
}

export function useGroqVoice() {
  const [state, setState] = useState<VoiceState>("idle");
  const [phase, setPhase] = useState<VoicePhase>("listening");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsResult[]>([]);
  const sessionRef = useRef<VoiceSession | null>(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current++;
    const session = sessionRef.current;
    sessionRef.current = null;
    releaseSession(session);
    setState("idle"); setPhase("listening");
  }, []);

  useEffect(() => () => {
    generationRef.current++;
    const session = sessionRef.current;
    sessionRef.current = null;
    releaseSession(session);
  }, []);

  const active = (session: VoiceSession) => sessionRef.current === session
    && session.id === generationRef.current && !session.controller.signal.aborted;

  function fail(session: VoiceSession, message: string) {
    if (!active(session)) return;
    stop(); setError(message);
  }

  function resumeListening(session: VoiceSession, delay = 200) {
    if (!active(session)) return;
    if (session.resumeTimer !== null) window.clearTimeout(session.resumeTimer);
    setPhase("listening");
    session.resumeTimer = window.setTimeout(() => {
      session.resumeTimer = null;
      listen(session);
    }, delay);
  }

  function listen(session: VoiceSession) {
    if (!active(session) || !session.media || !session.analyser || session.recorder) return;
    try {
      const mimeType = preferredRecordingType((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(session.media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      const chunks: Blob[] = [];
      let submit = false;
      let activity: ReturnType<typeof createVoiceActivity> | undefined;
      session.recorder = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => fail(session, "Microphone recording failed. Please start voice again.");
      recorder.onstop = () => {
        if (!active(session) || session.recorder !== recorder) return;
        session.recorder = null;
        if (session.vadTimer !== null) window.clearInterval(session.vadTimer);
        session.vadTimer = null;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (submit && audio.size) void answerUtterance(session, audio);
        else resumeListening(session, 0);
      };
      recorder.start();
      const samples = new Float32Array(session.analyser.fftSize);
      session.vadTimer = window.setInterval(() => {
        if (!active(session) || session.recorder !== recorder || recorder.state !== "recording") return;
        session.analyser!.getFloatTimeDomainData(samples);
        const now = performance.now();
        const update = sampleVoiceActivity(activity ?? createVoiceActivity(now), audioRms(samples), now);
        activity = update.activity;
        if (update.action === "continue") return;
        submit = update.action === "submit";
        if (session.vadTimer !== null) window.clearInterval(session.vadTimer);
        session.vadTimer = null;
        if (submit) setPhase("transcribing");
        recorder.stop();
      }, 50);
      setPhase("listening");
    } catch {
      fail(session, "This browser could not record microphone audio. Try the latest Chrome, Edge, or Safari.");
    }
  }

  async function playAudio(session: VoiceSession, audio: AudioBuffer): Promise<boolean> {
    if (!active(session)) return false;
    try { await session.context.resume(); } catch { return false; }
    if (!active(session)) return false;
    setPhase("speaking");
    return new Promise((resolve) => {
      const source = session.context.createBufferSource();
      const finish = (success: boolean) => {
        source.onended = null; source.disconnect();
        if (session.playback === source) { session.playback = null; session.finishPlayback = null; }
        resolve(success);
      };
      source.buffer = audio; source.connect(session.context.destination);
      session.playback = source; session.finishPlayback = () => finish(false);
      source.onended = () => finish(true);
      try { source.start(); } catch { finish(false); }
    });
  }

  async function browserSpeak(session: VoiceSession, text: string) {
    if (!("speechSynthesis" in window)) {
      if (active(session)) setError("The answer is shown above, but speech playback is unavailable in this browser.");
      return;
    }
    for (const part of splitSpeechText(text)) {
      if (!active(session)) return;
      setPhase("speaking");
      const played = await new Promise<boolean>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(part);
        let finished = false;
        const finish = (success: boolean) => {
          if (finished) return;
          finished = true;
          utterance.onend = null; utterance.onerror = null;
          if (session.playbackTimer !== null) window.clearTimeout(session.playbackTimer);
          session.playbackTimer = null; session.utterance = null; session.finishPlayback = null;
          resolve(success);
        };
        utterance.lang = "en-US"; utterance.rate = 0.96;
        utterance.onend = () => finish(true); utterance.onerror = () => finish(false);
        session.utterance = utterance; session.finishPlayback = () => finish(false);
        session.playbackTimer = window.setTimeout(() => { window.speechSynthesis.cancel(); finish(false); }, Math.max(10000, part.length * 150));
        try { window.speechSynthesis.resume(); window.speechSynthesis.speak(utterance); }
        catch { finish(false); }
      });
      if (!played) {
        if (active(session)) setError("The answer is shown above, but spoken playback could not finish. You can ask another question.");
        return;
      }
    }
  }

  async function speakAnswer(session: VoiceSession, answer: string) {
    const parts = splitSpeechText(answer);
    const loadAudio = async (text: string): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch("/api/voice/speak", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: session.controller.signal,
        });
        if (!response.ok || !active(session)) return null;
        const bytes = await response.arrayBuffer();
        if (!active(session)) return null;
        return await session.context.decodeAudioData(bytes);
      } catch { return null; }
    };
    if (!parts.length || !active(session)) return;
    let pending = loadAudio(parts[0]);
    for (let index = 0; index < parts.length; index++) {
      const audio = await pending;
      if (!active(session)) return;
      if (!audio) { await browserSpeak(session, parts.slice(index).join(" ")); return; }
      // Prepare at most one following chunk while the current WAV is playing.
      if (index + 1 < parts.length) pending = loadAudio(parts[index + 1]);
      if (!await playAudio(session, audio)) {
        if (active(session)) await browserSpeak(session, parts.slice(index).join(" "));
        return;
      }
    }
  }

  async function answerUtterance(session: VoiceSession, audio: Blob) {
    if (!active(session)) return;
    try {
      setPhase("transcribing");
      const extension = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", new File([audio], "question." + extension, { type: audio.type }));
      const transcription = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: session.controller.signal });
      if (!active(session)) return;
      if (!transcription.ok) {
        const failure = await transcription.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
        if (failure?.code === "NO_SPEECH") { resumeListening(session); return; }
        throw new Error(typeof failure?.error === "string" ? failure.error : "Your question could not be transcribed. Please try again.");
      }
      const spoken = await transcription.json() as { text?: unknown };
      if (!active(session)) return;
      const question = typeof spoken.text === "string" ? spoken.text.trim().slice(0, 4000) : "";
      if (!question) { resumeListening(session); return; }
      setError(""); setAnalytics([]); setTranscript("You: " + question); setPhase("thinking");
      const messages: VoiceMessage[] = [...session.history, { role: "user" as const, content: question }].slice(-12);
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ messages }), signal: session.controller.signal,
      });
      if (!active(session)) return;
      if (!response.ok) throw new Error(await responseError(response, "Church AI could not answer this question. Please try again."));
      let answer = "";
      if (response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
        if (!response.body) throw new Error("The voice answer did not arrive. Please try again.");
        await readChatStream(response.body, (event) => {
          if (!active(session)) return;
          if (event.type === "analytics") setAnalytics((current) => [...current, event.result]);
          if (event.type === "text") { answer += event.delta; setTranscript("You: " + question + "\n\nChurch AI: " + answer); }
          if (event.type === "done") { answer = event.answer; setAnalytics(event.visualizations); }
        });
      } else {
        const reply = await response.json() as { answer?: unknown; visualizations?: AnalyticsResult[] };
        answer = typeof reply.answer === "string" ? reply.answer : "";
        if (active(session)) setAnalytics(Array.isArray(reply.visualizations) ? reply.visualizations : []);
      }
      if (!active(session)) return;
      if (!answer.trim()) throw new Error("Church AI did not return a spoken answer. Please try again.");
      setTranscript("You: " + question + "\n\nChurch AI: " + answer);
      session.history = [...messages, { role: "assistant" as const, content: answer }].slice(-12);
      await speakAnswer(session, answer);
      resumeListening(session, 300);
    } catch (failure) {
      if (!active(session)) return;
      setError(failure instanceof Error ? failure.message : "Voice could not complete this question. Please try again.");
      resumeListening(session);
    }
  }

  async function start() {
    stop(); setError(""); setTranscript(""); setAnalytics([]);
    // Browser microphone permission cannot work on an HTTP LAN address.
    if (!window.isSecureContext) {
      setError("Microphone access requires localhost or HTTPS. On this computer, open http://localhost:3000.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser does not support voice recording. Try the latest Chrome, Edge, or Safari.");
      return;
    }
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) { setError("Audio playback is unavailable in this browser."); return; }
    let session: VoiceSession | null = null;
    setState("connecting");
    try {
      const context = new Context();
      session = {
        id: ++generationRef.current, controller: new AbortController(), context, history: [],
        media: null, source: null, analyser: null, recorder: null, vadTimer: null, resumeTimer: null,
        playback: null, utterance: null, finishPlayback: null, playbackTimer: null,
      };
      sessionRef.current = session;
      // Resume during the user's Start gesture so later WAV playback is permitted.
      await context.resume();
      if (!active(session)) return;
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!active(session)) { media.getTracks().forEach((track) => track.stop()); return; }
      session.media = media;
      const currentSession = session;
      media.getAudioTracks().forEach((track) => { track.onended = () => fail(currentSession, "Microphone access ended. Start voice again to reconnect."); });
      const response = await fetch("/api/voice/session", { method: "POST", signal: session.controller.signal });
      if (!active(session)) return;
      if (!response.ok) throw new Error(await responseError(response, "Groq voice could not connect. Please try again."));
      const settings = await response.json() as { provider?: unknown };
      if (!active(session)) return;
      if (settings.provider !== "groq") throw new Error("Groq voice is not configured. Check the voice provider settings.");
      session.source = context.createMediaStreamSource(media);
      session.analyser = context.createAnalyser(); session.analyser.fftSize = 1024;
      session.source.connect(session.analyser);
      setState("connected"); listen(session);
    } catch (failure) {
      if (session && !active(session)) return;
      stop(); setError(microphoneError(failure));
    }
  }

  return { state, phase, error, transcript, analytics, start, stop, setError };
}

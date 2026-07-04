"use client";

import { useEffect, useRef, useState } from "react";
import { api, OutlineButton, PrimaryButton, useToast } from "./ui";

// Minimal typings for the Web Speech API (not yet in lib.dom for all setups)
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export function NotesComposer({
  clientId,
  clinic,
  onSaved,
}: {
  clientId: string;
  clinic: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [bullets, setBullets] = useState<string[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<"" | "summarise" | "save">("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");

  useEffect(() => () => recRef.current?.stop(), []);

  const toggleMic = () => {
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      return;
    }
    const SR = getSpeechRecognition();
    if (!SR) {
      toast("Voice dictation needs Chrome or Safari — you can still type");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    baseRef.current = text ? text.replace(/\s+$/, "") + " " : "";
    rec.onresult = (event) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(baseRef.current + final + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") toast("Microphone blocked — allow it in your browser settings");
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    recRef.current = rec;
    rec.start();
    setRecording(true);
  };

  const summarise = async () => {
    if (!text.trim()) {
      toast("Nothing to summarise yet");
      return;
    }
    setBusy("summarise");
    try {
      const { bullets: b } = await api<{ bullets: string[] }>("/api/notes/summarise", {
        method: "POST",
        body: JSON.stringify({ raw: text }),
      });
      setBullets(b);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't summarise");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!text.trim()) {
      toast("Nothing to save yet");
      return;
    }
    recRef.current?.stop();
    setBusy("save");
    try {
      await api(`/api/clients/${clientId}/notes`, {
        method: "POST",
        body: JSON.stringify({ raw: text, bullets: bullets ?? undefined, clinic }),
      });
      setText("");
      setBullets(null);
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-clay/35 bg-card px-[18px] py-4 shadow-card">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type, or press Dictate and just talk…"
        className="min-h-[130px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-sm leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
      />
      {bullets && bullets.length > 0 && (
        <div className="rounded-xl border border-[oklch(0.85_0.05_148_/_0.5)] bg-[oklch(0.94_0.03_148_/_0.45)] px-4 py-3">
          <div className="mb-[7px] text-[10.5px] font-semibold tracking-[0.1em] text-sage-text">
            SUMMARY — GOES TO THE DOC
          </div>
          {bullets.map((b, i) => (
            <div key={i} className="flex gap-2 text-[13px] leading-[1.55] text-[oklch(0.35_0.03_60)]">
              <span className="text-sage-text">•</span>
              <span>{b}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={toggleMic}
          className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold ${
            recording ? "bg-[oklch(0.45_0.13_30)] text-cream" : "bg-clay-tint text-clay-text"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${recording ? "animate-ct-pulse bg-[oklch(0.9_0.05_30)]" : "bg-clay-text"}`}
          />
          {recording ? "Listening…" : "Dictate"}
        </button>
        <OutlineButton onClick={summarise} disabled={busy === "summarise"}>
          {busy === "summarise" ? "Summarising…" : "Summarise"}
        </OutlineButton>
        <div className="flex-1" />
        <PrimaryButton onClick={save} disabled={busy === "save"} className="px-5 py-2 text-[13px]">
          {busy === "save" ? "Saving…" : "Save to Doc"}
        </PrimaryButton>
      </div>
    </div>
  );
}

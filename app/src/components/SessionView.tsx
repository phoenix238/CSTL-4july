"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  Card,
  Chip,
  clinicChip,
  inputClass,
  OutlineButton,
  PrimaryButton,
  SectionLabel,
  TintButton,
  useToast,
} from "./ui";
import { dictationSupported, useLiveTranscript } from "./useLiveTranscript";

export interface SessionClient {
  id: string;
  name: string;
  clinic: string;
}

type Phase = "idle" | "live" | "review";

interface Line {
  id: string;
  text: string;
  pinned: boolean;
}

// The core clean questions, to glance at for your next move.
const CLEAN_QUESTIONS = [
  "And what kind of X is that X?",
  "And is there anything else about X?",
  "And where is X? / And whereabouts?",
  "And that's X like what?",
  "And when X, then what happens?",
  "And what happens just before X?",
  "And where could X come from?",
  "And what would X like to have happen?",
];

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function SessionView({ clients }: { clients: SessionClient[] }) {
  const toast = useToast();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [myNotes, setMyNotes] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const clinic = client?.clinic ?? "waterloo";
  const supported = useMemo(() => dictationSupported(), []);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { listening, start, stop } = useLiveTranscript({
    onFinal: (text) => setLines((ls) => [...ls, { id: uid(), text, pinned: false }]),
    onInterim: setInterim,
    onUnsupported: () => toast("Live transcription needs Chrome or Safari — you can still type your notes"),
    onBlocked: () => toast("Microphone blocked — allow it in your browser settings"),
  });

  // Tick the session timer while recording.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Keep the transcript scrolled to the latest line.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, interim]);

  const pinned = lines.filter((l) => l.pinned);

  const beginSession = () => {
    if (!clientId) {
      toast("Pick who you're with first");
      return;
    }
    setLines([]);
    setInterim("");
    setMyNotes("");
    setElapsed(0);
    setPhase("live");
    start();
  };

  const endSession = () => {
    stop();
    setInterim("");
    setPhase("review");
  };

  const resumeSession = () => {
    setPhase("live");
    start();
  };

  const togglePin = (id: string) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, pinned: !l.pinned } : l)));

  const discard = () => {
    stop();
    setPhase("idle");
    setLines([]);
    setInterim("");
    setMyNotes("");
    setElapsed(0);
  };

  const save = async () => {
    const transcript = lines.map((l) => l.text).join("\n");
    if (!transcript.trim() && !pinned.length && !myNotes.trim()) {
      toast("Nothing recorded yet");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/session`, {
        method: "POST",
        body: JSON.stringify({
          transcript,
          pinned: pinned.map((l) => l.text),
          myNotes,
          clinic,
        }),
      });
      toast(`Saved to ${client?.name ?? "the client"}'s Doc ✓`);
      discard();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const chip = clinicChip(clinic);

  return (
    <div className="flex max-w-[1200px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      {/* header / controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-serif text-[22px] leading-tight">Session</h1>
          <div className="text-[12.5px] text-muted">
            Record what&apos;s said, pin their exact words, keep your notes to hand.
          </div>
        </div>
        <div className="flex-1" />
        {phase === "idle" ? (
          <>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={`${inputClass} w-auto min-w-[190px]`}
            >
              {clients.length === 0 && <option value="">No clients yet</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <PrimaryButton onClick={beginSession} disabled={!clientId}>
              Start session
            </PrimaryButton>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="font-serif text-[15px]">{client?.name}</span>
            <Chip color={chip.color} bg={chip.bg}>
              {chip.label}
            </Chip>
            <span className="flex items-center gap-2 text-[13px] font-medium text-ink-soft">
              <span
                className={`h-2 w-2 rounded-full ${
                  listening ? "animate-ct-pulse bg-[oklch(0.55_0.18_25)]" : "bg-muted"
                }`}
              />
              {fmtElapsed(elapsed)}
            </span>
            {phase === "live" ? (
              <PrimaryButton onClick={endSession}>End session</PrimaryButton>
            ) : (
              <OutlineButton onClick={resumeSession}>Resume</OutlineButton>
            )}
          </div>
        )}
      </div>

      {!supported && (
        <Card className="border-[1.5px] border-clay/35 px-4 py-3 text-[13px] text-ink-soft">
          This browser can&apos;t do live transcription — use Chrome or Safari for the recording.
          You can still take your own notes below and save them.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* live transcript */}
        <Card className="flex min-h-[420px] flex-col px-0 py-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <SectionLabel>TRANSCRIPT</SectionLabel>
            {phase !== "idle" && (
              <span className="text-[11.5px] text-muted">Tap a line to pin their exact words</span>
            )}
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {lines.length === 0 && !interim ? (
              <div className="pt-10 text-center text-[13.5px] text-muted">
                {phase === "idle"
                  ? "Pick who you're with and press Start — what's said appears here as you talk."
                  : "Listening… speak and it shows up here."}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {lines.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => togglePin(l.id)}
                    className={`cursor-pointer rounded-lg px-3 py-2 text-left text-[15px] leading-[1.5] transition-colors ${
                      l.pinned
                        ? "bg-clay-tint text-clay-text"
                        : "text-ink hover:bg-hoverbg"
                    }`}
                  >
                    {l.pinned && <span className="mr-1.5">📌</span>}
                    {l.text}
                  </button>
                ))}
                {interim && (
                  <div className="px-3 py-2 text-[15px] leading-[1.5] text-muted italic">{interim}</div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* right rail */}
        <div className="flex flex-col gap-4">
          {/* pinned exact words */}
          <Card className="flex flex-col px-4 py-3.5">
            <SectionLabel className="mb-2">THEIR EXACT WORDS</SectionLabel>
            {pinned.length === 0 ? (
              <div className="text-[12.5px] text-muted">
                Tap any line in the transcript to keep the words they actually used — the ones you&apos;ll
                reflect back.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {pinned.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start gap-2 rounded-lg bg-clay-tint px-3 py-2 text-[14px] leading-[1.45] text-clay-text"
                  >
                    <span className="flex-1">{l.text}</span>
                    <button
                      onClick={() => togglePin(l.id)}
                      aria-label="Unpin"
                      className="cursor-pointer text-clay-text/60 hover:text-clay-text"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* my notes */}
          <Card className="flex flex-col px-4 py-3.5">
            <SectionLabel className="mb-2">MY NOTES</SectionLabel>
            <textarea
              value={myNotes}
              onChange={(e) => setMyNotes(e.target.value)}
              placeholder="Your own notes — what you're noticing, what to ask next…"
              className="min-h-[120px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-[14px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
            />
          </Card>

          {/* clean questions */}
          <Card className="flex flex-col px-4 py-3.5">
            <SectionLabel className="mb-2">CLEAN QUESTIONS</SectionLabel>
            <div className="flex flex-col gap-1">
              {CLEAN_QUESTIONS.map((q) => (
                <div key={q} className="text-[13px] leading-[1.5] text-ink-soft">
                  {q}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* review actions */}
      {phase === "review" && (
        <Card className="flex flex-wrap items-center gap-3 border-[1.5px] border-clay/35 px-4 py-3.5">
          <div className="text-[13.5px] text-ink-soft">
            Session ended. Save a summary, the pinned words and your notes to {client?.name}&apos;s Doc — the
            full transcript stays here in the app.
          </div>
          <div className="flex-1" />
          <TintButton onClick={discard} disabled={saving}>
            Discard
          </TintButton>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save to Doc"}
          </PrimaryButton>
        </Card>
      )}
    </div>
  );
}

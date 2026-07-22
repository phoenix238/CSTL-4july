"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}

interface Highlight {
  id: string;
  text: string;
  source: "auto" | "pinned";
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

// How often, while live, we ask Claude for new highlight moments.
const EXTRACT_EVERY_MS = 12_000;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// Append only items whose text isn't already present (case/space-insensitive).
function appendUnique<T extends { text: string }>(prev: T[], texts: string[], make: (t: string) => T): T[] {
  const seen = new Set(prev.map((p) => norm(p.text)));
  const add: T[] = [];
  for (const t of texts) {
    const n = norm(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      add.push(make(t.trim()));
    }
  }
  return add.length ? [...prev, ...add] : prev;
}

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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [finding, setFinding] = useState(false);
  const [myNotes, setMyNotes] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);

  const client = clients.find((c) => c.id === clientId);
  const clinic = client?.clinic ?? "waterloo";
  const supported = useMemo(() => dictationSupported(), []);

  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Mirrors of state read inside the extraction loop, to avoid stale closures.
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const highlightsRef = useRef<Highlight[]>([]);
  highlightsRef.current = highlights;
  const lastCountRef = useRef(0); // transcript lines already sent for extraction
  const extractingRef = useRef(false);

  const { listening, start, stop } = useLiveTranscript({
    onFinal: (text) => setLines((ls) => [...ls, { id: uid(), text }]),
    onInterim: setInterim,
    onUnsupported: () =>
      toast("Live transcription needs Chrome or Safari — you can still type your notes"),
    onBlocked: () => toast("Microphone blocked — allow it in your browser settings"),
  });

  const addHighlights = useCallback((texts: string[], source: Highlight["source"]) => {
    setHighlights((hs) => appendUnique(hs, texts, (t) => ({ id: uid(), text: t, source })));
  }, []);

  // Ask Claude for new highlight moments from the transcript since we last looked.
  const runExtraction = useCallback(async () => {
    if (extractingRef.current) return;
    const all = linesRef.current;
    const from = lastCountRef.current;
    if (all.length <= from) return;
    const newLines = all.slice(from);
    const upto = all.length;
    extractingRef.current = true;
    setFinding(true);
    try {
      const { highlights: found } = await api<{ highlights: string[] }>("/api/session/highlights", {
        method: "POST",
        body: JSON.stringify({
          recent: newLines.map((l) => l.text).join("\n"),
          existing: highlightsRef.current.map((h) => h.text),
        }),
      });
      lastCountRef.current = upto;
      if (found?.length) addHighlights(found, "auto");
    } catch {
      // Transient failure — leave lastCountRef so the next tick retries this chunk.
    } finally {
      extractingRef.current = false;
      setFinding(false);
    }
  }, [addHighlights]);

  // Tick the session timer while recording.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Surface highlights on a gentle cadence while recording.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => void runExtraction(), EXTRACT_EVERY_MS);
    return () => clearInterval(t);
  }, [phase, runExtraction]);

  // Keep both columns scrolled to their latest content.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [lines, interim]);
  useEffect(() => {
    highlightRef.current?.scrollTo({ top: highlightRef.current.scrollHeight });
  }, [highlights]);

  const resetSession = () => {
    setLines([]);
    setInterim("");
    setHighlights([]);
    setMyNotes("");
    setElapsed(0);
    lastCountRef.current = 0;
  };

  const beginSession = () => {
    if (!clientId) {
      toast("Pick who you're with first");
      return;
    }
    resetSession();
    setPhase("live");
    start();
  };

  const endSession = () => {
    stop();
    setInterim("");
    setPhase("review");
    void runExtraction(); // catch anything said since the last tick
  };

  const resumeSession = () => {
    setPhase("live");
    start();
  };

  const removeHighlight = (id: string) => setHighlights((hs) => hs.filter((h) => h.id !== id));

  const discard = () => {
    stop();
    setPhase("idle");
    resetSession();
  };

  const save = async () => {
    const transcript = lines.map((l) => l.text).join("\n");
    if (!transcript.trim() && !highlights.length && !myNotes.trim()) {
      toast("Nothing recorded yet");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/session`, {
        method: "POST",
        body: JSON.stringify({
          transcript,
          pinned: highlights.map((h) => h.text),
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
    <div className="flex max-w-[1240px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      {/* header / controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-serif text-[22px] leading-tight">Session</h1>
          <div className="text-[12.5px] text-muted">
            The whole conversation on the left, their highlight moments surfaced on the right.
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* left — the whole conversation */}
        <Card className="flex min-h-[460px] flex-col px-0 py-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <SectionLabel>CONVERSATION</SectionLabel>
            {phase !== "idle" && (
              <span className="text-[11.5px] text-muted">Tap a line to keep it as a highlight</span>
            )}
          </div>
          <div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 py-3">
            {lines.length === 0 && !interim ? (
              <div className="pt-10 text-center text-[13.5px] text-muted">
                {phase === "idle"
                  ? "Pick who you're with and press Start — every word appears here as you talk."
                  : "Listening… what's said shows up here."}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {lines.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => addHighlights([l.text], "pinned")}
                    title="Keep as a highlight"
                    className="cursor-pointer rounded-lg px-3 py-2 text-left text-[15px] leading-[1.5] text-ink transition-colors hover:bg-hoverbg"
                  >
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

        {/* right — highlight moments + notes + prompts */}
        <div className="flex flex-col gap-4">
          <Card className="flex min-h-[240px] flex-col px-0 py-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <SectionLabel>HIGHLIGHT MOMENTS</SectionLabel>
              {finding ? (
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="h-[7px] w-[7px] animate-ct-pulse rounded-full bg-clay" />
                  listening for highlights
                </span>
              ) : (
                <span className="text-[11.5px] text-muted">their words, as they land</span>
              )}
            </div>
            <div ref={highlightRef} className="flex-1 overflow-y-auto px-4 py-3">
              {highlights.length === 0 ? (
                <div className="pt-6 text-center text-[12.5px] text-muted">
                  {phase === "idle"
                    ? "The standout things they say — vivid images, charged phrases, what they want — appear here as you record."
                    : "Nothing stood out yet — their key phrases will appear here."}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {highlights.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-start gap-2 rounded-lg bg-clay-tint px-3 py-2 text-[14.5px] leading-[1.45] text-clay-text"
                    >
                      <span className="flex-1">
                        {h.source === "pinned" && <span className="mr-1">📌</span>}
                        {h.text}
                      </span>
                      <button
                        onClick={() => removeHighlight(h.id)}
                        aria-label="Remove highlight"
                        className="cursor-pointer text-clay-text/60 hover:text-clay-text"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="flex flex-col px-4 py-3.5">
            <SectionLabel className="mb-2">MY NOTES</SectionLabel>
            <textarea
              value={myNotes}
              onChange={(e) => setMyNotes(e.target.value)}
              placeholder="Your own notes — what you're noticing, what to ask next…"
              className="min-h-[100px] w-full resize-y rounded-xl border border-line bg-inputbg px-3.5 py-3 text-[14px] leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
            />
          </Card>

          <Card className="flex flex-col px-4 py-3.5">
            <SectionLabel className="mb-2">CLEAN QUESTIONS · REFERENCE</SectionLabel>
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
            Session ended. Save the highlight moments, a summary, your notes and the full conversation
            (every word, so every question you asked is kept) to {client?.name}&apos;s Doc.
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

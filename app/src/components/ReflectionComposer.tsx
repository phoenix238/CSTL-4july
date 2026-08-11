"use client";

import { useRef, useState } from "react";
import { api, OutlineButton, PrimaryButton, useToast } from "./ui";
import { useLiveTranscript } from "./useLiveTranscript";

/**
 * Phoenix's own private reflections — separate from the client-facing
 * session note. Saved into one shared "Phoenix session reflections" Doc
 * (dated, headed by client name or "Personal") rather than the client's
 * own Doc.
 */
export function ReflectionComposer({
  endpoint,
  placeholder,
  onSaved,
}: {
  /** where this reflection posts to — a client's own route, or the standalone one */
  endpoint: string;
  placeholder?: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "summarise" | "save">("");
  const baseRef = useRef(""); // textarea content captured when the mic started
  const finalRef = useRef(""); // finalized dictation appended since then

  const { listening: recording, start, stop } = useLiveTranscript({
    onFinal: (chunk) => {
      finalRef.current += chunk + " ";
      setText(baseRef.current + finalRef.current);
    },
    onInterim: (interim) => setText(baseRef.current + finalRef.current + interim),
    onUnsupported: () => toast("Voice dictation needs Chrome or Safari — you can still type"),
    onBlocked: () => toast("Microphone blocked — allow it in your browser settings"),
  });

  const toggleMic = () => {
    if (recording) {
      stop();
      return;
    }
    baseRef.current = text ? text.replace(/\s+$/, "") + " " : "";
    finalRef.current = "";
    start();
  };

  const summarise = async () => {
    if (!text.trim()) {
      toast("Nothing to summarise yet");
      return;
    }
    setBusy("summarise");
    try {
      const { summary } = await api<{ summary: string }>("/api/reflection/summarise", {
        method: "POST",
        body: JSON.stringify({ raw: text }),
      });
      setText(summary);
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
    stop();
    setBusy("save");
    try {
      await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setText("");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-line bg-inputbg px-[18px] py-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "Type, or press Dictate and just talk — for you, not the client's Doc…"}
        className="min-h-[110px] w-full resize-y rounded-xl border border-line bg-card px-3.5 py-3 text-sm leading-[1.6] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]"
      />
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
          {busy === "summarise" ? "Tidying…" : "Summarise"}
        </OutlineButton>
        <div className="flex-1" />
        <PrimaryButton onClick={save} disabled={busy === "save"} className="px-5 py-2 text-[13px]">
          {busy === "save" ? "Saving…" : "Save to reflections doc"}
        </PrimaryButton>
      </div>
    </div>
  );
}

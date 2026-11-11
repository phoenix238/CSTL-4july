"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not yet in lib.dom for all setups)
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
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

/** True when the browser can do live speech-to-text (Chrome/Safari). */
export function dictationSupported(): boolean {
  return getSpeechRecognition() !== null;
}

/**
 * Browser-native live transcription (Web Speech API). Emits each finalized
 * chunk to `onFinal` and the current unstable text to `onInterim`.
 *
 * Unlike a one-off dictation, this KEEPS GOING through a whole session: Chrome's
 * recognizer quietly ends after silence / ~60s, so while the caller still wants
 * to listen we restart it on `onend`. The browser supplies the recognition service.
 */
export function useLiveTranscript(opts: {
  lang?: string;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onUnsupported?: () => void;
  onBlocked?: () => void;
  onFailure?: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cbs = useRef(opts);
  cbs.current = opts;

  function release(rec: SpeechRecognitionLike | null) {
    if (recRef.current !== rec) return;
    clearTimeout(timer.current);
    recRef.current = null;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = null;
    }
  }

  useEffect(() => () => {
    wantRef.current = false;
    const rec = recRef.current;
    release(rec);
    rec?.abort();
  }, []);

  function reset(rec: SpeechRecognitionLike) {
    release(rec);
    wantRef.current = false;
    setListening(false);
    setFinishing(false);
    cbs.current.onInterim?.("");
  }

  function start() {
    if (recRef.current) return;
    const SR = getSpeechRecognition();
    if (!SR) {
      cbs.current.onUnsupported?.();
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = cbs.current.lang ?? "en-GB";
    let emitted = 0;
    let networkErrors = 0;
    recRef.current = rec;
    wantRef.current = true;

    function begin() {
      try {
        rec.start();
        setListening(true);
      } catch {
        reset(rec);
        cbs.current.onFailure?.("Couldn’t start dictation. Try again or type your note.");
      }
    }

    rec.onresult = (event) => {
      networkErrors = 0;
      const interim: string[] = [];
      for (let i = Math.max(emitted, event.resultIndex); i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          emitted = i + 1;
          if (text) cbs.current.onFinal(text);
        } else if (text) {
          interim.push(text);
        }
      }
      cbs.current.onInterim?.(interim.join(" "));
    };

    rec.onerror = ({ error }) => {
      if (error === "not-allowed" || error === "service-not-allowed") {
        reset(rec);
        cbs.current.onBlocked?.();
      } else if (error === "network" && ++networkErrors < 3) {
        // Retry transient network errors through onend.
      } else if (error !== "no-speech" && error !== "aborted") {
        reset(rec);
        cbs.current.onFailure?.(error === "audio-capture"
          ? "No microphone is available. Check the input device and try again."
          : "Dictation stopped. Check your connection and try again.");
      }
    };

    rec.onend = () => {
      cbs.current.onInterim?.("");
      if (!wantRef.current) {
        reset(rec);
        return;
      }
      emitted = 0;
      timer.current = setTimeout(() => {
        if (wantRef.current && recRef.current === rec) begin();
      }, networkErrors ? 600 * networkErrors : 180);
    };
    begin();
  }

  function stop() {
    wantRef.current = false;
    clearTimeout(timer.current);
    const rec = recRef.current;
    if (!rec) return;
    setListening(false);
    setFinishing(true);
    try {
      rec.stop();
      // Some browsers don't emit onend after a stop during a restart gap.
      if (recRef.current === rec) timer.current = setTimeout(() => {
        reset(rec);
        rec.abort();
      }, 1400);
    } catch {
      reset(rec);
    }
  }

  return { listening, finishing, start, stop };
}

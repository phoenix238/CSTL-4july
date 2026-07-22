"use client";

import { useEffect, useRef, useState } from "react";

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
 * to listen we restart it on `onend`. Audio never leaves the browser.
 */
export function useLiveTranscript(opts: {
  lang?: string;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onUnsupported?: () => void;
  onBlocked?: () => void;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false); // do we intend to be listening? (drives auto-restart)
  const emittedRef = useRef(0); // how many results in this round we've already emitted
  const cbs = useRef(opts);
  cbs.current = opts;

  // Stop cleanly if the component unmounts mid-session.
  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.stop();
    },
    [],
  );

  const start = () => {
    if (wantRef.current) return;
    const SR = getSpeechRecognition();
    if (!SR) {
      cbs.current.onUnsupported?.();
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = cbs.current.lang ?? "en-GB";
    emittedRef.current = 0;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          if (i >= emittedRef.current) {
            const t = r[0].transcript.trim();
            if (t) cbs.current.onFinal(t);
            emittedRef.current = i + 1;
          }
        } else {
          interim += r[0].transcript;
        }
      }
      cbs.current.onInterim?.(interim);
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        wantRef.current = false;
        cbs.current.onBlocked?.();
        setListening(false);
      }
      // Transient errors ("no-speech", "network", "aborted") fall through to
      // onend, which restarts us while wantRef is still true.
    };

    rec.onend = () => {
      if (wantRef.current) {
        emittedRef.current = 0;
        cbs.current.onInterim?.("");
        try {
          rec.start();
        } catch {
          // start() can throw if called too soon after end — safe to ignore.
        }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
    }
  };

  const stop = () => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    cbs.current.onInterim?.("");
  };

  return { listening, start, stop };
}

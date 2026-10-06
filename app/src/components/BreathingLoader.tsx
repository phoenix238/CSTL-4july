"use client";

import { useEffect, useState } from "react";

/**
 * A calm "loading" state for the booking page: a circle that swells and settles
 * at a breathing pace, with a line to match.
 *
 * It only appears if loading is actually taking a moment — for the first
 * `delayMs` it renders an empty box of the same height, so a fast (cached) load
 * never flashes a loader and the page doesn't jump when the times arrive.
 */
export function BreathingLoader({ delayMs = 350, label = "Loading times" }: { delayMs?: number; label?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex min-h-[220px] flex-col items-center justify-center gap-4 py-6">
      {show && (
        <div className="animate-ct-fade-in flex flex-col items-center gap-4">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="animate-ct-breathe absolute inset-0 rounded-full bg-clay-tint" />
            <div className="animate-ct-breathe absolute inset-4 rounded-full bg-clay/40 [animation-delay:-0.4s]" />
          </div>
          <p className="text-[13px] text-muted">A good moment for a slow breath while the times load.</p>
        </div>
      )}
    </div>
  );
}

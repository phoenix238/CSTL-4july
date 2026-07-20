"use client";

import { SPAN_COLORS, type SpanSource } from "./layout";

const DISPLAY_ORDER: SpanSource[] = ["booking", "room", "chalkFarm", "personal"];

/** Colour key under the calendar; `variant="picker"` shows Free/Busy/Chosen instead. */
export function Legend({ variant = "display" }: { variant?: "display" | "picker" }) {
  const items =
    variant === "picker"
      ? [
          { label: "Hover a free time to choose", swatch: "oklch(0.62 0.13 148)" },
          { label: "Busy", swatch: "oklch(0.72 0.12 25)" },
          { label: "Chosen", swatch: "oklch(0.58 0.115 42)" },
        ]
      : DISPLAY_ORDER.map((s) => ({ label: SPAN_COLORS[s].label, swatch: SPAN_COLORS[s].border }));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[12px] text-muted">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.swatch }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

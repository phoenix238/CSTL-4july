"use client";

import { useEffect, useState } from "react";
import { api } from "./ui";
import { fmtDayLong, fmtTime, londonDateKey } from "@/lib/time";
import type { Clinic } from "@/lib/booking/rules";

/**
 * A simple day-by-day list of bookable times — deliberately not TimeGrid.tsx,
 * which is coupled to the admin week-grid visuals and busy-span client names.
 */
export function BookSlotPicker({
  clinic,
  selected,
  onSelect,
}: {
  clinic: Clinic;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setError(null);
    api<{ slots: string[] }>(`/api/public/slots?clinic=${clinic}`)
      .then((res) => {
        if (!cancelled) setSlots(res.slots);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load availability");
      });
    return () => {
      cancelled = true;
    };
  }, [clinic]);

  if (error) return <div className="text-[13px] text-muted">{error}</div>;
  if (!slots) return <div className="text-[13px] text-muted">Loading availability…</div>;
  if (!slots.length) {
    return (
      <div className="text-[13px] text-muted">
        No times available right now — please check back soon, or get in touch directly.
      </div>
    );
  }

  const groups = new Map<string, Date[]>();
  for (const iso of slots) {
    const d = new Date(iso);
    const key = londonDateKey(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  return (
    <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto pr-1">
      {[...groups.values()].map((times) => (
        <div key={times[0].toISOString()}>
          <div className="mb-1.5 text-[12px] font-semibold text-ink-soft">{fmtDayLong(times[0])}</div>
          <div className="flex flex-wrap gap-1.5">
            {times.map((t) => {
              const iso = t.toISOString();
              return (
                <button
                  key={iso}
                  onClick={() => onSelect(iso)}
                  className={`cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-medium select-none ${
                    selected === iso ? "bg-clay text-cream" : "border border-line bg-card text-ink-soft hover:bg-hoverbg"
                  }`}
                >
                  {fmtTime(t)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

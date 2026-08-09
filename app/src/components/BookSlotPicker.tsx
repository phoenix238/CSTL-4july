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
  /** Which endpoint to ask for times. The client portal has its own, which also
   * frees up the slot the client currently holds so they can see around it. */
  slotsUrl = (c) => `/api/public/slots?clinic=${c}`,
  emptyMessage = "No times available right now — please check back soon, or get in touch directly.",
}: {
  clinic: Clinic;
  selected: string | null;
  onSelect: (iso: string) => void;
  slotsUrl?: (clinic: Clinic) => string;
  emptyMessage?: string;
}) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Depend on the resolved URL, not on `slotsUrl` itself — an inline or defaulted
  // function is a fresh reference every render, which would refetch in a loop.
  const url = slotsUrl(clinic);

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setError(null);
    api<{ slots: string[] }>(url)
      .then((res) => {
        if (!cancelled) setSlots(res.slots);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load availability");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <div className="text-[13px] text-muted">{error}</div>;
  if (!slots) return <div className="text-[13px] text-muted">Loading availability…</div>;
  if (!slots.length) return <div className="text-[13px] text-muted">{emptyMessage}</div>;

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

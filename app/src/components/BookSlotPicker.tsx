"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "./ui";
import { fmtDayLong, fmtTime, londonDateKey, londonTime, londonWeekdayIndex, londonYMD } from "@/lib/time";
import { SESSION_MINUTES, type Clinic } from "@/lib/booking/rules";

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
  /**
   * True (default) boxes the list to a fixed height with its own scrollbar —
   * right for the admin/portal widgets this is embedded in, which sit
   * alongside other content on the page. The public booking page has nothing
   * below it competing for space, so it passes false and lets the list grow
   * with the page instead — a scrollbar nested inside the page's own scroll
   * reads as a bug, not a feature.
   */
  boxed = true,
  /**
   * "list" (default) is the day-by-day list everywhere. "responsive" shows a
   * month calendar on laptop-width screens and the same list on phones — the
   * public booking page, where a calendar reads well with room to spread out
   * but a phone is better served by every time at once.
   */
  layout = "list",
  /** how long each session runs — shown as "until 15:30" under a time in the calendar */
  sessionMinutes = SESSION_MINUTES,
}: {
  clinic: Clinic;
  selected: string | null;
  onSelect: (iso: string) => void;
  slotsUrl?: (clinic: Clinic) => string;
  emptyMessage?: string;
  boxed?: boolean;
  layout?: "list" | "responsive";
  sessionMinutes?: number;
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

  // Memoised so the calendar sees the same map until the slots actually change.
  const groups = useMemo(() => groupByDay(slots ?? []), [slots]);

  if (error) return <div className="text-[13px] text-muted">{error}</div>;
  if (!slots) return <div className="text-[13px] text-muted">Loading availability…</div>;
  if (!slots.length) return <div className="text-[13px] text-muted">{emptyMessage}</div>;

  const list = (
    <div className={`flex flex-col gap-3 ${boxed ? "max-h-[360px] overflow-y-auto pr-1" : ""}`}>
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

  if (layout === "list") return list;
  // Both views are the same slots and the same `selected`, so a time picked in
  // either opens the same details box. CSS picks which one the screen gets.
  return (
    <>
      <div className="md:hidden">{list}</div>
      <div className="hidden md:block">
        <SlotCalendar groups={groups} selected={selected} onSelect={onSelect} sessionMinutes={sessionMinutes} />
      </div>
    </>
  );
}

/** Slots grouped by London calendar day ("YYYY-MM-DD"), in order. */
function groupByDay(slots: string[]): Map<string, Date[]> {
  const groups = new Map<string, Date[]>();
  for (const iso of slots) {
    const d = new Date(iso);
    const key = londonDateKey(d);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  return groups;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const monthLabel = (y: number, m: number) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" }).format(
    londonTime(y, m, 1, 12),
  );

/**
 * A month calendar with the days that have free times shaded; picking a day
 * lists its times alongside. Month and day are London calendar dates
 * throughout, so the grid can't drift a day for a visitor in another timezone.
 */
function SlotCalendar({
  groups,
  selected,
  onSelect,
  sessionMinutes,
}: {
  groups: Map<string, Date[]>;
  selected: string | null;
  onSelect: (iso: string) => void;
  sessionMinutes: number;
}) {
  const dayKeys = useMemo(() => [...groups.keys()], [groups]);
  const firstKey = dayKeys[0];
  const selectedKey = selected ? londonDateKey(new Date(selected)) : null;
  const [activeDay, setActiveDay] = useState<string>(selectedKey ?? firstKey);
  // New slots (another session type or clinic) → start again on the first free day.
  useEffect(() => {
    setActiveDay((current) => (groups.has(current) ? current : firstKey));
  }, [groups, firstKey]);

  const [y0, m0] = (activeDay ?? firstKey).split("-").map(Number);
  const [month, setMonth] = useState({ y: y0, m: m0 });
  useEffect(() => {
    const [y, m] = (activeDay ?? firstKey).split("-").map(Number);
    setMonth({ y, m });
  }, [activeDay, firstKey]);

  // The months worth paging through: from the first free day's to the last's.
  const [fy, fm] = firstKey.split("-").map(Number);
  const [ly, lm] = dayKeys[dayKeys.length - 1].split("-").map(Number);
  const canPrev = month.y * 12 + month.m > fy * 12 + fm;
  const canNext = month.y * 12 + month.m < ly * 12 + lm;
  const shift = (delta: number) => {
    const idx = month.y * 12 + (month.m - 1) + delta;
    setMonth({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };

  const lead = londonWeekdayIndex(londonTime(month.y, month.m, 1, 12));
  const daysInMonth = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
  const today = londonYMD(new Date());
  const todayKey = `${today.y}-${pad2(today.m)}-${pad2(today.d)}`;
  const times = groups.get(activeDay) ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-serif text-[18px] font-medium">{monthLabel(month.y, month.m)}</span>
          <span className="flex gap-1.5">
            {[
              [-1, "‹", "Previous month", canPrev],
              [1, "›", "Next month", canNext],
            ].map(([delta, glyph, label, enabled]) => (
              <button
                key={String(delta)}
                type="button"
                aria-label={String(label)}
                disabled={!enabled}
                onClick={() => shift(Number(delta))}
                className="h-8 w-8 cursor-pointer rounded-full border border-line bg-card text-[15px] leading-none hover:bg-hoverbg disabled:cursor-default disabled:opacity-35"
              >
                {glyph}
              </button>
            ))}
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} aria-hidden="true" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            const key = `${month.y}-${pad2(month.m)}-${pad2(d)}`;
            const free = groups.has(key);
            const base =
              "flex aspect-square flex-col items-center justify-center gap-[3px] rounded-[10px] text-[13.5px] tabular-nums";
            const ring = key === todayKey ? " shadow-[inset_0_0_0_1px_var(--color-line)]" : "";
            if (!free) {
              return (
                <div key={key} className={`${base} text-faint${ring}`}>
                  {d}
                </div>
              );
            }
            const active = key === activeDay;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                aria-label={`${fmtDayLong(groups.get(key)![0])} — times available`}
                onClick={() => setActiveDay(key)}
                className={`${base} cursor-pointer font-semibold${ring} ${
                  active ? "bg-clay text-cream" : "bg-free text-sage-text hover:outline hover:outline-1 hover:outline-sage-text"
                }`}
              >
                {d}
                <span className="h-1 w-1 rounded-full bg-current opacity-70" />
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 flex gap-3.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px] bg-free" />
            Times free
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px] bg-clay" />
            Chosen day
          </span>
        </div>
        {activeDay !== firstKey && (
          <div className="mt-3 text-[12.5px]">
            Next free:{" "}
            <button
              type="button"
              onClick={() => setActiveDay(firstKey)}
              className="cursor-pointer font-semibold text-clay-text underline hover:text-clay"
            >
              {fmtDayLong(groups.get(firstKey)![0])}
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="font-serif text-[17px] font-medium">{times[0] ? fmtDayLong(times[0]) : ""}</div>
        <div className="mb-2.5 text-[12px] text-muted">
          {times.length} time{times.length === 1 ? "" : "s"} free · each runs {sessionMinutes} minutes
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {times.map((t) => {
            const iso = t.toISOString();
            const on = selected === iso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onSelect(iso)}
                className={`cursor-pointer rounded-full border py-2 text-[13px] font-medium tabular-nums select-none ${
                  on ? "border-clay bg-clay text-cream" : "border-line bg-card text-ink-soft hover:bg-hoverbg"
                }`}
              >
                {fmtTime(t)}
                <span className={`block text-[10.5px] font-normal ${on ? "text-cream/80" : "text-muted"}`}>
                  until {fmtTime(new Date(t.getTime() + sessionMinutes * 60_000))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

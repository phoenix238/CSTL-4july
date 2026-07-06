"use client";

// The one week grid used everywhere: the Calendar page (display mode) and the
// enquiry/booking slot picker (picker mode). Hours down the side, days across,
// events drawn as positioned blocks — a normal calendar.

import { useMemo } from "react";
import { slotConflicts, type BusySpanLite, type Clinic } from "@/lib/booking/rules";
import { fmtDayShort, fmtTime, londonMinutes, londonYMD } from "@/lib/time";
import { layoutDayEvents, SPAN_COLORS, type SpanDTO } from "./layout";

const HOUR_PX = 48;

export interface TimeGridProps {
  weekStart: Date;
  spans: SpanDTO[];
  startHour?: number;
  endHour?: number;
  mode: "display" | "picker";
  /** display mode: click an event block */
  onEventClick?: (span: SpanDTO, anchor: { x: number; y: number }) => void;
  /** display mode: click empty column space (snapped to 30 min) */
  onSlotClick?: (slot: Date) => void;
  /** picker mode config */
  picker?: {
    clinic: Clinic;
    /** selected session-start(s); confirm mode passes 0–1, offer mode several */
    selected: Date[];
    onToggle: (slot: Date) => void;
    slotMinutes?: number;
  };
}

const sameTime = (list: Date[], slot: Date) => list.some((d) => d.getTime() === slot.getTime());

interface DayEvent {
  span: SpanDTO;
  startMin: number;
  endMin: number;
}

const sameLondonDay = (a: Date, b: Date) => {
  const x = londonYMD(a);
  const y = londonYMD(b);
  return x.y === y.y && x.m === y.m && x.d === y.d;
};

export function TimeGrid({
  weekStart,
  spans,
  startHour = 7,
  endHour = 21,
  mode,
  onEventClick,
  onSlotClick,
  picker,
}: TimeGridProps) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86_400_000)),
    [weekStart],
  );
  const gridMinutes = (endHour - startHour) * 60;
  const gridHeight = (gridMinutes / 60) * HOUR_PX;
  const now = new Date();
  const slotMinutes = picker?.slotMinutes ?? 30;

  const toY = (min: number) => ((min - startHour * 60) / 60) * HOUR_PX;

  // Split spans into per-day events, clamped to the visible hour window.
  const dayEvents: DayEvent[][] = useMemo(
    () =>
      days.map((day) => {
        const dayStart = day;
        const dayEnd = new Date(day.getTime() + 86_400_000);
        return spans
          .filter((s) => new Date(s.start) < dayEnd && new Date(s.end) > dayStart)
          .map((s) => {
            const start = new Date(s.start);
            const end = new Date(s.end);
            const startMin = start <= dayStart ? 0 : londonMinutes(start);
            const endMin = end >= dayEnd ? 24 * 60 : londonMinutes(end) || 24 * 60;
            return {
              span: s,
              startMin: Math.max(startMin, startHour * 60),
              endMin: Math.min(endMin, endHour * 60),
            };
          })
          .filter((e) => e.endMin > e.startMin);
      }),
    [days, spans, startHour, endHour],
  );

  // Picker: free 30-min session-start slots per day.
  const spansLite: BusySpanLite[] = useMemo(
    () => spans.map((s) => ({ start: new Date(s.start), end: new Date(s.end), source: s.source, known: s.known, clinic: s.clinic })),
    [spans],
  );
  const freeSlots: Date[][] = useMemo(() => {
    if (mode !== "picker" || !picker) return days.map(() => []);
    return days.map((day) => {
      const out: Date[] = [];
      for (let m = startHour * 60; m + 60 <= endHour * 60; m += slotMinutes) {
        const slot = new Date(day.getTime() + m * 60_000);
        if (slot < now) continue;
        if (!slotConflicts(picker.clinic, slot, spansLite)) out.push(slot);
      }
      return out;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, picker?.clinic, days, spansLite, startHour, endHour, slotMinutes]);

  const handleColumnClick = (day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== "display" || !onSlotClick) return;
    if (e.target !== e.currentTarget) return; // ignore clicks on event blocks
    const rect = e.currentTarget.getBoundingClientRect();
    const min = startHour * 60 + Math.floor((e.clientY - rect.top) / HOUR_PX * 60 / 30) * 30;
    onSlotClick(new Date(day.getTime() + min * 60_000));
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[760px]">
        {/* day headers */}
        <div className="flex">
          <div className="w-12 flex-none" />
          {days.map((day) => {
            const isToday = sameLondonDay(day, now);
            return (
              <div key={day.toISOString()} className="flex-1 px-1 pb-1.5 text-center">
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                    isToday ? "bg-clay-tint text-clay-text" : "text-ink-soft"
                  }`}
                >
                  {fmtDayShort(day)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex rounded-2xl border border-line bg-card shadow-card">
          {/* hour axis */}
          <div className="relative w-12 flex-none" style={{ height: gridHeight }}>
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 -translate-y-1/2 text-[10.5px] font-medium tabular-nums text-faint"
                style={{ top: i * HOUR_PX }}
              >
                {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((day, di) => {
            const isToday = sameLondonDay(day, now);
            const laid = layoutDayEvents(dayEvents[di]);
            return (
              <div
                key={day.toISOString()}
                onClick={handleColumnClick(day)}
                className={`relative flex-1 border-l border-hairline ${
                  isToday ? "bg-[oklch(0.975_0.015_60)]" : ""
                } ${mode === "display" && onSlotClick ? "cursor-pointer" : ""}`}
                style={{ height: gridHeight }}
              >
                {/* hour hairlines */}
                {Array.from({ length: endHour - startHour - 1 }, (_, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute right-0 left-0 border-t border-hairline"
                    style={{ top: (i + 1) * HOUR_PX }}
                  />
                ))}

                {/* picker: free slot pills */}
                {mode === "picker" &&
                  picker &&
                  freeSlots[di].map((slot) => {
                    if (sameTime(picker.selected, slot)) return null; // drawn as a block below
                    const min = londonMinutes(slot);
                    return (
                      <button
                        key={slot.toISOString()}
                        onClick={() => picker.onToggle(slot)}
                        className="absolute right-[3px] left-[3px] z-10 cursor-pointer rounded-md bg-free px-1 text-[10.5px] font-semibold tabular-nums text-[oklch(0.35_0.05_148)] hover:bg-sage/40"
                        style={{ top: toY(min) + 1, height: (slotMinutes / 60) * HOUR_PX - 2 }}
                      >
                        {fmtTime(slot)}
                      </button>
                    );
                  })}

                {/* picker: chosen slot(s) = solid clay session block, tap to deselect */}
                {mode === "picker" &&
                  picker &&
                  picker.selected
                    .filter((s) => sameLondonDay(s, day))
                    .map((s) => (
                      <button
                        key={s.toISOString()}
                        onClick={() => picker.onToggle(s)}
                        className="absolute right-[3px] left-[3px] z-20 flex cursor-pointer items-start justify-center rounded-lg bg-clay px-1 pt-1 text-[11px] font-semibold text-cream shadow-pop hover:bg-clay-deep"
                        style={{ top: toY(londonMinutes(s)), height: HOUR_PX }}
                      >
                        {fmtTime(s)} · chosen
                      </button>
                    ))}

                {/* event blocks */}
                {laid.map(({ event, lane, lanes }, i) => {
                  const c = SPAN_COLORS[event.span.source];
                  const clickable = mode === "display" && onEventClick;
                  const pickerDim = mode === "picker";
                  return (
                    <div
                      key={i}
                      onClick={
                        clickable
                          ? (e) => {
                              e.stopPropagation();
                              onEventClick(event.span, { x: e.clientX, y: e.clientY });
                            }
                          : undefined
                      }
                      className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[10.5px] leading-tight ${
                        clickable ? "cursor-pointer hover:brightness-[0.97]" : ""
                      }`}
                      style={{
                        top: toY(event.startMin) + 1,
                        height: Math.max(((event.endMin - event.startMin) / 60) * HOUR_PX - 2, 14),
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        background: c.bg,
                        borderLeft: `3px solid ${c.border}`,
                        color: c.text,
                        opacity: pickerDim ? 0.75 : 1,
                        zIndex: 5,
                      }}
                    >
                      <div className="font-semibold tabular-nums">
                        {fmtTime(new Date(event.span.start))}–{fmtTime(new Date(event.span.end))}
                      </div>
                      <div className="truncate">{event.span.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

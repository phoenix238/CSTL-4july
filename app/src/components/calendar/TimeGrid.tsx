"use client";

// The one week grid used everywhere: the Calendar page (display mode) and the
// enquiry/booking slot picker (picker mode). Hours down the side, days across,
// events drawn as positioned blocks — a normal calendar. Choosing a time works
// the Google-Calendar way: hover to see the 15-min-snapped time, drag empty
// space to create, drag an event to move it.

import { useCallback, useMemo, useRef, useState } from "react";
import { blockedRange, type Clinic } from "@/lib/booking/rules";
import { fmtDayShort, fmtTime, londonAddDays, londonMinutes, londonTime, londonYMD } from "@/lib/time";
import { layoutDayEvents, SPAN_COLORS, type SpanDTO } from "./layout";

const HOUR_PX = 48;
// Choosing a time snaps to this (Google-Calendar-style 15-min steps).
const SNAP_MIN = 15;

export interface TimeGridProps {
  weekStart: Date;
  spans: SpanDTO[];
  startHour?: number;
  endHour?: number;
  mode: "display" | "picker";
  /** display mode: click an event block */
  onEventClick?: (span: SpanDTO, anchor: { x: number; y: number }) => void;
  /** display mode: click empty column space (snapped to 15 min) */
  onSlotClick?: (slot: Date) => void;
  /** display mode: drag empty column space to select a time range (15-min snap) */
  onRangeSelect?: (start: Date, end: Date) => void;
  /** display mode: drag an existing event to a new start (same day, 15-min snap) */
  onEventMove?: (span: SpanDTO, newStart: Date) => void;
  /** picker mode config */
  picker?: {
    clinic: Clinic;
    /** selected session-start(s); confirm mode passes 0–1, offer mode several */
    selected: Date[];
    onToggle: (slot: Date) => void;
  };
}

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

/**
 * The exact instant `min` minutes past midnight on `day`'s London date.
 * Built from the wall-clock date (not `day.getTime() + min*60_000`), so a slot
 * chosen on a DST-transition day resolves to the right hour, not one off.
 */
const slotAt = (day: Date, min: number): Date => {
  const { y, m, d } = londonYMD(day);
  return londonTime(y, m, d, Math.floor(min / 60), min % 60);
};

export function TimeGrid({
  weekStart,
  spans,
  startHour = 7,
  endHour = 21,
  mode,
  onEventClick,
  onSlotClick,
  onRangeSelect,
  onEventMove,
  picker,
}: TimeGridProps) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => londonAddDays(weekStart, i)),
    [weekStart],
  );
  const gridMinutes = (endHour - startHour) * 60;
  const gridHeight = (gridMinutes / 60) * HOUR_PX;
  const now = new Date();

  // Live "where you're about to book" indicator — the day column under the
  // cursor and the 15-min-snapped minute, so choosing a time feels precise.
  const [hover, setHover] = useState<{ di: number; min: number } | null>(null);

  const toY = (min: number) => ((min - startHour * 60) / 60) * HOUR_PX;
  const snapMinFromY = (offsetY: number) =>
    startHour * 60 + Math.floor((offsetY / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;

  // Would a clinic session starting at `slot` collide with anything busy?
  // The shared Chalk Farm room block is excluded — only real sessions count.
  const isBusyAt = (clinic: Clinic, slot: Date) => {
    const { start, end } = blockedRange(clinic, slot);
    return spans.some((s) => !s.roomBlock && new Date(s.start) < end && new Date(s.end) > start);
  };

  const slotSelectable = mode === "display" && (!!onSlotClick || !!onRangeSelect);
  const pickerSelectable = mode === "picker" && !!picker;

  const isMovable = (span: SpanDTO) =>
    mode === "display" &&
    !!onEventMove &&
    ((span.source === "booking" && !!span.bookingId) || (span.source === "personal" && !!span.googleEventId));

  // Split spans into per-day events, clamped to the visible hour window.
  const dayEvents: DayEvent[][] = useMemo(
    () =>
      days.map((day) => {
        const dayStart = day;
        const dayEnd = londonAddDays(day, 1);
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

  // Latest props/config for the stable window drag handlers (avoids stale closures).
  const cfgRef = useRef({ startHour, endHour, onSlotClick, onRangeSelect, onEventClick, onEventMove });
  cfgRef.current = { startHour, endHour, onSlotClick, onRangeSelect, onEventClick, onEventMove };

  /* ---------- drag empty space to create a range (display) ---------- */
  const dragRef = useRef<{ di: number; day: Date; rectTop: number; startMin: number } | null>(null);
  const [dragSel, setDragSel] = useState<{ di: number; a: number; b: number } | null>(null);

  const clampMin = (m: number, sh: number, eh: number) => Math.max(sh * 60, Math.min(eh * 60, m));
  const minFromY = (y: number, sh: number) => sh * 60 + Math.floor((y / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { startHour: sh, endHour: eh } = cfgRef.current;
    const cur = clampMin(minFromY(e.clientY - d.rectTop, sh), sh, eh);
    setDragSel({ di: d.di, a: Math.min(d.startMin, cur), b: Math.max(d.startMin, cur) });
  }, []);

  const onDragUp = useCallback(
    (e: MouseEvent) => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDragSel(null);
      if (!d) return;
      const { startHour: sh, endHour: eh, onSlotClick: click, onRangeSelect: range } = cfgRef.current;
      const cur = clampMin(minFromY(e.clientY - d.rectTop, sh), sh, eh);
      const a = Math.min(d.startMin, cur);
      const b = Math.max(d.startMin, cur);
      if (b - a >= SNAP_MIN && range) range(slotAt(d.day, a), slotAt(d.day, b));
      else if (click) click(slotAt(d.day, d.startMin));
    },
    [onDragMove],
  );

  const handleColumnDown = (day: Date, di: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!slotSelectable || e.button !== 0 || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { di, day, rectTop: rect.top, startMin: snapMinFromY(e.clientY - rect.top) };
    setHover(null);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragUp);
  };

  /* ---------- drag an existing event to move it (display) ---------- */
  const evDragRef = useRef<
    { span: SpanDTO; di: number; day: Date; rectTop: number; grabOffset: number; durationMin: number; lastStartMin: number; moved: boolean } | null
  >(null);
  const [evGhost, setEvGhost] = useState<{ di: number; startMin: number; durationMin: number } | null>(null);

  const onEvMove = useCallback((e: MouseEvent) => {
    const d = evDragRef.current;
    if (!d) return;
    const { startHour: sh, endHour: eh } = cfgRef.current;
    let start = minFromY(e.clientY - d.rectTop, sh) - d.grabOffset;
    start = Math.max(sh * 60, Math.min(eh * 60 - d.durationMin, start));
    if (Math.abs(start - londonMinutes(new Date(d.span.start))) >= SNAP_MIN) d.moved = true;
    d.lastStartMin = start;
    setEvGhost({ di: d.di, startMin: start, durationMin: d.durationMin });
  }, []);

  const onEvUp = useCallback(
    (e: MouseEvent) => {
      window.removeEventListener("mousemove", onEvMove);
      window.removeEventListener("mouseup", onEvUp);
      const d = evDragRef.current;
      evDragRef.current = null;
      setEvGhost(null);
      if (!d) return;
      const { onEventClick: click, onEventMove: move } = cfgRef.current;
      if (d.moved && move) move(d.span, slotAt(d.day, d.lastStartMin));
      else if (click) click(d.span, { x: e.clientX, y: e.clientY });
    },
    [onEvMove],
  );

  const handleEventDown = (span: SpanDTO, di: number, day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't start a column range-drag
    const column = e.currentTarget.parentElement;
    const rectTop = column ? column.getBoundingClientRect().top : e.currentTarget.getBoundingClientRect().top;
    const start = new Date(span.start);
    const end = new Date(span.end);
    const origStartMin = londonMinutes(start);
    const durationMin = Math.max(SNAP_MIN, Math.round((end.getTime() - start.getTime()) / 60_000));
    const grabOffset = snapMinFromY(e.clientY - rectTop) - origStartMin;
    evDragRef.current = { span, di, day, rectTop, grabOffset, durationMin, lastStartMin: origStartMin, moved: false };
    setEvGhost({ di, startMin: origStartMin, durationMin });
    window.addEventListener("mousemove", onEvMove);
    window.addEventListener("mouseup", onEvUp);
  };

  /* ---------- hover + picker tap ---------- */
  const handleColumnHover = (di: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if ((!slotSelectable && !pickerSelectable) || dragRef.current || evDragRef.current) return;
    if (e.target !== e.currentTarget) {
      setHover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({ di, min: snapMinFromY(e.clientY - rect.top) });
  };

  const handlePickerTap = (day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickerSelectable || !picker || e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = snapMinFromY(e.clientY - rect.top);
    const slot = slotAt(day, min);
    if (slot < now || isBusyAt(picker.clinic, slot)) return; // only free future times
    picker.onToggle(slot);
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
            // picker hover: is the hovered time free / busy / past?
            const hoverSlot = hover?.di === di ? slotAt(day, hover.min) : null;
            const hoverBlocked =
              pickerSelectable && hoverSlot ? hoverSlot < now || isBusyAt(picker!.clinic, hoverSlot) : false;
            return (
              <div
                key={day.toISOString()}
                onMouseDown={slotSelectable ? handleColumnDown(day, di) : undefined}
                onClick={pickerSelectable ? handlePickerTap(day) : undefined}
                onMouseMove={handleColumnHover(di)}
                onMouseLeave={() => setHover((h) => (h?.di === di ? null : h))}
                className={`relative flex-1 border-l border-hairline ${
                  isToday ? "bg-[oklch(0.975_0.015_60)]" : ""
                } ${slotSelectable || pickerSelectable ? "cursor-pointer select-none" : ""}`}
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

                {/* drag-to-create selection — the clay range you're sweeping out */}
                {dragSel?.di === di && dragSel.b > dragSel.a && (
                  <div
                    className="pointer-events-none absolute right-[3px] left-[3px] z-30 flex items-start justify-start rounded-md border border-clay/70 bg-clay-tint/70 px-1 pt-0.5"
                    style={{ top: toY(dragSel.a), height: ((dragSel.b - dragSel.a) / 60) * HOUR_PX }}
                  >
                    <span className="rounded-full bg-clay px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop">
                      {fmtTime(slotAt(day, dragSel.a))}–{fmtTime(slotAt(day, dragSel.b))}
                    </span>
                  </div>
                )}

                {/* moving-event ghost */}
                {evGhost?.di === di && (
                  <div
                    className="pointer-events-none absolute right-[3px] left-[3px] z-30 flex items-start justify-start rounded-md border border-clay bg-clay-tint/80 px-1 pt-0.5"
                    style={{ top: toY(evGhost.startMin), height: (evGhost.durationMin / 60) * HOUR_PX }}
                  >
                    <span className="rounded-full bg-clay px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop">
                      {fmtTime(slotAt(day, evGhost.startMin))}
                    </span>
                  </div>
                )}

                {/* display: "book here" clay ghost that follows the cursor (15-min snap) */}
                {slotSelectable && !dragSel && !evGhost && hover?.di === di && hover.min + 60 <= endHour * 60 && (
                  <div className="pointer-events-none absolute right-[3px] left-[3px] z-20" style={{ top: toY(hover.min) }}>
                    <div className="rounded-md border border-dashed border-clay/60 bg-clay-tint/50" style={{ height: HOUR_PX }} />
                    <div className="absolute -top-[1px] left-0">
                      <span className="rounded-full bg-clay px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop">
                        {fmtTime(slotAt(day, hover.min))}
                      </span>
                    </div>
                  </div>
                )}

                {/* picker: free/busy ghost of the session you'd pick */}
                {pickerSelectable && hoverSlot && hover!.min + 60 <= endHour * 60 && (
                  <div
                    className="pointer-events-none absolute right-[3px] left-[3px] z-20 rounded-md border"
                    style={{
                      top: toY(hover!.min),
                      height: HOUR_PX,
                      borderColor: hoverBlocked ? "oklch(0.72 0.12 25)" : "oklch(0.62 0.13 148)",
                      background: hoverBlocked ? "oklch(0.95 0.04 25 / 0.45)" : "oklch(0.92 0.06 148 / 0.5)",
                    }}
                  >
                    <span
                      className="rounded-full px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop"
                      style={{ background: hoverBlocked ? "oklch(0.6 0.16 25)" : "oklch(0.5 0.1 148)" }}
                    >
                      {hoverBlocked ? "busy" : fmtTime(hoverSlot)}
                    </span>
                  </div>
                )}

                {/* picker: chosen slot(s) = solid clay session block, tap to deselect */}
                {pickerSelectable &&
                  picker!.selected
                    .filter((s) => sameLondonDay(s, day))
                    .map((s) => (
                      <button
                        key={s.toISOString()}
                        onClick={(e) => {
                          e.stopPropagation();
                          picker!.onToggle(s);
                        }}
                        className="absolute right-[3px] left-[3px] z-40 flex cursor-pointer items-start justify-center rounded-lg bg-clay px-1 pt-1 text-[11px] font-semibold text-cream shadow-pop hover:bg-clay-deep"
                        style={{ top: toY(londonMinutes(s)), height: HOUR_PX }}
                      >
                        {fmtTime(s)} · chosen
                      </button>
                    ))}

                {/* event blocks */}
                {laid.map(({ event, lane, lanes }, i) => {
                  const c = SPAN_COLORS[event.span.source];
                  const movable = isMovable(event.span);
                  const clickable = mode === "display" && !!onEventClick;
                  const pickerDim = mode === "picker";
                  return (
                    <div
                      key={i}
                      onMouseDown={movable ? handleEventDown(event.span, di, day) : undefined}
                      onClick={
                        !movable && clickable
                          ? (e) => {
                              e.stopPropagation();
                              onEventClick!(event.span, { x: e.clientX, y: e.clientY });
                            }
                          : undefined
                      }
                      className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[10.5px] leading-tight ${
                        movable ? "cursor-grab active:cursor-grabbing select-none" : clickable ? "cursor-pointer hover:brightness-[0.97]" : ""
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

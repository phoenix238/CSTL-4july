"use client";

// The one time grid used everywhere: the Calendar page (display mode) and the
// enquiry/booking slot picker (picker mode). Hours down the side, days across,
// events drawn as positioned blocks — a normal calendar. It renders any number
// of days (3 on a phone, 7 on a laptop), which is the only thing that changes
// between the two.
//
// Choosing a time works two ways, one per input device:
//   • mouse — hover to see the 15-min-snapped time, drag empty space to create,
//     drag an event to move it. Precise, so a drag commits straight away.
//   • touch — press and hold empty space until it buzzes, then slide down to
//     set the length. That leaves a draft block on the grid with a handle at
//     each end: drag either end to resize, drag the middle to move it (across
//     days too), then confirm from the bar that appears. A finger can't hit a
//     15-minute band first time, so the draft is adjustable before it commits.
// A plain tap is untouched by all of this and still books the slot directly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blockedRange, type Clinic } from "@/lib/booking/rules";
import { fmtDayShort, fmtTime, londonAddDays, londonDateKey, londonMinutes, londonTime, londonYMD } from "@/lib/time";
import { AVAIL_COLORS, CLINIC_LABEL, layoutDayEvents, SPAN_COLORS, type AvailClinic, type AvailWindowDTO, type SpanDTO } from "./layout";
import { haptic } from "./haptics";

/** Default height of one hour. Adjustable at runtime — see the `hourPx` prop. */
export const HOUR_PX = 48;
/** How far the zoom control can go: a whole day in view, or a few hours. */
export const HOUR_PX_MIN = 26;
export const HOUR_PX_MAX = 104;
// Choosing a time snaps to this (Google-Calendar-style 15-min steps).
const SNAP_MIN = 15;
/** How long a finger has to rest before a press becomes a draft event. */
const LONG_PRESS_MS = 380;
/** Movement over this many px before the timer fires means "scrolling", not "pressing". */
const LONG_PRESS_SLOP_PX = 10;
/** Default length of a freshly long-pressed draft. */
const DEFAULT_DRAFT_MIN = 60;
/** Horizontal travel that counts as a swipe to the next page. */
const SWIPE_PX = 55;

export interface TimeGridProps {
  /** First day shown, at 00:00 London. */
  start: Date;
  /** How many day columns to draw. 3 reads well on a phone, 7 on a laptop. */
  days?: number;
  spans: SpanDTO[];
  startHour?: number;
  endHour?: number;
  mode: "display" | "picker";
  /** display mode: click an event block */
  onEventClick?: (span: SpanDTO, anchor: { x: number; y: number }) => void;
  /** display mode: click empty column space (snapped to 15 min) */
  onSlotClick?: (slot: Date) => void;
  /** display mode: a time range was chosen — by mouse drag, or by confirming a touch draft */
  onRangeSelect?: (start: Date, end: Date) => void;
  /** display mode: drag an existing event to a new start (same day, 15-min snap) */
  onEventMove?: (span: SpanDTO, newStart: Date) => void;
  /** swipe left/right (or the parent's own buttons) to page the range */
  onPage?: (dir: -1 | 1) => void;
  /**
   * Fill the parent's box and scroll the hours inside it, day headers pinned,
   * edge to edge — the immersive treatment a phone wants. Off by default, where
   * the grid renders at its natural height and the page does the scrolling.
   */
  fill?: boolean;
  /**
   * fill mode: where to start the hour scroll. null opens on the current time.
   * Paging remounts the grid to restart its slide animation, so the parent
   * holds this and hands it back — otherwise every flick would throw you back
   * to the morning.
   */
  initialScrollTop?: number | null;
  /** fill mode: report the hour scroll so the parent can hand it back after a page turn */
  onScrollTop?: (top: number) => void;
  /**
   * Height of one hour, in pixels — the zoom. Small shows a whole day at once,
   * large opens up a few hours to work in. Clamped by the caller to
   * HOUR_PX_MIN..HOUR_PX_MAX.
   */
  hourPx?: number;
  /**
   * availability mode: green background windows the practitioner is bookable in.
   * When set, the drag-to-select ghost reads as "Available" (green), so dragging
   * marks availability rather than adding an event.
   */
  availWindows?: AvailWindowDTO[];
  /** Why a day has nothing bookable, keyed by London date key — shown in-column. */
  dayNotes?: Record<string, string>;
  /** availability mode: click an editable (open/block) availability window */
  onAvailabilityClick?: (w: AvailWindowDTO) => void;
  /** true while the calendar is in availability-editing mode */
  availabilityMode?: boolean;
  /** availability mode: the clinic a newly-drawn window will belong to, used to colour the drag ghost */
  activeClinic?: AvailClinic;
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

/** A block being sketched out by touch, before it's committed to the composer. */
interface Draft {
  di: number;
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
  start,
  days: dayCount = 7,
  spans,
  startHour = 7,
  // Runs to 22:00 so a late evening session — 20:15–21:15, or a slot bookable
  // to 21:30 — is fully visible rather than clipped at the bottom edge.
  endHour = 22,
  mode,
  onEventClick,
  onSlotClick,
  onRangeSelect,
  onEventMove,
  onPage,
  fill = false,
  initialScrollTop = null,
  onScrollTop,
  hourPx = HOUR_PX,
  availWindows,
  dayNotes,
  onAvailabilityClick,
  availabilityMode = false,
  activeClinic = "bethnal",
  picker,
}: TimeGridProps) {
  const ghostColor = AVAIL_COLORS[activeClinic].open;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => londonAddDays(start, i)),
    [start, dayCount],
  );
  const gridMinutes = (endHour - startHour) * 60;
  const gridHeight = (gridMinutes / 60) * hourPx;
  const now = new Date();

  // Columns fit the width rather than scrolling sideways — which is what frees a
  // horizontal swipe to mean "next page". True for any small range, and always
  // true in fill mode, so a phone can swipe across a full week as readily as
  // across three days.
  const compact = fill || dayCount <= 4;

  // Live "where you're about to book" indicator — the day column under the
  // cursor and the 15-min-snapped minute, so choosing a time feels precise.
  const [hover, setHover] = useState<{ di: number; min: number } | null>(null);

  const toY = (min: number) => ((min - startHour * 60) / 60) * hourPx;
  const snapMinFromY = (offsetY: number) =>
    startHour * 60 + Math.floor((offsetY / hourPx) * 60 / SNAP_MIN) * SNAP_MIN;

  // Would a clinic session starting at `slot` collide with anything busy?
  // The shared Chalk Farm room block is excluded — only real sessions count.
  const isBusyAt = (clinic: Clinic, slot: Date) => {
    const { start: bs, end: be } = blockedRange(clinic, slot);
    return spans.some((s) => !s.roomBlock && new Date(s.start) < be && new Date(s.end) > bs);
  };

  const slotSelectable = mode === "display" && (!!onSlotClick || !!onRangeSelect);
  const pickerSelectable = mode === "picker" && !!picker;

  // Only client sessions can be dragged. Everything else on this grid belongs to
  // a calendar this app doesn't own — your own Google entries, the venue's room
  // events, the shared Chalk Farm block — and dragging those from here moves
  // real appointments that have nothing to do with a booking. A personal event
  // is still editable, deliberately, by tapping it and using the composer.
  const isMovable = (span: SpanDTO) =>
    mode === "display" && !!onEventMove && span.source === "booking" && !!span.bookingId;

  // Split spans into per-day events, clamped to the visible hour window.
  const dayEvents: DayEvent[][] = useMemo(
    () =>
      days.map((day) => {
        const dayStart = day;
        const dayEnd = londonAddDays(day, 1);
        return spans
          .filter((s) => new Date(s.start) < dayEnd && new Date(s.end) > dayStart)
          .map((s) => {
            const st = new Date(s.start);
            const en = new Date(s.end);
            const startMin = st <= dayStart ? 0 : londonMinutes(st);
            const endMin = en >= dayEnd ? 24 * 60 : londonMinutes(en) || 24 * 60;
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

  // Availability windows split per visible day (by London date key), clamped to
  // the visible hour window — drawn as a background layer behind events.
  const dayAvail: AvailWindowDTO[][] = useMemo(() => {
    if (!availWindows?.length) return days.map(() => []);
    const lo = startHour * 60;
    const hi = endHour * 60;
    return days.map((day) => {
      const key = londonDateKey(day);
      return availWindows
        .filter((w) => w.date === key)
        .map((w) => ({ ...w, startMin: Math.max(w.startMin, lo), endMin: Math.min(w.endMin, hi) }))
        .filter((w) => w.endMin > w.startMin);
    });
  }, [availWindows, days, startHour, endHour]);

  // Latest props/config for the stable window drag handlers (avoids stale closures).
  const cfgRef = useRef({ startHour, endHour, dayCount, hourPx, onSlotClick, onRangeSelect, onEventClick, onEventMove, onPage });
  cfgRef.current = { startHour, endHour, dayCount, hourPx, onSlotClick, onRangeSelect, onEventClick, onEventMove, onPage };

  const clampMin = (m: number, sh: number, eh: number) => Math.max(sh * 60, Math.min(eh * 60, m));
  const minFromY = (y: number, sh: number) =>
    sh * 60 + Math.floor((y / cfgRef.current.hourPx) * 60 / SNAP_MIN) * SNAP_MIN;

  /* ---------- touch draft: long-press to create, handles to adjust ---------- */

  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const setDraftBoth = useCallback((d: Draft | null) => {
    draftRef.current = d;
    setDraft(d);
  }, []);

  // True while a draft gesture owns the finger — the grid must not scroll under
  // it. touch-action can't express this (it's decided before the gesture starts),
  // so a non-passive touchmove listener vetoes the scroll for exactly as long as
  // the gesture lasts.
  const scrollLock = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const vScrollRef = useRef<HTMLDivElement>(null);

  // Open on the hour you're actually in, the way a calendar app does, rather
  // than at the top of the working day — unless the parent kept a position from
  // before a page turn, which wins.
  useEffect(() => {
    if (!fill) return;
    const el = vScrollRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const target =
      initialScrollTop ??
      ((londonMinutes(new Date()) - 60) / 60 - startHour) * hourPx; // an hour of lead-in
    el.scrollTop = Math.max(0, Math.min(target, max));
    // Mount only: re-running would yank the grid back while it's being read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  // Zooming rescales the hours under a fixed scroll offset, which would slide
  // the view to a different time of day. Scaling the offset by the same factor
  // keeps you looking at the hour you were looking at.
  const prevHourPx = useRef(hourPx);
  useEffect(() => {
    const el = vScrollRef.current;
    if (el && prevHourPx.current !== hourPx) {
      el.scrollTop = (el.scrollTop * hourPx) / prevHourPx.current;
    }
    prevHourPx.current = hourPx;
  }, [hourPx]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const veto = (e: TouchEvent) => {
      if (scrollLock.current) e.preventDefault();
    };
    el.addEventListener("touchmove", veto, { passive: false });
    return () => el.removeEventListener("touchmove", veto);
  }, []);

  // Geometry of the day columns, measured when a gesture starts so a draft can
  // be dragged sideways onto another day.
  const columnGeometry = () => {
    const el = bodyRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const axis = 48; // the hour gutter, w-12
    const colWidth = (rect.width - axis) / cfgRef.current.dayCount;
    return { top: rect.top, left: rect.left + axis, colWidth };
  };

  const dayIndexAt = (clientX: number, geo: { left: number; colWidth: number }) =>
    Math.max(0, Math.min(cfgRef.current.dayCount - 1, Math.floor((clientX - geo.left) / geo.colWidth)));

  // Paging swaps this component out, so a gesture still holding window
  // listeners has to be able to be torn down from the outside.
  const teardown = useRef<(() => void) | null>(null);
  useEffect(() => () => teardown.current?.(), []);

  /** Run a pointer-driven draft gesture until the finger lifts. */
  const runDraftGesture = (
    onMove: (ev: PointerEvent, geo: { top: number; left: number; colWidth: number }) => void,
    onEnd?: () => void,
  ) => {
    const geo = columnGeometry();
    if (!geo) return;
    scrollLock.current = true;
    const move = (ev: PointerEvent) => onMove(ev, geo);
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      scrollLock.current = false;
      teardown.current = null;
      onEnd?.();
    };
    teardown.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  /** Long-press then slide: create a draft and grow it while the finger stays down. */
  const beginDraftSizing = (di: number, anchorMin: number) => {
    haptic();
    const st = clampMin(anchorMin, startHour, endHour);
    const en = clampMin(st + DEFAULT_DRAFT_MIN, startHour, endHour);
    setDraftBoth({ di, startMin: st, endMin: Math.max(en, st + SNAP_MIN) });
    runDraftGesture((ev, geo) => {
      const { startHour: sh, endHour: eh } = cfgRef.current;
      const cur = clampMin(minFromY(ev.clientY - geo.top, sh), sh, eh);
      // Sliding above the origin flips the block, the way dragging a selection does.
      const a = Math.min(st, cur);
      const b = Math.max(st, cur);
      setDraftBoth({ di, startMin: a, endMin: Math.max(b, a + SNAP_MIN) });
    });
  };

  /** Drag one end of an existing draft. */
  const beginDraftResize = (edge: "top" | "bottom") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const d = draftRef.current;
    if (!d) return;
    haptic(8);
    const fixed = edge === "top" ? d.endMin : d.startMin;
    runDraftGesture((ev, geo) => {
      const { startHour: sh, endHour: eh } = cfgRef.current;
      const cur = clampMin(minFromY(ev.clientY - geo.top, sh), sh, eh);
      const a = Math.min(fixed, cur);
      const b = Math.max(fixed, cur);
      setDraftBoth({ di: d.di, startMin: a, endMin: Math.max(b, a + SNAP_MIN) });
    });
  };

  /** Drag the middle of a draft to move it — to another time, or another day. */
  const beginDraftMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const d = draftRef.current;
    if (!d) return;
    const geo = columnGeometry();
    if (!geo) return;
    haptic(8);
    const duration = d.endMin - d.startMin;
    const grabOffset = minFromY(e.clientY - geo.top, startHour) - d.startMin;
    runDraftGesture((ev, g) => {
      const { startHour: sh, endHour: eh } = cfgRef.current;
      let s = minFromY(ev.clientY - g.top, sh) - grabOffset;
      s = Math.max(sh * 60, Math.min(eh * 60 - duration, s));
      setDraftBoth({ di: dayIndexAt(ev.clientX, g), startMin: s, endMin: s + duration });
    });
  };

  const commitDraft = () => {
    const d = draftRef.current;
    const { onRangeSelect: range } = cfgRef.current;
    setDraftBoth(null);
    if (!d || !range) return;
    const day = days[d.di] ?? days[0];
    range(slotAt(day, d.startMin), slotAt(day, d.endMin));
  };

  // Paging or a range change pulls the ground out from under a draft, so drop it.
  useEffect(() => {
    setDraftBoth(null);
  }, [start, dayCount, setDraftBoth]);

  /* ---------- pointer down on empty column space ---------- */

  // One handler covers three outcomes, decided by what the pointer does next:
  // a mouse drag sweeps a range and commits; a still finger becomes a draft;
  // a finger that travels sideways pages the calendar.
  const pressRef = useRef<{
    di: number;
    day: Date;
    rectTop: number;
    startMin: number;
    x: number;
    y: number;
    at: number;
    touch: boolean;
    longPressed: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const [dragSel, setDragSel] = useState<{ di: number; a: number; b: number } | null>(null);
  /** When the last swipe finished, so its trailing tap can be ignored. */
  const swipedAt = useRef(0);

  /**
   * Paging is read here, in the capture phase on the whole grid, rather than on
   * the day columns — because a session block stops the event from reaching its
   * column, so a flick that happened to start on one used to open that session
   * instead of turning the page. Capture sees the gesture first whatever it
   * lands on, and because it runs before the target's own handler, the checks
   * below still see a drag that's genuinely in progress and stand down for it.
   */
  const handleSwipeCapture = (e: React.PointerEvent) => {
    if (!compact || !onPage || e.pointerType === "mouse" || e.button !== 0) return;
    const from = { x: e.clientX, y: e.clientY, at: Date.now() };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      // Something is being dragged or resized — that gesture owns the finger.
      if (draftRef.current || evDragRef.current) return;
      const dx = ev.clientX - from.x;
      const dy = ev.clientY - from.y;
      if (
        Math.abs(dx) > SWIPE_PX &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        Date.now() - from.at < 600
      ) {
        // Stamped before the target's handler runs, so the tap it would
        // otherwise report — opening a session, booking a slot — is swallowed.
        swipedAt.current = Date.now();
        cfgRef.current.onPage?.(dx > 0 ? -1 : 1);
      }
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  /** True when the gesture that just ended was a page turn, not a tap. */
  const justSwiped = () => Date.now() - swipedAt.current < 400;

  const handleColumnDown = (day: Date, di: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    // A live draft swallows the next tap outside it: that's how you dismiss it.
    if (draftRef.current) {
      setDraftBoth(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.pointerType !== "mouse";
    const p = {
      di,
      day,
      rectTop: rect.top,
      startMin: snapMinFromY(e.clientY - rect.top),
      x: e.clientX,
      y: e.clientY,
      at: Date.now(),
      touch,
      longPressed: false,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    pressRef.current = p;
    setHover(null);

    // Touch: after a still moment, the press becomes a draft block — but only
    // where there's somewhere for it to go. While a reschedule is in flight
    // there's no range handler, and a draft would be uncommittable.
    if (touch && slotSelectable && !!cfgRef.current.onRangeSelect) {
      p.timer = setTimeout(() => {
        const cur = pressRef.current;
        if (!cur) return;
        cur.longPressed = true;
        cleanup();
        beginDraftSizing(cur.di, cur.startMin);
      }, LONG_PRESS_MS);
    }

    const move = (ev: PointerEvent) => {
      const d = pressRef.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      // Any real travel before the timer means this is a scroll or a swipe.
      if (d.timer && Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) {
        clearTimeout(d.timer);
        d.timer = null;
      }
      // Mouse only: sweep out a range, exactly as before.
      if (!d.touch && slotSelectable) {
        const { startHour: sh, endHour: eh } = cfgRef.current;
        const cur = clampMin(minFromY(ev.clientY - d.rectTop, sh), sh, eh);
        setDragSel({ di: d.di, a: Math.min(d.startMin, cur), b: Math.max(d.startMin, cur) });
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      const d = pressRef.current;
      if (d?.timer) clearTimeout(d.timer);
      pressRef.current = null;
      setDragSel(null);
    };
    const up = (ev: PointerEvent) => {
      const d = pressRef.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      cleanup();
      if (d.longPressed) return; // the draft gesture owns it now
      // Paging is decided in handleSwipeCapture; if that's what this was, the
      // gesture is spent and must not also book a slot.
      if (justSwiped()) return;
      if (!slotSelectable) return;

      const { startHour: sh, endHour: eh, onSlotClick: click, onRangeSelect: range } = cfgRef.current;
      if (!d.touch) {
        const cur = clampMin(minFromY(ev.clientY - d.rectTop, sh), sh, eh);
        const a = Math.min(d.startMin, cur);
        const b = Math.max(d.startMin, cur);
        if (b - a >= SNAP_MIN && range) {
          range(slotAt(d.day, a), slotAt(d.day, b));
          return;
        }
      }
      // A tap — on either device — books the slot directly.
      if (Math.hypot(dx, dy) <= LONG_PRESS_SLOP_PX && click) click(slotAt(d.day, d.startMin));
    };
    const cancel = () => cleanup();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  /* ---------- drag an existing event to move it (display) ---------- */
  const evDragRef = useRef<
    { span: SpanDTO; di: number; day: Date; rectTop: number; grabOffset: number; durationMin: number; lastStartMin: number; moved: boolean } | null
  >(null);
  const [evGhost, setEvGhost] = useState<{ di: number; startMin: number; durationMin: number } | null>(null);

  const handleEventDown = (span: SpanDTO, di: number, day: Date) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't start a column range-drag
    const column = e.currentTarget.parentElement;
    const rectTop = column ? column.getBoundingClientRect().top : e.currentTarget.getBoundingClientRect().top;
    const st = new Date(span.start);
    const en = new Date(span.end);
    const origStartMin = londonMinutes(st);
    const durationMin = Math.max(SNAP_MIN, Math.round((en.getTime() - st.getTime()) / 60_000));
    const grabOffset = snapMinFromY(e.clientY - rectTop) - origStartMin;
    const touch = e.pointerType !== "mouse";
    const downX = e.clientX;
    const downY = e.clientY;

    // A mouse is precise, so it picks the session up on contact. A finger has to
    // rest on it first: scrolling the page and swiping between days both begin
    // as a touch that lands on an event, and neither should move a client's
    // session by accident.
    let armed = false;
    let pickUpTimer: ReturnType<typeof setTimeout> | null = null;
    const pickUp = (buzz: boolean) => {
      armed = true;
      pickUpTimer = null;
      scrollLock.current = true;
      if (buzz) haptic();
      evDragRef.current = { span, di, day, rectTop, grabOffset, durationMin, lastStartMin: origStartMin, moved: false };
      setEvGhost({ di, startMin: origStartMin, durationMin });
    };
    if (touch) pickUpTimer = setTimeout(() => pickUp(true), LONG_PRESS_MS);
    else pickUp(false);

    const move = (ev: PointerEvent) => {
      if (!armed) {
        // Travel before the timer fires means the finger is going somewhere —
        // let the browser have the gesture.
        if (pickUpTimer && Math.hypot(ev.clientX - downX, ev.clientY - downY) > LONG_PRESS_SLOP_PX) {
          clearTimeout(pickUpTimer);
          pickUpTimer = null;
        }
        return;
      }
      const d = evDragRef.current;
      if (!d) return;
      const { startHour: sh, endHour: eh } = cfgRef.current;
      let s = minFromY(ev.clientY - d.rectTop, sh) - d.grabOffset;
      s = Math.max(sh * 60, Math.min(eh * 60 - d.durationMin, s));
      if (Math.abs(s - londonMinutes(new Date(d.span.start))) >= SNAP_MIN) d.moved = true;
      d.lastStartMin = s;
      setEvGhost({ di: d.di, startMin: s, durationMin: d.durationMin });
    };
    const finish = (commit: boolean, ev?: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (pickUpTimer) clearTimeout(pickUpTimer);
      pickUpTimer = null;
      const d = evDragRef.current;
      evDragRef.current = null;
      setEvGhost(null);
      scrollLock.current = false;
      teardown.current = null;
      if (!commit) return;
      const { onEventClick: click, onEventMove: mv } = cfgRef.current;
      // Never picked up, or picked up and put back where it was: that's a tap —
      // unless the gesture was a flick to the next page, which starts on a
      // session as readily as on empty grid and mustn't open it.
      if (d?.moved && mv) mv(d.span, slotAt(d.day, d.lastStartMin));
      else if (click && ev && !justSwiped()) click(span, { x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent) => finish(true, ev);
    const cancel = () => finish(false);
    teardown.current = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  /* ---------- hover + picker tap ---------- */
  const handleColumnHover = (di: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    if ((!slotSelectable && !pickerSelectable) || pressRef.current || evDragRef.current || draft) return;
    if (e.target !== e.currentTarget) {
      setHover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({ di, min: snapMinFromY(e.clientY - rect.top) });
  };

  const handlePickerTap = (day: Date) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickerSelectable || !picker || e.target !== e.currentTarget) return;
    if (justSwiped()) return; // trailing click of a page turn
    const rect = e.currentTarget.getBoundingClientRect();
    const min = snapMinFromY(e.clientY - rect.top);
    const slot = slotAt(day, min);
    if (slot < now || isBusyAt(picker.clinic, slot)) return; // only free future times
    picker.onToggle(slot);
  };

  const draftDay = draft ? days[draft.di] ?? days[0] : null;

  // In fill mode the grid owns a fixed box and scrolls its own hours, so the day
  // headers stay put at the top instead of sliding away with the page — the
  // thing that makes a calendar feel like a calendar rather than a long page.
  const dayHeaders = (
    <div className={`flex ${fill ? "flex-none border-b border-line bg-linen pt-0.5" : ""}`}>
      <div className="w-12 flex-none" />
      {days.map((day) => {
        const isToday = sameLondonDay(day, now);
        return (
          <div key={day.toISOString()} className="min-w-0 flex-1 px-1 pb-1.5 text-center">
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
  );

  const gridBody = (
    <div
      ref={bodyRef}
      className={`flex ${fill ? "bg-card" : "rounded-2xl border border-line bg-card shadow-card"}`}
    >
          {/* hour axis */}
          <div className="relative w-12 flex-none" style={{ height: gridHeight }}>
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 -translate-y-1/2 text-[10.5px] font-medium tabular-nums text-faint"
                style={{ top: i * hourPx }}
              >
                {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
              </div>
            ))}
            {/* While a draft is live its exact ends are called out on the axis,
                which is where the eye already is when reading a time off a grid. */}
            {draft && draftDay && (
              <>
                {([["start", draft.startMin], ["end", draft.endMin]] as const).map(([which, min]) => (
                  <div
                    key={which}
                    className="pointer-events-none absolute right-1 z-40 -translate-y-1/2 rounded-full bg-clay px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop"
                    style={{ top: toY(min) }}
                  >
                    {fmtTime(slotAt(draftDay, min))}
                  </div>
                ))}
              </>
            )}
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
                onPointerDown={slotSelectable ? handleColumnDown(day, di) : undefined}
                onClick={pickerSelectable ? handlePickerTap(day) : undefined}
                onMouseMove={handleColumnHover(di)}
                onMouseLeave={() => setHover((h) => (h?.di === di ? null : h))}
                className={`relative min-w-0 flex-1 border-l border-hairline ${
                  isToday ? "bg-[oklch(0.975_0.015_60)]" : ""
                } ${slotSelectable || pickerSelectable ? "cursor-pointer select-none" : ""}`}
                style={{
                  height: gridHeight,
                  // Hand the browser vertical panning (that's how the page
                  // scrolls) but keep horizontal for ourselves, or it claims a
                  // sideways swipe as a scroll and pointercancels the gesture
                  // before it can be read as a page turn. Only when the grid
                  // itself doesn't scroll sideways — a 7-day grid needs that.
                  touchAction: compact ? "pan-y" : undefined,
                }}
              >
                {/* hour hairlines */}
                {Array.from({ length: endHour - startHour - 1 }, (_, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute right-0 left-0 border-t border-hairline"
                    style={{ top: (i + 1) * hourPx }}
                  />
                ))}

                {/* Why there's nothing bookable here — the answer on the screen,
                    rather than at the end of an investigation. */}
                {dayNotes?.[londonDateKey(day)] && (
                  <div className="pointer-events-none absolute top-1 right-[3px] left-[3px] z-[1] rounded-md bg-[oklch(0.96_0.02_60_/_0.92)] px-1.5 py-1 text-[9.5px] leading-tight font-medium text-[oklch(0.48_0.06_40)]">
                    {dayNotes[londonDateKey(day)]}
                  </div>
                )}

                {/* availability layer — green = Bethnal Green, blue = Waterloo, red =
                    closed. Weekly baseline is faint and untouchable; drawn overrides
                    are clickable. When both clinics are drawn on the same day they get
                    their own side-by-side column instead of overlapping, so both stay
                    readable at once; within a clinic's column, its own weekly/bookable
                    layers still deliberately overlay each other. */}
                {(() => {
                  const clinicsPresent = Array.from(new Set(dayAvail[di].map((w) => w.clinic)));
                  const multi = clinicsPresent.length > 1;
                  return dayAvail[di].map((w, wi) => {
                    const c = AVAIL_COLORS[w.clinic][w.kind];
                    const editable = w.kind !== "weekly" && !!w.id;
                    const top = toY(w.startMin);
                    const height = Math.max(((w.endMin - w.startMin) / 60) * hourPx, 12);
                    const kindLabel =
                      (w.kind === "block"
                        ? "Unavailable"
                        : w.kind === "weekly"
                          ? "Usual hours"
                          : w.kind === "bookable"
                            ? "Bookable"
                            : w.exactStart
                              ? "Slot"
                              : "Available") + (w.repeatWeekly ? " ↻" : "");
                    const label = multi ? `${CLINIC_LABEL[w.clinic]} · ${kindLabel}` : kindLabel;
                    const laneIndex = multi ? clinicsPresent.indexOf(w.clinic) : 0;
                    const laneCount = multi ? clinicsPresent.length : 1;
                    return (
                      <div
                        key={`${w.clinic}-${w.kind}-${w.id ?? wi}`}
                        onClick={
                          editable
                            ? (e) => {
                                e.stopPropagation();
                                onAvailabilityClick?.(w);
                              }
                            : undefined
                        }
                        className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${
                          editable ? "cursor-pointer hover:brightness-[0.97]" : "pointer-events-none"
                        } ${multi ? "" : "right-[3px] left-[3px]"}`}
                        style={{
                          top,
                          height,
                          ...(multi
                            ? { left: `calc(${(laneIndex / laneCount) * 100}% + 3px)`, width: `calc(${100 / laneCount}% - 6px)` }
                            : {}),
                          background: c.bg,
                          border: `1px ${w.kind === "block" ? "solid" : "dashed"} ${c.border}`,
                          color: c.text,
                          zIndex: 1,
                        }}
                      >
                        <span className="tabular-nums">
                          {compact ? kindLabel : `${label} · ${fmtTime(slotAt(day, w.startMin))}–${fmtTime(slotAt(day, w.endMin))}`}
                        </span>
                      </div>
                    );
                  });
                })()}

                {/* drag-to-create selection — the range you're sweeping out (mouse) */}
                {dragSel?.di === di && dragSel.b > dragSel.a && (
                  <div
                    className="pointer-events-none absolute right-[3px] left-[3px] z-30 flex items-start justify-start rounded-md border px-1 pt-0.5"
                    style={{
                      top: toY(dragSel.a),
                      height: ((dragSel.b - dragSel.a) / 60) * hourPx,
                      borderColor: availabilityMode ? ghostColor.border : "oklch(0.58 0.115 42 / 0.7)",
                      background: availabilityMode ? ghostColor.bg : "oklch(0.9 0.05 48 / 0.7)",
                    }}
                  >
                    <span
                      className="rounded-full px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop"
                      style={{ background: availabilityMode ? ghostColor.border : "oklch(0.58 0.115 42)" }}
                    >
                      {availabilityMode ? "Available " : ""}
                      {fmtTime(slotAt(day, dragSel.a))}–{fmtTime(slotAt(day, dragSel.b))}
                    </span>
                  </div>
                )}

                {/* the touch draft — a real block you can grab by either end or the middle */}
                {draft?.di === di && (
                  <div
                    onPointerDown={beginDraftMove}
                    className="ct-draft absolute right-[3px] left-[3px] z-40 rounded-lg border-2 shadow-pop"
                    style={{
                      top: toY(draft.startMin),
                      height: Math.max(((draft.endMin - draft.startMin) / 60) * hourPx, 22),
                      borderColor: availabilityMode ? ghostColor.border : "oklch(0.58 0.115 42)",
                      background: availabilityMode ? ghostColor.bg : "oklch(0.9 0.05 48 / 0.85)",
                      touchAction: "none",
                      cursor: "grab",
                    }}
                  >
                    {/* pl-6 keeps the time clear of the top-left grab handle */}
                    <div
                      className="truncate pt-1 pr-2 pl-6 text-[11px] font-semibold tabular-nums"
                      style={{ color: availabilityMode ? ghostColor.text : "oklch(0.42 0.1 42)" }}
                    >
                      {fmtTime(slotAt(day, draft.startMin))}–{fmtTime(slotAt(day, draft.endMin))}
                    </div>
                    {/* Grab handles. The dot is small so it doesn't cover the block;
                        the touch target around it is finger-sized. */}
                    {(["top", "bottom"] as const).map((edge) => (
                      <div
                        key={edge}
                        onPointerDown={beginDraftResize(edge)}
                        className="absolute flex h-9 w-9 items-center justify-center"
                        style={{
                          [edge === "top" ? "top" : "bottom"]: -18,
                          [edge === "top" ? "left" : "right"]: -6,
                          touchAction: "none",
                          cursor: "ns-resize",
                        }}
                        aria-label={edge === "top" ? "Change start time" : "Change end time"}
                      >
                        <span
                          className="block h-3.5 w-3.5 rounded-full border-2 bg-card"
                          style={{ borderColor: availabilityMode ? ghostColor.border : "oklch(0.58 0.115 42)" }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* moving-event ghost */}
                {evGhost?.di === di && (
                  <div
                    className="pointer-events-none absolute right-[3px] left-[3px] z-30 flex items-start justify-start rounded-md border border-clay bg-clay-tint/80 px-1 pt-0.5"
                    style={{ top: toY(evGhost.startMin), height: (evGhost.durationMin / 60) * hourPx }}
                  >
                    <span className="rounded-full bg-clay px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop">
                      {fmtTime(slotAt(day, evGhost.startMin))}
                    </span>
                  </div>
                )}

                {/* display: cursor ghost (15-min snap) — "book here" clay, or green
                    "drag to mark available" while editing availability */}
                {slotSelectable && !dragSel && !evGhost && !draft && hover?.di === di && hover.min + 60 <= endHour * 60 && (
                  <div className="pointer-events-none absolute right-[3px] left-[3px] z-20" style={{ top: toY(hover.min) }}>
                    <div
                      className="rounded-md border border-dashed"
                      style={{
                        height: hourPx,
                        borderColor: availabilityMode ? ghostColor.border : "oklch(0.58 0.115 42 / 0.6)",
                        background: availabilityMode ? ghostColor.bg : "oklch(0.9 0.05 48 / 0.5)",
                      }}
                    />
                    <div className="absolute -top-[1px] left-0">
                      <span
                        className="rounded-full px-1.5 py-[1px] text-[10px] font-semibold tabular-nums text-cream shadow-pop"
                        style={{ background: availabilityMode ? ghostColor.border : "oklch(0.58 0.115 42)" }}
                      >
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
                      height: hourPx,
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
                        style={{ top: toY(londonMinutes(s)), height: hourPx }}
                      >
                        {fmtTime(s)}
                        {compact ? "" : " · chosen"}
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
                      onPointerDown={movable ? handleEventDown(event.span, di, day) : undefined}
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
                        height: Math.max(((event.endMin - event.startMin) / 60) * hourPx - 2, 14),
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        background: c.bg,
                        borderLeft: `3px solid ${c.border}`,
                        color: c.text,
                        opacity: pickerDim ? 0.75 : 1,
                        zIndex: 5,
                        // Same bargain as the columns: the browser keeps vertical
                        // panning so the page still scrolls when a finger happens
                        // to land on a session, and we take the gesture back — via
                        // the touchmove veto — only once one is actually picked up.
                        touchAction: compact ? "pan-y" : undefined,
                      }}
                    >
                      <div className="font-semibold tabular-nums">
                        {compact
                          ? fmtTime(new Date(event.span.start))
                          : `${fmtTime(new Date(event.span.start))}–${fmtTime(new Date(event.span.end))}`}
                      </div>
                      <div className="truncate">{event.span.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
    </div>
  );

  return (
    <div
      ref={scrollerRef}
      onPointerDownCapture={handleSwipeCapture}
      className={
        fill ? "flex h-full min-h-0 flex-col" : compact ? "pb-2" : "overflow-x-auto pb-2"
      }
    >
      <div className={fill ? "flex h-full min-h-0 flex-col" : compact ? "" : "min-w-[760px]"}>
        {dayHeaders}
        {fill ? (
          <div
            ref={vScrollRef}
            onScroll={(e) => onScrollTop?.(e.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {gridBody}
          </div>
        ) : (
          gridBody
        )}
      </div>

      {/* The draft's confirm bar — the web equivalent of the "(No title)" sheet
          that peeks up in Google Calendar once you let go. */}
      {draft && draftDay && (
        <div className="ct-draftbar fixed inset-x-3 bottom-3 z-50 flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 shadow-pop lg:left-auto lg:w-[420px]">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">
              {availabilityMode ? "New availability" : "New event"}
            </div>
            <div className="mt-0.5 truncate text-[12px] tabular-nums text-muted">
              {fmtDayShort(draftDay)} · {fmtTime(slotAt(draftDay, draft.startMin))}–
              {fmtTime(slotAt(draftDay, draft.endMin))}
            </div>
          </div>
          <button
            onClick={() => setDraftBoth(null)}
            className="flex-none cursor-pointer rounded-full border border-line px-3.5 py-2 text-[12.5px] font-semibold text-ink-soft hover:bg-hoverbg"
          >
            Discard
          </button>
          <button
            onClick={commitDraft}
            className="flex-none cursor-pointer rounded-full bg-clay px-4 py-2 text-[12.5px] font-semibold text-cream hover:bg-clay-deep"
          >
            Add details
          </button>
        </div>
      )}
    </div>
  );
}

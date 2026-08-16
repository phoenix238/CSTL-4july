"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  londonAddDays,
  londonDateKey,
  londonDayStart,
  londonMinutes,
  londonWeekStart,
  londonWeekdayIndex,
  londonYMD,
  fmtDate,
  fmtDayLong,
  fmtTime,
} from "@/lib/time";
import type { WeeklyHours } from "@/lib/booking/availability";
import { api, OutlineButton, PrimaryButton, Sheet, useIsPhone, useToast } from "../ui";
import { AvailabilityComposer } from "./AvailabilityComposer";
import { BookingPopover } from "./BookingPopover";
import { BookingsList } from "./BookingsList";
import { EventComposer, type EventCalendar } from "./EventComposer";
import { MonthGrid } from "./MonthGrid";
import { QuickBook } from "./QuickBook";
import { TimeGrid, HOUR_PX, HOUR_PX_MAX, HOUR_PX_MIN } from "./TimeGrid";
import { useWeekSpans } from "./useWeekSpans";
import { AVAIL_COLORS, CLINIC_LABEL, SPAN_COLORS, type AvailClinic, type AvailWindowDTO, type SpanDTO, type SpanSource } from "./layout";
import { mergeIntervals, overrideAppliesOn } from "@/lib/booking/availability";
import { SESSION_MINUTES } from "@/lib/booking/rules";

/** One day's verdict from /api/bookable. */
interface BookableDay {
  date: string;
  bookable: number;
  openMinutes: number;
  reason: string;
}

interface OverrideDTO {
  id: string;
  clinic: string;
  date: string;
  kind: string;
  startMin: number;
  endMin: number;
  repeatWeekly?: boolean;
  exactStart?: boolean;
}

interface AvailComposerState {
  mode: "create" | "edit";
  clinic: AvailClinic;
  day: Date;
  startMin: number;
  endMin: number;
  kind?: "open" | "block";
  repeatWeekly?: boolean;
  exactStart?: boolean;
  id?: string;
}

const AVAIL_CLINICS: AvailClinic[] = ["bethnal", "waterloo"];

interface ComposerState {
  mode: "create" | "edit";
  start: Date;
  end: Date;
  title?: string;
  eventId?: string;
  source?: SpanSource;
}

const TZ = "Europe/London";

const CALENDAR_SOURCES: SpanSource[] = ["booking", "room", "chalkFarm", "personal"];
const HIDDEN_KEY = "cstl-calendar-hidden";
const SHOW_AVAIL_KEY = "cstl-calendar-show-availability";
const VIEW_KEY = "cstl-calendar-view";

type CalView = "3day" | "5day" | "7day" | "month";

const VIEW_LABEL: Record<CalView, string> = {
  "3day": "3 days",
  "5day": "Mon–Fri",
  "7day": "7 days",
  month: "Month",
};

/** Columns each time view draws. Month has none — it's a different grid. */
const VIEW_DAYS: Record<Exclude<CalView, "month">, number> = { "3day": 3, "5day": 5, "7day": 7 };

const ZOOM_KEY = "cstl-calendar-hourpx";
/** One tap of the zoom control. */
const ZOOM_STEP = 14;
const clampZoom = (px: number) => Math.max(HOUR_PX_MIN, Math.min(HOUR_PX_MAX, Math.round(px)));

export function CalendarView() {
  const toast = useToast();
  const phone = useIsPhone();
  const [view, setView] = useState<CalView>("7day");
  const [hourPx, setHourPx] = useState(HOUR_PX);
  const [anchor, setAnchor] = useState(() => new Date());
  // Which way the range last moved, so the incoming page slides in from the
  // side it came from; the key restarts the animation on every move.
  const [page, setPage] = useState<{ dir: -1 | 0 | 1; n: number }>({ dir: 0, n: 0 });
  const [openSpan, setOpenSpan] = useState<{ span: SpanDTO; anchor: { x: number; y: number } } | null>(null);
  const [quickBookSlot, setQuickBookSlot] = useState<Date | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [calendars, setCalendars] = useState<Record<EventCalendar, boolean>>({
    personal: true,
    room: false,
    chalkFarm: false,
  });
  const [reschedule, setReschedule] = useState<{ bookingId: string; clientName: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // A dragged session waiting to be confirmed — nothing has been sent yet.
  const [pendingMove, setPendingMove] = useState<{ span: SpanDTO; newStart: Date } | null>(null);
  const [moving, setMoving] = useState(false);
  // How far down the hours you'd scrolled. Paging remounts the grid, so this
  // survives out here and is handed straight back.
  const gridScrollTop = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<SpanSource>>(new Set());

  // Availability-editing mode: draw the times you're bookable for online booking.
  const [availMode, setAvailMode] = useState(false);
  // Read-only counterpart: show both clinics' availability layered on the
  // ordinary calendar view, without entering edit mode.
  const [showAvailability, setShowAvailability] = useState(false);
  // Which clinic a newly-drawn window (or click) applies to — both clinics'
  // availability is always shown together; this only picks the drawing target.
  const [availClinic, setAvailClinic] = useState<AvailClinic>("bethnal");
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours | null>(null);
  const [overrides, setOverrides] = useState<OverrideDTO[]>([]);
  const [availComposer, setAvailComposer] = useState<AvailComposerState | null>(null);
  // What a client can genuinely book, straight from the booking engine — plus
  // why any day has none. Fetched per clinic, only while availability is
  // showing, for the week shown.
  const [bookable, setBookable] = useState<Record<AvailClinic, { slots: string[]; days: BookableDay[] }> | null>(null);

  // Which calendars are wired up + the recurring weekly hours (baseline shown
  // faintly behind drawn availability).
  useEffect(() => {
    api<{ calendars: Record<EventCalendar, boolean>; weeklyHours: WeeklyHours }>("/api/settings")
      .then((s) => {
        if (s.calendars) setCalendars(s.calendars);
        if (s.weeklyHours) setWeeklyHours(s.weeklyHours);
      })
      .catch(() => {});
  }, []);

  const loadOverrides = useCallback(() => {
    api<{ overrides: OverrideDTO[] }>("/api/availability-overrides")
      .then(({ overrides }) => setOverrides(overrides))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadOverrides();
  }, [loadOverrides]);

  // Remember which calendars are toggled off between visits.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
      if (Array.isArray(saved)) setHidden(new Set(saved as SpanSource[]));
    } catch {
      /* ignore */
    }
  }, []);

  // Remember whether "show availability" was left on between visits.
  useEffect(() => {
    try {
      setShowAvailability(localStorage.getItem(SHOW_AVAIL_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Which view to open on. A remembered choice always wins; failing that a
  // phone gets 3 days, because seven columns on a 390px screen are too narrow
  // to read a name in, let alone tap.
  useEffect(() => {
    let saved: string | null = null;
    let savedZoom: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
      savedZoom = localStorage.getItem(ZOOM_KEY);
    } catch {
      /* ignore */
    }
    const zoom = Number(savedZoom);
    if (Number.isFinite(zoom) && zoom > 0) setHourPx(clampZoom(zoom));
    // "week" is what the 7-day view was called before Mon–Fri existed.
    if (saved === "week") saved = "7day";
    if (saved === "3day" || saved === "5day" || saved === "7day" || saved === "month") {
      setView(saved);
      return;
    }
    if (window.matchMedia("(max-width: 640px)").matches) setView("3day");
  }, []);

  function chooseView(v: CalView) {
    setView(v);
    setPage({ dir: 0, n: 0 });
    // Picking a view is the thing you opened the menu to do — get out of the way.
    setMenuOpen(false);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  function zoomBy(step: number) {
    setHourPx((h) => {
      const next = clampZoom(h + step);
      try {
        localStorage.setItem(ZOOM_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  function toggleShowAvailability() {
    setShowAvailability((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHOW_AVAIL_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  function toggleSource(s: SpanSource) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  const visible = (spans: SpanDTO[] | null) => spans?.filter((s) => !hidden.has(s.source)) ?? null;

  // How many day columns the time grid draws, and where it starts. A week view
  // snaps to Monday; a 3-day view starts on the day you're looking at, so
  // paging walks the calendar three days at a time from wherever you are.
  const gridDays = view === "month" ? 7 : VIEW_DAYS[view];
  // 3 days rolls from whatever day you're on; Mon–Fri and the full week both
  // snap to Monday, so the working week keeps its shape as you page.
  const rangeStart = useMemo(
    () => (view === "3day" ? londonDayStart(0, anchor) : londonWeekStart(anchor)),
    [anchor, view],
  );
  const monthGridStart = useMemo(() => {
    const { y, m } = londonYMD(anchor);
    return londonWeekStart(new Date(Date.UTC(y, m - 1, 1, 12)));
  }, [anchor]);

  const week = useWeekSpans(rangeStart, gridDays);
  const month = useWeekSpans(monthGridStart, 42);

  // Availability is drawn whenever it's being edited, or the read-only
  // "show availability" toggle is on — both clinics at once, each in its own
  // colour, so Bethnal Green and Waterloo can be compared at a glance.
  const availShowing = availMode || showAvailability;

  // The availability windows for the visible week & both clinics: the
  // recurring weekly baseline plus any one-off overrides drawn on the grid.
  const availWindows = useMemo<AvailWindowDTO[]>(() => {
    if (!availShowing) return [];
    const out: AvailWindowDTO[] = [];
    for (let i = 0; i < gridDays; i++) {
      const day = londonAddDays(rangeStart, i);
      const dateKey = londonDateKey(day);
      const weekday = londonWeekdayIndex(day);
      for (const clinic of AVAIL_CLINICS) {
        for (const w of weeklyHours?.[clinic] ?? []) {
          if (w.weekday === weekday) {
            out.push({ clinic, date: dateKey, kind: "weekly", startMin: w.startMin, endMin: w.endMin });
          }
        }
        for (const o of overrides) {
          if (o.clinic !== clinic || (o.kind !== "open" && o.kind !== "block")) continue;
          // A one-off shows on its own date; a repeating one shows on its weekday
          // every week from the date it was drawn onward — the same rule the
          // booking engine uses, so what's drawn matches what's bookable.
          if (overrideAppliesOn(o, dateKey, weekday)) {
            out.push({
              id: o.id,
              clinic,
              date: dateKey,
              kind: o.kind,
              startMin: o.startMin,
              endMin: o.endMin,
              repeatWeekly: o.repeatWeekly,
              exactStart: o.exactStart,
            });
          }
        }
      }
    }
    return out;
  }, [availShowing, weeklyHours, overrides, rangeStart, gridDays]);

  // The real answer for the visible week, for both clinics — refetched
  // whenever the week or anything that could change availability moves.
  useEffect(() => {
    if (!availShowing) {
      setBookable(null);
      return;
    }
    let stale = false;
    Promise.all(
      AVAIL_CLINICS.map((clinic) =>
        api<{ slots: string[]; days: BookableDay[] }>(
          `/api/bookable?clinic=${clinic}&start=${encodeURIComponent(rangeStart.toISOString())}&days=${gridDays}`,
        ).then((r) => [clinic, r] as const),
      ),
    )
      .then((pairs) => {
        if (!stale) setBookable(Object.fromEntries(pairs) as Record<AvailClinic, { slots: string[]; days: BookableDay[] }>);
      })
      .catch(() => {
        if (!stale) setBookable(null);
      });
    return () => {
      stale = true;
    };
  }, [availShowing, rangeStart, gridDays, overrides, week.spans]);

  // Bookable starts merged into the ranges they cover, so a run of half-hourly
  // slots reads as one solid band rather than a stack of overlapping hours.
  const bookableWindows = useMemo<AvailWindowDTO[]>(() => {
    if (!bookable) return [];
    const out: AvailWindowDTO[] = [];
    for (const clinic of AVAIL_CLINICS) {
      const slots = bookable[clinic]?.slots;
      if (!slots?.length) continue;
      const byDay = new Map<string, Array<{ start: number; end: number }>>();
      for (const iso of slots) {
        const at = new Date(iso);
        const key = londonDateKey(at);
        const startMin = londonMinutes(at);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push({ start: startMin, end: startMin + SESSION_MINUTES });
      }
      for (const [date, ranges] of byDay) {
        for (const iv of mergeIntervals(ranges)) {
          out.push({ clinic, date, kind: "bookable", startMin: iv.start, endMin: iv.end });
        }
      }
    }
    return out;
  }, [bookable]);

  // Kept to the clinic currently being edited — with both clinics' bands on
  // screen at once there's no single spot left to show two reasons for the
  // same day, and this note only matters while actively drawing availability.
  const dayNotes = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const d of bookable?.[availClinic]?.days ?? []) if (d.reason) out[d.date] = d.reason;
    return out;
  }, [bookable, availClinic]);

  function enterAvailability() {
    if (view === "month") chooseView("7day");
    setReschedule(null);
    setAvailMode(true);
  }

  function availabilitySaved() {
    setAvailComposer(null);
    loadOverrides();
    week.invalidate();
    month.invalidate();
  }

  const rangeLabel =
    view === "month"
      ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "long", year: "numeric" }).format(anchor)
      : `${fmtDate(rangeStart)} – ${fmtDate(londonAddDays(rangeStart, gridDays - 1))}`;

  // The phone strip has buttons to fit alongside it, and "19 Aug 2026 – 21 Aug
  // 2026" is mostly redundant with the dated day headers right underneath.
  const shortRangeLabel = (() => {
    if (view === "month") return rangeLabel;
    const from = rangeStart;
    const to = londonAddDays(rangeStart, gridDays - 1);
    const d = (x: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric" }).format(x);
    const dm = (x: Date) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(x);
    return londonYMD(from).m === londonYMD(to).m ? `${d(from)}–${dm(to)}` : `${dm(from)} – ${dm(to)}`;
  })();

  function nav(dir: -1 | 0 | 1) {
    if (dir === 0) {
      setAnchor(new Date());
      setPage({ dir: 0, n: 0 });
      return;
    }
    setPage((p) => ({ dir, n: p.n + 1 }));
    if (view === "month") {
      const { y, m } = londonYMD(anchor);
      setAnchor(new Date(Date.UTC(y, m - 1 + dir, 1, 12)));
    } else {
      // Mon–Fri steps a whole week: stepping five days would land on Saturday
      // and drag the working week off its Monday from then on.
      const step = view === "5day" ? 7 : gridDays;
      setAnchor((a) => londonDayStart(dir * step, a));
    }
  }

  async function cancelBooking(span: SpanDTO) {
    if (!span.bookingId) return;
    if (!window.confirm(`Cancel this booking? The Google Calendar events are deleted and ${span.title.split(" — ")[0]} is notified by Google.`)) return;
    setCancelling(true);
    try {
      await api(`/api/bookings/${span.bookingId}`, { method: "DELETE" });
      toast("Booking cancelled — slot is free again");
      setOpenSpan(null);
      week.invalidate();
      month.invalidate();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't cancel that booking");
    } finally {
      setCancelling(false);
    }
  }

  /**
   * Moving a session isn't a local edit: rescheduleBooking deletes the Google
   * events and makes new ones, so the client is sent a cancellation and a fresh
   * invite. That's a message to someone else's inbox, off the back of a drag —
   * so the drag only ever proposes the move, and this asks first.
   */
  async function commitMove(span: SpanDTO, newStart: Date) {
    if (!span.bookingId) return;
    setMoving(true);
    try {
      await api(`/api/bookings/${span.bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ startISO: newStart.toISOString() }),
      });
      toast("Moved ✓");
      setPendingMove(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't move that");
    } finally {
      setMoving(false);
      week.invalidate();
      month.invalidate();
    }
  }

  async function handleSlotClick(slot: Date) {
    if (reschedule) {
      try {
        const res = await api<{ whenLabel: string; clientName: string }>(`/api/bookings/${reschedule.bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({ startISO: slot.toISOString() }),
        });
        toast(`Moved — ${res.clientName}, ${res.whenLabel}`);
        setReschedule(null);
        week.invalidate();
        month.invalidate();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Couldn't move that booking");
      }
      return;
    }
    if (slot < new Date()) {
      toast("That slot is in the past");
      return;
    }
    setQuickBookSlot(slot);
  }

  /* The controls, built once and placed twice: spread across the header on a
     laptop, stacked inside the menu on a phone, where the screen belongs to the
     calendar and everything else is a tap away. */

  const availabilityToggle = !availMode ? (
    <button
      onClick={toggleShowAvailability}
      aria-pressed={showAvailability}
      className={`cursor-pointer rounded-full border px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
        showAvailability
          ? "border-sage/60 bg-sage-tint text-sage-text"
          : "border-line bg-card text-ink-soft hover:bg-hoverbg"
      }`}
    >
      {showAvailability ? "Hide availability" : "Show availability"}
    </button>
  ) : null;

  const availabilityButton = (
    <button
      onClick={() => (availMode ? setAvailMode(false) : enterAvailability())}
      className={`cursor-pointer rounded-full border px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
        availMode ? "text-cream" : "border-line bg-card text-ink-soft hover:bg-hoverbg"
      }`}
      style={
        availMode
          ? { background: AVAIL_COLORS[availClinic].open.border, borderColor: AVAIL_COLORS[availClinic].open.border }
          : undefined
      }
    >
      {availMode ? "Done editing availability" : "Set availability"}
    </button>
  );

  const viewSwitcher = !availMode ? (
    <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
      {(["3day", "5day", "7day", "month"] as const).map((v) => (
        <button
          key={v}
          onClick={() => chooseView(v)}
          className={`flex-1 cursor-pointer rounded-full px-2.5 py-[6px] text-[12.5px] font-semibold whitespace-nowrap select-none sm:px-3.5 ${
            view === v ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
          }`}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  ) : null;

  // Zoom is the hour height: out until a whole day fits, in until there's room
  // to work in a single afternoon. Hidden in month view, which has no hours.
  const zoomButtons =
    view === "month" ? null : (
      <div className="flex items-center gap-1">
        <button
          onClick={() => zoomBy(-ZOOM_STEP)}
          disabled={hourPx <= HOUR_PX_MIN}
          aria-label="Show more hours"
          className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[14px] leading-none font-semibold hover:bg-hoverbg disabled:cursor-default disabled:opacity-40"
        >
          −
        </button>
        <button
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={hourPx >= HOUR_PX_MAX}
          aria-label="Show fewer hours, larger"
          className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[14px] leading-none font-semibold hover:bg-hoverbg disabled:cursor-default disabled:opacity-40"
        >
          +
        </button>
      </div>
    );

  const navButtons = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => nav(-1)}
        className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[13px] font-semibold hover:bg-hoverbg"
        aria-label="Previous"
      >
        ‹
      </button>
      <button
        onClick={() => nav(0)}
        className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold hover:bg-hoverbg"
      >
        Today
      </button>
      <button
        onClick={() => nav(1)}
        className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[13px] font-semibold hover:bg-hoverbg"
        aria-label="Next"
      >
        ›
      </button>
    </div>
  );

  return (
    <div className="flex max-w-[1200px] flex-col gap-3 p-0 sm:gap-4 sm:p-5 sm:pb-10 lg:px-[30px] lg:pt-[26px] max-sm:h-[calc(100svh-52px)]">
      {/* phone: one slim strip — where you are, and the way in to everything else */}
      <div className="flex flex-none items-center justify-between gap-2 border-b border-line px-3 py-2 sm:hidden">
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink-soft">{shortRangeLabel}</span>
        <div className="flex flex-none items-center gap-1.5">
          {zoomButtons}
          <button
            onClick={() => nav(0)}
            className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold"
          >
            Today
          </button>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Calendar options"
            className="cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink-soft"
          >
            •••
          </button>
        </div>
      </div>

      <header className="hidden flex-wrap items-end justify-between gap-3 sm:flex">
        <div>
          <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Calendar</h1>
          <div className="mt-[5px] text-[13.5px] text-muted">
            {availMode
              ? "Drag across the grid to mark when you're available for online booking. Tap a window to edit or remove it."
              : showAvailability
                ? "Availability is shown for reference — Bethnal Green in green, Waterloo in blue. Tap a booking to manage it, tap a free space to book a client, or press and hold the grid to add an event. Only client sessions can be dragged, and a move is confirmed before anyone is told."
                : "Tap a booking to manage it, tap a free space to book a client, or press and hold the grid to add an event. Only client sessions can be dragged, and a move is confirmed before anyone is told."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {availabilityToggle}
          {availabilityButton}
          {viewSwitcher}
          {zoomButtons}
          {navButtons}
          <div className="text-[13px] font-semibold text-ink-soft">{rangeLabel}</div>
        </div>
      </header>

      {menuOpen && (
        <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} label="Calendar options">
          <div className="flex flex-col gap-4 p-5">
            <div>
              <h2 className="font-serif text-[19px] leading-tight">Calendar</h2>
              <div className="mt-0.5 text-[13px] text-muted">{rangeLabel}</div>
            </div>
            {viewSwitcher && <div className="flex flex-col gap-1.5">{viewSwitcher}</div>}
            <div className="flex flex-wrap items-center gap-2">
              {navButtons}
              {availabilityToggle}
              <span onClick={() => setMenuOpen(false)}>{availabilityButton}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-muted">CALENDARS</div>
              <div className="flex flex-wrap items-center gap-2">
                {CALENDAR_SOURCES.map((s) => {
                  const c = SPAN_COLORS[s];
                  const off = hidden.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSource(s)}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold select-none ${
                        off ? "border-line bg-transparent text-faint" : "border-transparent text-ink-soft"
                      }`}
                      style={off ? undefined : { background: c.bg, color: c.text }}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: off ? "oklch(0.8 0.01 80)" : c.border }}
                      />
                      {c.label}
                      {off && <span className="text-[10px]">hidden</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-[12px] leading-[1.6] text-muted">
              Tap a booking to manage it, tap a free space to book a client, or press and hold the grid to add an
              event. Only client sessions can be dragged, and a move is confirmed before anyone is told.
            </p>
            <OutlineButton onClick={() => setMenuOpen(false)} className="self-start px-4 py-2 text-[13px]">
              Done
            </OutlineButton>
          </div>
        </Sheet>
      )}

      {reschedule && (
        <div className="flex flex-none items-center justify-between gap-3 border-[1.5px] border-clay/40 bg-clay-tint px-4 py-2.5 text-[13px] font-medium text-clay-text max-sm:mx-0 sm:rounded-xl">
          <span>Pick a new slot for {reschedule.clientName} — tap any free space.</span>
          <button
            onClick={() => setReschedule(null)}
            className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-semibold hover:bg-[oklch(0.9_0.04_48)]"
          >
            Cancel
          </button>
        </div>
      )}

      {(availMode || showAvailability) && (
        <div className="flex flex-none flex-wrap items-center gap-3 border-[1.5px] border-sage/50 bg-sage-tint px-4 py-2.5 text-[13px] sm:rounded-xl">
          {availMode && (
            <>
              <span className="font-semibold text-sage-text">Drawing for</span>
              <div className="flex rounded-full border border-line bg-card p-[3px]">
                {(["bethnal", "waterloo"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setAvailClinic(c)}
                    className={`cursor-pointer rounded-full px-3 py-[5px] text-[12px] font-semibold select-none ${
                      availClinic === c ? "text-cream" : "text-[oklch(0.45_0.02_60)]"
                    }`}
                    style={availClinic === c ? { background: AVAIL_COLORS[c].open.border } : undefined}
                  >
                    {CLINIC_LABEL[c]}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted">
            {(["bethnal", "waterloo"] as const).map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-[3px] border"
                  style={{ background: AVAIL_COLORS[c].bookable.bg, borderColor: AVAIL_COLORS[c].bookable.border }}
                />
                <b className="font-semibold" style={{ color: AVAIL_COLORS[c].bookable.text }}>
                  {CLINIC_LABEL[c]}
                </b>
              </span>
            ))}
            {/* The key is what the colours mean; the paragraph explaining the
                edge cases is a screenful on a phone, so it waits for a laptop. */}
            <span className="hidden sm:inline">
              Solid = actually bookable now, faint = your{" "}
              <a href="/settings" className="font-semibold text-sage-text underline">
                usual hours
              </a>
              , red = unavailable. Where solid and faint differ, something has closed the time — a calendar event,
              a gap setting, the notice window or the weekly cap.
              {availMode && " Empty days say which. Draw here to open or close specific days."}
            </span>
          </div>
        </div>
      )}

      {/* calendar toggles — tap to show/hide each shared calendar. On a phone
          they live in the menu instead, where they don't cost grid height. */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {CALENDAR_SOURCES.map((s) => {
          const c = SPAN_COLORS[s];
          const off = hidden.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold select-none ${
                off ? "border-line bg-transparent text-faint" : "border-transparent text-ink-soft"
              }`}
              style={off ? undefined : { background: c.bg, color: c.text }}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: off ? "oklch(0.8 0.01 80)" : c.border }}
              />
              {c.label}
              {off && <span className="text-[10px]">hidden</span>}
            </button>
          );
        })}
      </div>

      {view !== "month" ? (
        !week.spans ? (
          <div className="flex min-h-0 flex-1 items-center justify-center border-line bg-card text-[13.5px] text-muted sm:h-[300px] sm:flex-none sm:rounded-2xl sm:border">
            Loading your calendars…
          </div>
        ) : (
          <div
            key={page.n}
            /* On a phone the grid is the page: edge to edge, taking every row
               the strip above it doesn't need, scrolling its own hours under
               pinned day headers. Above sm it goes back to sitting in the page
               at its natural height. */
            className={`min-h-0 flex-1 sm:h-auto sm:flex-none ${
              page.dir === 1 ? "ct-page-next" : page.dir === -1 ? "ct-page-prev" : ""
            }`}
          >
          <TimeGrid
            start={rangeStart}
            days={gridDays}
            fill={phone}
            hourPx={hourPx}
            initialScrollTop={gridScrollTop.current}
            onScrollTop={(t) => {
              gridScrollTop.current = t;
            }}
            onPage={(dir) => nav(dir)}
            spans={visible(week.spans) ?? []}
            mode="display"
            availabilityMode={availMode}
            activeClinic={availClinic}
            availWindows={availShowing ? [...availWindows, ...bookableWindows] : undefined}
            dayNotes={availMode ? dayNotes : undefined}
            onAvailabilityClick={(w) => {
              // Only a real one-off override is editable here. The weekly
              // baseline lives in Settings, and the bookable layer is a computed
              // read-out — there's nothing to open for either.
              if (!w.id || (w.kind !== "open" && w.kind !== "block")) return;
              setAvailComposer({
                mode: "edit",
                clinic: w.clinic,
                day: new Date(`${w.date}T12:00:00Z`),
                startMin: w.startMin,
                endMin: w.endMin,
                kind: w.kind,
                repeatWeekly: w.repeatWeekly,
                exactStart: w.exactStart,
                id: w.id,
              });
            }}
            onEventClick={(span, a) => {
              // Editable Google events (on your personal calendar) open the
              // composer; bookings + synced blocks open the read/manage popover.
              if (span.source === "personal" && span.googleEventId) {
                setComposer({
                  mode: "edit",
                  start: new Date(span.start),
                  end: new Date(span.end),
                  title: span.title,
                  eventId: span.googleEventId,
                  source: "personal",
                });
              } else {
                setOpenSpan({ span, anchor: a });
              }
            }}
            onSlotClick={
              availMode
                ? (slot) => {
                    const startMin = londonMinutes(slot);
                    setAvailComposer({
                      mode: "create",
                      clinic: availClinic,
                      day: slot,
                      startMin,
                      endMin: Math.min(startMin + 60, 24 * 60),
                    });
                  }
                : handleSlotClick
            }
            onRangeSelect={
              availMode
                ? (start, end) =>
                    setAvailComposer({
                      mode: "create",
                      clinic: availClinic,
                      day: start,
                      startMin: londonMinutes(start),
                      endMin: londonMinutes(end) || 24 * 60,
                    })
                : reschedule
                  ? undefined
                  : (start, end) => setComposer({ mode: "create", start, end })
            }
            onEventMove={
              availMode || reschedule ? undefined : (span, newStart) => setPendingMove({ span, newStart })
            }
          />
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:overflow-visible sm:px-0">
          <MonthGrid
            month={anchor}
            spans={visible(month.spans)}
            onDayClick={(day) => {
              setAnchor(day);
              chooseView("3day");
            }}
          />
        </div>
      )}

      {/* The list under the grid would halve the calendar on a phone, and Home
          already answers what it answers — today, and the rest of the week. */}
      <div className="hidden sm:block">
        <BookingsList
          spans={view !== "month" ? week.spans : month.spans}
          onChanged={() => {
            week.invalidate();
            month.invalidate();
          }}
        />
      </div>

      {openSpan && (
        <BookingPopover
          span={openSpan.span}
          anchor={openSpan.anchor}
          onClose={() => setOpenSpan(null)}
          cancelling={cancelling}
          onCancel={() => cancelBooking(openSpan.span)}
          onReschedule={() => {
            if (openSpan.span.bookingId) {
              setReschedule({
                bookingId: openSpan.span.bookingId,
                clientName: openSpan.span.title.split(" — ")[0],
              });
              // Any time grid will do for picking a new slot — only the month
              // view has no times to tap, so that's the one case worth moving.
              if (view === "month") chooseView("7day");
            }
            setOpenSpan(null);
          }}
        />
      )}

      {pendingMove && (
        <Sheet open={!!pendingMove} onClose={() => !moving && setPendingMove(null)} label="Move this session?">
          <div className="flex flex-col gap-4 p-5">
            <div>
              <h2 className="font-serif text-[19px] leading-tight">Move this session?</h2>
              <div className="mt-1 text-[13px] text-muted">
                {pendingMove.span.title.split(" — ")[0]}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl bg-inputbg px-4 py-3 text-[13.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted">From</span>
                <span className="font-semibold tabular-nums line-through decoration-muted/60">
                  {fmtDayLong(new Date(pendingMove.span.start))} · {fmtTime(new Date(pendingMove.span.start))}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted">To</span>
                <span className="font-semibold tabular-nums text-clay-text">
                  {fmtDayLong(pendingMove.newStart)} · {fmtTime(pendingMove.newStart)}
                </span>
              </div>
            </div>
            <p className="text-[12.5px] leading-[1.6] text-muted">
              Google will cancel the old invite and send a new one, so they&apos;ll be told the time has changed.
              Nothing has been sent yet.
            </p>
            <div className="flex flex-wrap gap-2">
              <PrimaryButton
                onClick={() => commitMove(pendingMove.span, pendingMove.newStart)}
                disabled={moving}
                className="px-4 py-2 text-[13px]"
              >
                {moving ? "Moving…" : "Move it"}
              </PrimaryButton>
              <OutlineButton onClick={() => setPendingMove(null)} disabled={moving} className="px-4 py-2 text-[13px]">
                Leave it where it was
              </OutlineButton>
            </div>
          </div>
        </Sheet>
      )}

      {quickBookSlot && (
        <QuickBook
          slot={quickBookSlot}
          onClose={() => setQuickBookSlot(null)}
          onBooked={() => {
            setQuickBookSlot(null);
            week.invalidate();
            month.invalidate();
          }}
        />
      )}

      {composer && (
        <EventComposer
          mode={composer.mode}
          start={composer.start}
          end={composer.end}
          title={composer.title}
          eventId={composer.eventId}
          source={composer.source}
          calendars={calendars}
          onClose={() => setComposer(null)}
          onSaved={() => {
            setComposer(null);
            week.invalidate();
            month.invalidate();
          }}
        />
      )}

      {availComposer && (
        <AvailabilityComposer
          mode={availComposer.mode}
          clinic={availComposer.clinic}
          day={availComposer.day}
          startMin={availComposer.startMin}
          endMin={availComposer.endMin}
          kind={availComposer.kind}
          repeatWeekly={availComposer.repeatWeekly}
          exactStart={availComposer.exactStart}
          id={availComposer.id}
          onClose={() => setAvailComposer(null)}
          onSaved={availabilitySaved}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  londonAddDays,
  londonDateKey,
  londonDayStart,
  londonMinutes,
  londonWeekStart,
  londonWeekdayIndex,
  londonYMD,
  fmtDate,
} from "@/lib/time";
import type { WeeklyHours } from "@/lib/booking/availability";
import { api, useToast } from "../ui";
import { AvailabilityComposer } from "./AvailabilityComposer";
import { BookingPopover } from "./BookingPopover";
import { BookingsList } from "./BookingsList";
import { EventComposer, type EventCalendar } from "./EventComposer";
import { MonthGrid } from "./MonthGrid";
import { QuickBook } from "./QuickBook";
import { TimeGrid } from "./TimeGrid";
import { useWeekSpans } from "./useWeekSpans";
import { AVAIL_COLORS, SPAN_COLORS, type AvailClinic, type AvailWindowDTO, type SpanDTO, type SpanSource } from "./layout";
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
}

interface AvailComposerState {
  mode: "create" | "edit";
  clinic: AvailClinic;
  day: Date;
  startMin: number;
  endMin: number;
  kind?: "open" | "block";
  repeatWeekly?: boolean;
  id?: string;
}

const CLINIC_LABEL: Record<AvailClinic, string> = { bethnal: "Bethnal Green", waterloo: "Waterloo" };

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

export function CalendarView() {
  const toast = useToast();
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
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
  const [hidden, setHidden] = useState<Set<SpanSource>>(new Set());

  // Availability-editing mode: draw the times you're bookable for online booking.
  const [availMode, setAvailMode] = useState(false);
  const [availClinic, setAvailClinic] = useState<AvailClinic>("bethnal");
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours | null>(null);
  const [overrides, setOverrides] = useState<OverrideDTO[]>([]);
  const [availComposer, setAvailComposer] = useState<AvailComposerState | null>(null);
  // What a client can genuinely book, straight from the booking engine — plus
  // why any day has none. Fetched only in availability mode, for the week shown.
  const [bookable, setBookable] = useState<{ slots: string[]; days: BookableDay[] } | null>(null);

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

  const weekStart = useMemo(() => londonWeekStart(anchor), [anchor]);
  const monthGridStart = useMemo(() => {
    const { y, m } = londonYMD(anchor);
    return londonWeekStart(new Date(Date.UTC(y, m - 1, 1, 12)));
  }, [anchor]);

  const week = useWeekSpans(weekStart, 7);
  const month = useWeekSpans(monthGridStart, 42);

  // The availability windows for the visible week & selected clinic: the
  // recurring weekly baseline plus any one-off overrides drawn on the grid.
  const availWindows = useMemo<AvailWindowDTO[]>(() => {
    if (!availMode) return [];
    const out: AvailWindowDTO[] = [];
    for (let i = 0; i < 7; i++) {
      const day = londonAddDays(weekStart, i);
      const dateKey = londonDateKey(day);
      const weekday = londonWeekdayIndex(day);
      for (const w of weeklyHours?.[availClinic] ?? []) {
        if (w.weekday === weekday) {
          out.push({ clinic: availClinic, date: dateKey, kind: "weekly", startMin: w.startMin, endMin: w.endMin });
        }
      }
      for (const o of overrides) {
        if (o.clinic !== availClinic || (o.kind !== "open" && o.kind !== "block")) continue;
        // A one-off shows on its own date; a repeating one shows on its weekday
        // every week from the date it was drawn onward — the same rule the
        // booking engine uses, so what's drawn matches what's bookable.
        if (overrideAppliesOn(o, dateKey, weekday)) {
          out.push({
            id: o.id,
            clinic: availClinic,
            date: dateKey,
            kind: o.kind,
            startMin: o.startMin,
            endMin: o.endMin,
            repeatWeekly: o.repeatWeekly,
          });
        }
      }
    }
    return out;
  }, [availMode, availClinic, weeklyHours, overrides, weekStart]);

  // The real answer for the visible week, refetched whenever the week, the
  // clinic, or anything that could change availability moves.
  useEffect(() => {
    if (!availMode) {
      setBookable(null);
      return;
    }
    let stale = false;
    const url = `/api/bookable?clinic=${availClinic}&start=${encodeURIComponent(weekStart.toISOString())}&days=7`;
    api<{ slots: string[]; days: BookableDay[] }>(url)
      .then((r) => {
        if (!stale) setBookable(r);
      })
      .catch(() => {
        if (!stale) setBookable(null);
      });
    return () => {
      stale = true;
    };
  }, [availMode, availClinic, weekStart, overrides, week.spans]);

  // Bookable starts merged into the ranges they cover, so a run of half-hourly
  // slots reads as one solid band rather than a stack of overlapping hours.
  const bookableWindows = useMemo<AvailWindowDTO[]>(() => {
    if (!bookable?.slots.length) return [];
    const byDay = new Map<string, Array<{ start: number; end: number }>>();
    for (const iso of bookable.slots) {
      const at = new Date(iso);
      const key = londonDateKey(at);
      const startMin = londonMinutes(at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push({ start: startMin, end: startMin + SESSION_MINUTES });
    }
    const out: AvailWindowDTO[] = [];
    for (const [date, ranges] of byDay) {
      for (const iv of mergeIntervals(ranges)) {
        out.push({ clinic: availClinic, date, kind: "bookable", startMin: iv.start, endMin: iv.end });
      }
    }
    return out;
  }, [bookable, availClinic]);

  const dayNotes = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const d of bookable?.days ?? []) if (d.reason) out[d.date] = d.reason;
    return out;
  }, [bookable]);

  function enterAvailability() {
    setView("week");
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
    view === "week"
      ? `${fmtDate(weekStart)} – ${fmtDate(londonAddDays(weekStart, 6))}`
      : new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "long", year: "numeric" }).format(anchor);

  function nav(dir: -1 | 0 | 1) {
    if (dir === 0) {
      setAnchor(new Date());
      return;
    }
    if (view === "week") setAnchor((a) => londonDayStart(dir * 7, a));
    else {
      const { y, m } = londonYMD(anchor);
      setAnchor(new Date(Date.UTC(y, m - 1 + dir, 1, 12)));
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

  async function handleEventMove(span: SpanDTO, newStart: Date) {
    try {
      if (span.source === "booking" && span.bookingId) {
        await api(`/api/bookings/${span.bookingId}`, {
          method: "PATCH",
          body: JSON.stringify({ startISO: newStart.toISOString() }),
        });
      } else if (span.source === "personal" && span.googleEventId) {
        const durMs = new Date(span.end).getTime() - new Date(span.start).getTime();
        await api("/api/events", {
          method: "PATCH",
          body: JSON.stringify({
            calendar: "personal",
            eventId: span.googleEventId,
            title: span.title,
            startISO: newStart.toISOString(),
            endISO: new Date(newStart.getTime() + durMs).toISOString(),
          }),
        });
      } else {
        return;
      }
      toast("Moved ✓");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't move that");
    } finally {
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

  return (
    <div className="flex max-w-[1200px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Calendar</h1>
          <div className="mt-[5px] text-[13.5px] text-muted">
            {availMode
              ? "Drag across the grid to mark when you're available for online booking. Tap a green window to edit or remove it."
              : "Tap a booking to manage it, tap a free space to book a client, or drag across the grid to add any event to your calendar."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => (availMode ? setAvailMode(false) : enterAvailability())}
            className={`cursor-pointer rounded-full border px-3.5 py-[7px] text-[12.5px] font-semibold select-none ${
              availMode ? "text-cream" : "border-line bg-card text-ink-soft hover:bg-hoverbg"
            }`}
            style={availMode ? { background: AVAIL_COLORS.open.border, borderColor: AVAIL_COLORS.open.border } : undefined}
          >
            {availMode ? "Done editing availability" : "Set availability"}
          </button>
          {!availMode && (
            <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
              {(["week", "month"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`cursor-pointer rounded-full px-3.5 py-[6px] text-[12.5px] font-semibold capitalize select-none ${
                    view === v ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
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
          <div className="text-[13px] font-semibold text-ink-soft">{rangeLabel}</div>
        </div>
      </header>

      {reschedule && (
        <div className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-clay/40 bg-clay-tint px-4 py-2.5 text-[13px] font-medium text-clay-text">
          <span>Pick a new slot for {reschedule.clientName} — tap any free space.</span>
          <button
            onClick={() => setReschedule(null)}
            className="cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-semibold hover:bg-[oklch(0.9_0.04_48)]"
          >
            Cancel
          </button>
        </div>
      )}

      {availMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-sage/50 bg-sage-tint px-4 py-2.5 text-[13px]">
          <span className="font-semibold text-sage-text">Availability for</span>
          <div className="flex rounded-full border border-line bg-card p-[3px]">
            {(["bethnal", "waterloo"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setAvailClinic(c)}
                className={`cursor-pointer rounded-full px-3 py-[5px] text-[12px] font-semibold select-none ${
                  availClinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
                }`}
              >
                {CLINIC_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-[3px] border"
                style={{ background: AVAIL_COLORS.weekly.bg, borderColor: AVAIL_COLORS.weekly.border }}
              />
              Your usual hours (
              <a href="/settings" className="font-semibold text-sage-text underline">
                Settings
              </a>
              )
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-[3px] border"
                style={{ background: AVAIL_COLORS.bookable.bg, borderColor: AVAIL_COLORS.bookable.border }}
              />
              <b className="font-semibold text-sage-text">Actually bookable now</b>
            </span>
            <span>
              Where they differ, something has closed the time — a calendar event, a gap setting, the notice
              window or the weekly cap. Empty days say which. Draw here to open or close specific days.
            </span>
          </div>
        </div>
      )}

      {/* calendar toggles — tap to show/hide each shared calendar */}
      <div className="flex flex-wrap items-center gap-2">
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

      {view === "week" ? (
        !week.spans ? (
          <div className="flex h-[300px] items-center justify-center rounded-2xl border border-line bg-card text-[13.5px] text-muted">
            Loading your calendars…
          </div>
        ) : (
          <TimeGrid
            weekStart={weekStart}
            spans={visible(week.spans) ?? []}
            mode="display"
            availabilityMode={availMode}
            availWindows={availMode ? [...availWindows, ...bookableWindows] : undefined}
            dayNotes={availMode ? dayNotes : undefined}
            onAvailabilityClick={(w) => {
              // Only a real one-off override is editable here. The weekly
              // baseline lives in Settings, and the bookable layer is a computed
              // read-out — there's nothing to open for either.
              if (!w.id || (w.kind !== "open" && w.kind !== "block")) return;
              setAvailComposer({
                mode: "edit",
                clinic: availClinic,
                day: new Date(`${w.date}T12:00:00Z`),
                startMin: w.startMin,
                endMin: w.endMin,
                kind: w.kind,
                repeatWeekly: w.repeatWeekly,
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
            onEventMove={availMode || reschedule ? undefined : handleEventMove}
          />
        )
      ) : (
        <MonthGrid
          month={anchor}
          spans={visible(month.spans)}
          onDayClick={(day) => {
            setAnchor(day);
            setView("week");
          }}
        />
      )}

      <BookingsList
        spans={view === "week" ? week.spans : month.spans}
        onChanged={() => {
          week.invalidate();
          month.invalidate();
        }}
      />

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
              setView("week");
            }
            setOpenSpan(null);
          }}
        />
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
          id={availComposer.id}
          onClose={() => setAvailComposer(null)}
          onSaved={availabilitySaved}
        />
      )}
    </div>
  );
}

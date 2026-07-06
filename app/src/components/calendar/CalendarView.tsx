"use client";

import { useMemo, useState } from "react";
import { londonDayStart, londonWeekStart, londonYMD, fmtDate } from "@/lib/time";
import { api, useToast } from "../ui";
import { BookingPopover } from "./BookingPopover";
import { Legend } from "./Legend";
import { MonthGrid } from "./MonthGrid";
import { QuickBook } from "./QuickBook";
import { TimeGrid } from "./TimeGrid";
import { useWeekSpans } from "./useWeekSpans";
import type { SpanDTO } from "./layout";

const TZ = "Europe/London";

export function CalendarView() {
  const toast = useToast();
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [openSpan, setOpenSpan] = useState<{ span: SpanDTO; anchor: { x: number; y: number } } | null>(null);
  const [quickBookSlot, setQuickBookSlot] = useState<Date | null>(null);
  const [reschedule, setReschedule] = useState<{ bookingId: string; clientName: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const weekStart = useMemo(() => londonWeekStart(anchor), [anchor]);
  const monthGridStart = useMemo(() => {
    const { y, m } = londonYMD(anchor);
    return londonWeekStart(new Date(Date.UTC(y, m - 1, 1, 12)));
  }, [anchor]);

  const week = useWeekSpans(weekStart, 7);
  const month = useWeekSpans(monthGridStart, 42);

  const rangeLabel =
    view === "week"
      ? `${fmtDate(weekStart)} – ${fmtDate(new Date(weekStart.getTime() + 6 * 86_400_000))}`
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
            All three calendars — tap a booking to manage it, tap a free space to book.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      {view === "week" ? (
        !week.spans ? (
          <div className="flex h-[300px] items-center justify-center rounded-2xl border border-line bg-card text-[13.5px] text-muted">
            Loading your calendars…
          </div>
        ) : (
          <>
            <TimeGrid
              weekStart={weekStart}
              spans={week.spans}
              mode="display"
              onEventClick={(span, a) => setOpenSpan({ span, anchor: a })}
              onSlotClick={handleSlotClick}
            />
            <Legend />
          </>
        )
      ) : (
        <>
          <MonthGrid
            month={anchor}
            spans={month.spans}
            onDayClick={(day) => {
              setAnchor(day);
              setView("week");
            }}
          />
          <Legend />
        </>
      )}

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
    </div>
  );
}

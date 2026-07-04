"use client";

import { useEffect, useState } from "react";
import { Card, Chip, SectionLabel, useToast } from "./ui";
import { fmtDayShort, fmtTime, londonDayStart } from "@/lib/time";

interface BusySpan {
  start: string;
  end: string;
  title: string;
  known: boolean;
}

export function CalendarWeek() {
  const toast = useToast();
  const [spans, setSpans] = useState<BusySpan[] | null>(null);

  useEffect(() => {
    fetch("/api/availability?days=7")
      .then((r) => r.json())
      .then((d) => setSpans(d.spans ?? []))
      .catch(() => toast("Couldn't load your calendar"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = Array.from({ length: 7 }, (_, i) => londonDayStart(i));

  return (
    <div className="flex max-w-[1200px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header>
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Calendar</h1>
        <div className="mt-[5px] text-[13.5px] text-muted">The week at a glance — personal + room/block events.</div>
      </header>

      {!spans ? (
        <div className="flex h-[220px] items-center justify-center rounded-2xl border border-line bg-card text-[13.5px] text-muted">
          Loading…
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {days.map((day) => {
            const dayEnd = new Date(day.getTime() + 86_400_000);
            const events = spans
              .filter((s) => new Date(s.start) < dayEnd && new Date(s.end) > day)
              .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            return (
              <div key={day.toISOString()} className="w-[220px] flex-none">
                <SectionLabel className="mb-2 text-center">{fmtDayShort(day)}</SectionLabel>
                <Card className="flex min-h-[120px] flex-col gap-2 px-3 py-3">
                  {events.length === 0 && <div className="py-4 text-center text-xs text-muted">Free</div>}
                  {events.map((ev, i) => (
                    <div key={i} className="flex flex-col gap-1 rounded-lg bg-inputbg px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11.5px] font-semibold tabular-nums">
                          {fmtTime(new Date(ev.start))}–{fmtTime(new Date(ev.end))}
                        </span>
                        {ev.known ? (
                          <Chip color="oklch(0.42 0.1 42)" bg="oklch(0.94 0.03 48)">
                            Booked
                          </Chip>
                        ) : (
                          <Chip color="oklch(0.5 0.02 58)" bg="oklch(0.94 0.01 80)">
                            Busy
                          </Chip>
                        )}
                      </div>
                      <div className="text-[12px] leading-snug text-[oklch(0.4_0.02_60)]">{ev.title}</div>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { londonAddDays, londonWeekStart, londonYMD } from "@/lib/time";
import { SPAN_COLORS, type SpanDTO } from "./layout";

/** Classic month grid: weeks as rows, each day showing its first few events. */
export function MonthGrid({
  month, // any instant inside the month being shown
  spans,
  onDayClick,
}: {
  month: Date;
  spans: SpanDTO[] | null;
  onDayClick: (day: Date) => void;
}) {
  const { y: curY, m: curM } = londonYMD(month);

  const days = useMemo(() => {
    const first = new Date(Date.UTC(curY, curM - 1, 1, 12)); // midday avoids DST edges
    const gridStart = londonWeekStart(first);
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = londonAddDays(gridStart, i);
      out.push(d);
      // stop once a full week past the month's end has been rendered
      if (i % 7 === 6 && i >= 27) {
        const { m } = londonYMD(londonAddDays(d, 1));
        if (m !== curM) break;
      }
    }
    return out;
  }, [curY, curM]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, SpanDTO[]>();
    for (const s of spans ?? []) {
      const start = new Date(s.start);
      const end = new Date(s.end);
      // Bucket the event into every London day it overlaps — a timed event can
      // cross midnight, and the week grid splits it per day, so the month view
      // must show it on both days too rather than only its start day.
      let cursor = start;
      for (let i = 0; i < 60; i++) {
        const { y, m, d } = londonYMD(cursor);
        const key = `${y}-${m}-${d}`;
        const arr = map.get(key) ?? [];
        arr.push(s);
        map.set(key, arr);
        const nextDay = londonAddDays(cursor, 1);
        if (nextDay >= end) break;
        cursor = nextDay;
      }
    }
    return map;
  }, [spans]);

  const today = londonYMD(new Date());

  return (
    <div className="overflow-x-auto pb-2">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-7 px-0.5 pb-1.5">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="text-center text-[11.5px] font-semibold tracking-wide text-muted">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          {days.map((day) => {
            const ymd = londonYMD(day);
            const inMonth = ymd.m === curM;
            const isToday = ymd.y === today.y && ymd.m === today.m && ymd.d === today.d;
            const events = (eventsByDay.get(`${ymd.y}-${ymd.m}-${ymd.d}`) ?? []).sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
            );
            return (
              <button
                key={day.toISOString()}
                onClick={() => onDayClick(day)}
                className={`flex min-h-[92px] cursor-pointer flex-col gap-1 border-t border-l border-hairline p-1.5 text-left align-top hover:bg-hoverbg ${
                  inMonth ? "" : "bg-[oklch(0.955_0.008_82)]"
                }`}
              >
                <span
                  className={`self-start rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums ${
                    isToday ? "bg-clay text-cream" : inMonth ? "text-ink-soft" : "text-faint"
                  }`}
                >
                  {ymd.d}
                </span>
                {events.slice(0, 3).map((s, i) => {
                  const c = SPAN_COLORS[s.source];
                  return (
                    <span
                      key={i}
                      className="flex items-center gap-1 truncate rounded px-1 py-px text-[10px] leading-snug"
                      style={{ background: c.bg, color: c.text }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 flex-none rounded-full"
                        style={{ background: c.border }}
                      />
                      <span className="truncate">{s.title}</span>
                    </span>
                  );
                })}
                {events.length > 3 && (
                  <span className="text-[10px] font-medium text-muted">+{events.length - 3} more</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

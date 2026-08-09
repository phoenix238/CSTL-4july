"use client";

import Link from "next/link";
import { Card, Chip, SectionLabel, clinicChip } from "./ui";

export interface WeekRow {
  id: string;
  clientId: string;
  time: string;
  name: string;
  isNew: boolean;
  clinic: string;
}

export interface WeekDay {
  dateKey: string;
  label: string;
  rows: WeekRow[];
}

export function WeekView({
  rangeLabel,
  countLabel,
  days,
}: {
  rangeLabel: string;
  countLabel: string;
  days: WeekDay[];
}) {
  const activeDays = days.filter((d) => d.rows.length > 0);

  return (
    <div className="flex max-w-[900px] flex-col gap-5 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header>
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[30px]">This week</h1>
        <div className="mt-[5px] text-[13.5px] text-muted">
          {rangeLabel}
          {countLabel ? ` · ${countLabel}` : ""}
        </div>
      </header>

      {activeDays.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[oklch(0.87_0.02_78)] bg-inputbg p-6 text-center text-[13px] text-muted">
          No sessions booked this week.
        </div>
      )}

      {activeDays.map((day) => (
        <section key={day.dateKey} className="flex flex-col gap-2.5">
          <SectionLabel>{day.label.toUpperCase()}</SectionLabel>
          <Card className="px-4 py-0.5 lg:px-[18px]">
            {day.rows.map((r, i) => {
              const clinic = clinicChip(r.clinic);
              return (
                <div
                  key={r.id}
                  className={`flex flex-wrap items-center gap-3 py-3 ${
                    i < day.rows.length - 1 ? "border-b border-hairline" : ""
                  }`}
                >
                  <div className="w-[68px] flex-none text-[13.5px] font-semibold tabular-nums">{r.time}</div>
                  <Link
                    href={`/clients/${r.clientId}`}
                    className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium hover:text-clay"
                  >
                    {r.name}
                  </Link>
                  {r.isNew && (
                    <span className="flex-none text-[10.5px] font-semibold tracking-[0.06em] text-clay">
                      NEW CLIENT
                    </span>
                  )}
                  <Chip color={clinic.color} bg={clinic.bg}>
                    {clinic.label}
                  </Chip>
                </div>
              );
            })}
          </Card>
        </section>
      ))}
    </div>
  );
}

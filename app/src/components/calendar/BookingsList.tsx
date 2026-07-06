"use client";

import Link from "next/link";
import { useState } from "react";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { Card, OutlineButton, SectionLabel, api, useToast } from "../ui";
import type { SpanDTO } from "./layout";

/** Every one of our bookings in the visible range, with a one-tap Cancel — no need to open each event. */
export function BookingsList({
  spans,
  onChanged,
}: {
  spans: SpanDTO[] | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const bookings = (spans ?? [])
    .filter((s) => s.source === "booking" && s.bookingId)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (bookings.length === 0) return null;

  async function cancel(span: SpanDTO) {
    if (!span.bookingId) return;
    const name = span.title.split(" — ")[0];
    if (!window.confirm(`Cancel ${name}'s session? Both the personal and clinic/room calendar events are deleted.`))
      return;
    setCancellingId(span.bookingId);
    try {
      await api(`/api/bookings/${span.bookingId}`, { method: "DELETE" });
      toast("Booking cancelled — both events removed, slot is free again");
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't cancel that booking");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>BOOKINGS THIS RANGE — {bookings.length}</SectionLabel>
      <Card className="px-4 py-0.5 lg:px-[18px]">
        {bookings.map((b, i) => (
          <div
            key={b.bookingId}
            className={`flex flex-wrap items-center gap-3 py-2.5 ${
              i < bookings.length - 1 ? "border-b border-hairline" : ""
            }`}
          >
            <div className="w-[150px] flex-none text-[12.5px] font-semibold tabular-nums">
              {fmtDayLong(new Date(b.start))} · {fmtTime(new Date(b.start))}
            </div>
            {b.clientId ? (
              <Link
                href={`/clients/${b.clientId}`}
                className="min-w-0 flex-1 truncate text-[13.5px] font-semibold hover:text-clay"
              >
                {b.title.split(" — ")[0]}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{b.title.split(" — ")[0]}</span>
            )}
            <span className="flex-none text-[11.5px] text-muted">
              {b.clinic ? CLINIC_LABEL[b.clinic as Clinic] : ""}
            </span>
            <OutlineButton
              className="flex-none px-3 py-1 text-[12px]"
              onClick={() => cancel(b)}
              disabled={cancellingId === b.bookingId}
            >
              {cancellingId === b.bookingId ? "Cancelling…" : "Cancel"}
            </OutlineButton>
          </div>
        ))}
      </Card>
    </div>
  );
}

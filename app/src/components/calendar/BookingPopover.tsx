"use client";

import Link from "next/link";
import { fmtDayLong, fmtTime } from "@/lib/time";
import { CLINIC_LABEL } from "@/lib/booking/rules";
import { OutlineButton, PrimaryButton, TintButton } from "../ui";
import type { SpanDTO } from "./layout";

/**
 * Floating card shown when an event block is clicked. Our bookings get full
 * control (open client / reschedule / cancel); foreign Google events are
 * read-only — they're edited in Google Calendar itself.
 */
export function BookingPopover({
  span,
  anchor,
  onClose,
  onReschedule,
  onCancel,
  cancelling,
}: {
  span: SpanDTO;
  anchor: { x: number; y: number };
  onClose: () => void;
  onReschedule: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const start = new Date(span.start);
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(anchor.x, typeof window !== "undefined" ? window.innerWidth - 300 : anchor.x),
    top: Math.min(anchor.y + 8, typeof window !== "undefined" ? window.innerHeight - 220 : anchor.y),
    zIndex: 50,
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={style}
        className="w-[280px] rounded-2xl border border-line bg-card p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {span.source === "booking" && span.clientId ? (
          <div className="flex flex-col gap-2.5">
            <div>
              <Link
                href={`/clients/${span.clientId}`}
                className="font-serif text-[17px] font-medium text-ink hover:text-clay"
              >
                {span.title}
              </Link>
              <div className="mt-0.5 text-[12.5px] text-muted">
                {fmtDayLong(start)} · {fmtTime(start)}–{fmtTime(new Date(span.end))}
                {span.clinic ? ` · ${CLINIC_LABEL[span.clinic]}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/clients/${span.clientId}`}>
                <PrimaryButton className="px-3.5 py-1.5 text-[12.5px]">Open client</PrimaryButton>
              </Link>
              <OutlineButton className="px-3 py-1.5 text-[12.5px]" onClick={onReschedule}>
                Reschedule
              </OutlineButton>
              <TintButton className="text-[12.5px]" onClick={onCancel} disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel booking"}
              </TintButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="text-[14px] font-semibold">{span.title}</div>
            <div className="text-[12.5px] text-muted">
              {fmtDayLong(start)} · {fmtTime(start)}–{fmtTime(new Date(span.end))}
            </div>
            <div className="mt-1 text-[12px] text-faint">
              Synced from Google — edit this one in Google Calendar.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

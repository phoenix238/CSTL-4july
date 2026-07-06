"use client";

import Link from "next/link";
import { Card, Chip, SectionLabel, TintButton } from "../ui";

export interface WaitingEnquiry {
  id: string;
  via: string;
  name: string;
  text: string;
  status?: string;
  clientId: string | null;
  offeredTimes?: string[];
  createdAt: string;
}

export function viaChip(via: string) {
  switch (via) {
    case "WHATSAPP":
      return { label: "WhatsApp", color: "oklch(0.42 0.08 148)", bg: "oklch(0.94 0.03 148)" };
    case "EMAIL":
      return { label: "Email", color: "oklch(0.5 0.09 75)", bg: "oklch(0.95 0.035 85)" };
    default:
      return { label: "Pasted", color: "oklch(0.5 0.02 58)", bg: "oklch(0.94 0.01 80)" };
  }
}

/** The WAITING list — every enquiry that hasn't been booked or dismissed yet. */
export function Inbox({
  waiting,
  onOpen,
}: {
  waiting: WaitingEnquiry[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex w-full flex-none flex-col gap-2 lg:w-[330px]">
      <SectionLabel>WAITING ({waiting.length})</SectionLabel>
      {waiting.length === 0 ? (
        <Card className="flex items-center justify-center px-4 py-8 text-[13.5px] text-muted">
          Inbox clear ✓
        </Card>
      ) : (
        waiting.map((q) => {
          const chip = viaChip(q.via);
          const offered = q.status === "offered";
          return (
            <Card key={q.id} className="flex flex-col gap-2 px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                {q.clientId ? (
                  <Link
                    href={`/clients/${q.clientId}`}
                    className="text-[14px] font-semibold text-ink hover:text-clay"
                  >
                    {q.name || "Unknown"}
                  </Link>
                ) : (
                  <span className="text-[14px] font-semibold">{q.name || "Unknown"}</span>
                )}
                <Chip color={chip.color} bg={chip.bg}>
                  {chip.label}
                </Chip>
              </div>
              {offered ? (
                <div className="text-[12.5px] font-medium text-amber-text">
                  Offered {q.offeredTimes?.length ?? 0} time{(q.offeredTimes?.length ?? 0) === 1 ? "" : "s"} · awaiting reply
                </div>
              ) : (
                <div className="line-clamp-1 text-[12.5px] text-muted">&ldquo;{q.text.trim()}&rdquo;</div>
              )}
              <TintButton className="self-start" onClick={() => onOpen(q.id)}>
                {offered ? "Confirm a time" : "Open"}
              </TintButton>
            </Card>
          );
        })
      )}
    </div>
  );
}

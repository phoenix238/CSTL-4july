"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Card, Chip, clinicChip, SectionLabel, useToast } from "./ui";

export interface TodayRow {
  id: string;
  clientId: string;
  time: string;
  name: string;
  isNew: boolean;
  clinic: string;
  intakeDone: boolean;
}

export interface AttentionItem {
  kind: "enquiry" | "intake";
  id: string;
  name: string;
  desc: string;
}

export function TodayView({
  dateLabel,
  countLabel,
  rows,
  attention,
  allSynced,
}: {
  dateLabel: string;
  countLabel: string;
  rows: TodayRow[];
  attention: AttentionItem[];
  allSynced: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex max-w-[1080px] flex-col gap-5 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[30px]">
            {greeting}, Phoenix
          </h1>
          <div className="mt-[5px] text-[13.5px] text-muted">
            {dateLabel}
            {countLabel ? ` · ${countLabel}` : ""}
          </div>
        </div>
        <Link
          href="/enquiries"
          className="rounded-full bg-clay px-5 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-clay-deep"
        >
          New enquiry
        </Link>
      </header>

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <section className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
          <SectionLabel>CLIENTS TODAY</SectionLabel>
          {rows.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[oklch(0.87_0.02_78)] bg-inputbg p-6 text-center text-[13px] text-muted">
              No sessions booked for today.
            </div>
          )}
          {rows.map((r) => {
            const clinic = clinicChip(r.clinic);
            return (
              <Card key={r.id} className="flex items-center gap-4 px-4 py-4 lg:gap-[18px] lg:px-[18px]">
                <div className="w-[62px] flex-none text-center">
                  <div className="text-xl font-semibold tabular-nums">{r.time}</div>
                  <div className="mt-px text-[11px] text-muted">60 min</div>
                </div>
                <div className="w-px self-stretch bg-line" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[17px] font-medium lg:text-lg">{r.name}</span>
                    {r.isNew && (
                      <span className="text-[10.5px] font-semibold tracking-[0.06em] text-clay">
                        NEW CLIENT
                      </span>
                    )}
                  </div>
                  <div className="mt-[7px] flex flex-wrap gap-[7px]">
                    <Chip color={clinic.color} bg={clinic.bg}>
                      {clinic.label}
                    </Chip>
                    {r.intakeDone ? (
                      <Chip color="oklch(0.42 0.08 148)" bg="oklch(0.94 0.03 148)">
                        Intake ✓
                      </Chip>
                    ) : (
                      <Chip color="oklch(0.5 0.09 75)" bg="oklch(0.95 0.035 85)">
                        Intake pending
                      </Chip>
                    )}
                  </div>
                </div>
                <Link
                  href={`/clients/${r.clientId}`}
                  className="flex-none rounded-full border-[1.5px] border-clay/45 px-4 py-2 text-[13px] font-semibold text-clay-text hover:bg-clay-tint"
                >
                  Go to client
                </Link>
              </Card>
            );
          })}
          {allSynced && (
            <div className="flex items-center gap-2 px-1 pt-1.5 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-sage" />
              Calendar synced — invites &amp; reminders out for today
            </div>
          )}
        </section>

        <aside className="flex w-full flex-none flex-col gap-2.5 lg:w-[290px]">
          <SectionLabel>NEEDS ATTENTION</SectionLabel>
          <Card className="px-4 py-1.5">
            {attention.length === 0 && (
              <div className="py-5 text-center text-[13px] text-muted">All clear ✓</div>
            )}
            {attention.map((a, i) => (
              <div
                key={`${a.kind}-${a.id}`}
                className={`flex items-center gap-3 py-3 ${i < attention.length - 1 ? "border-b border-hairline" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{a.name}</div>
                  <div className="mt-0.5 text-xs text-muted">{a.desc}</div>
                </div>
                {a.kind === "enquiry" ? (
                  <button
                    onClick={() => router.push(`/enquiries?open=${a.id}`)}
                    className="flex-none cursor-pointer rounded-full bg-clay px-3 py-1.5 text-xs font-semibold text-cream hover:bg-clay-deep"
                  >
                    Book
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        await api(`/api/clients/${a.id}/intake-email`, { method: "POST" });
                        toast(`Intake form re-sent to ${a.name.split(" ")[0]} ✓`);
                      } catch (err) {
                        toast(err instanceof Error ? err.message : "Couldn't send");
                      }
                    }}
                    className="flex-none cursor-pointer rounded-full bg-clay-tint px-3 py-1.5 text-xs font-semibold text-clay-text"
                  >
                    Resend
                  </button>
                )}
              </div>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}

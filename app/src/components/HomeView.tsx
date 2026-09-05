"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Card, Chip, clinicChip, SectionLabel, useToast } from "./ui";

export interface TodayRow {
  id: string;
  clientId: string;
  time: string;
  name: string;
  isNew: boolean;
  /** 1-based position of this session in the client's non-cancelled history */
  sessionNumber: number;
  clinic: string;
  intakeDone: boolean;
}

export interface WeekRow {
  id: string;
  clientId: string;
  time: string;
  name: string;
  isNew: boolean;
  sessionNumber: number;
  clinic: string;
}

export interface WeekDay {
  dateKey: string;
  label: string;
  rows: WeekRow[];
}

export interface AttentionItem {
  kind: "intake" | "unpaid";
  id: string;
  name: string;
  desc: string;
  /** unpaid only: a reminder has already been sent to the client */
  reminded?: boolean;
}

/**
 * Something that arrived rather than something outstanding — an enquiry
 * someone sent in, or a client who booked themselves online. Distinct from
 * AttentionItem: nothing here lingers as a chore, it's just a heads-up to
 * glance at (and, for an online booking, is what puts the red dot on Home).
 */
export interface NotificationItem {
  kind: "enquiry" | "booked_online";
  id: string;
  name: string;
  desc: string;
  /** booked_online only, when the client record exists to link to */
  clientId?: string | null;
  /** arrived since Home was last opened */
  isNew: boolean;
}

/**
 * The home dashboard — Today, the rest of this week, and what needs attention,
 * all on one screen. It replaces the old split Today / This week tabs so the
 * phone home screen answers "what have I got on, and what needs me?" in one
 * glance.
 *
 * On a phone the day's sessions read as full cards, the week ahead as a compact
 * per-day list, and every action (go to client, mark paid, scan the bank) is a
 * finger-sized tap target that stacks rather than crowding onto one line.
 */
export function HomeView({
  dateLabel,
  todayCountLabel,
  rows,
  weekAhead,
  weekCountLabel,
  upcoming,
  upcomingCount,
  notifications,
  hasUnviewedNotifications,
  attention,
  allSynced,
}: {
  dateLabel: string;
  todayCountLabel: string;
  rows: TodayRow[];
  weekAhead: WeekDay[];
  weekCountLabel: string;
  /** every confirmed session beyond this week, grouped by day */
  upcoming: WeekDay[];
  upcomingCount: number;
  notifications: NotificationItem[];
  /** an online booking arrived since Home was last opened — drives the nav red dot */
  hasUnviewedNotifications: boolean;
  attention: AttentionItem[];
  allSynced: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [remindedIds, setRemindedIds] = useState<Set<string>>(new Set());
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Items are marked paid on the client without a full reload, so the row can
  // disappear the instant it's handled; a refresh then reconciles with the server.
  const visibleAttention = attention.filter(
    (a) => !(a.kind === "unpaid" && paidIds.has(a.id)),
  );
  const unpaidCount = visibleAttention.filter(
    (a) => a.kind === "unpaid",
  ).length;
  const visibleNotifications = notifications.filter(
    (n) => !dismissedIds.has(n.id),
  );

  // Clears the red dot on the Home nav link. Runs once the page has genuinely
  // mounted in the browser — a Link prefetch never executes this, so the dot
  // survives until Phoenix actually looks. Only bothers writing when there's
  // something to clear.
  const markedViewed = useRef(false);
  useEffect(() => {
    if (!hasUnviewedNotifications || markedViewed.current) return;
    markedViewed.current = true;
    api("/api/notifications/viewed", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => {
        markedViewed.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnviewedNotifications]);

  async function dismissNotification(id: string) {
    setDismissedIds((s) => new Set(s).add(id));
    try {
      await api(`/api/enquiries/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setDismissedIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      toast(err instanceof Error ? err.message : "Couldn't dismiss that");
    }
  }

  // Clears every notification currently on screen in one go. Enquiries are
  // soft-dismissed (they still need a reply later) while booked-online
  // notices are hard-deleted, same as their individual dismiss actions above.
  async function clearAllNotifications() {
    const targets = visibleNotifications;
    if (targets.length === 0) return;
    setDismissedIds((s) => {
      const next = new Set(s);
      targets.forEach((n) => next.add(n.id));
      return next;
    });
    const results = await Promise.allSettled(
      targets.map((n) =>
        n.kind === "enquiry"
          ? api(`/api/enquiries/${n.id}/dismiss`, { method: "POST" })
          : api(`/api/enquiries/${n.id}`, { method: "DELETE" }),
      ),
    );
    const failed = targets.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      setDismissedIds((s) => {
        const next = new Set(s);
        failed.forEach((n) => next.delete(n.id));
        return next;
      });
      toast(
        failed.length === targets.length
          ? "Couldn't clear notifications"
          : `Couldn't clear ${failed.length} notification${failed.length === 1 ? "" : "s"}`,
      );
    }
    router.refresh();
  }

  function weekDayCard(day: WeekDay) {
    return (
      <div key={day.dateKey} className="flex flex-col gap-1.5">
        <div className="px-0.5 text-[11px] font-semibold tracking-[0.08em] text-muted">
          {day.label.toUpperCase()}
        </div>
        <Card className="px-4 py-0.5 lg:px-[18px]">
          {day.rows.map((r, i) => {
            const clinic = clinicChip(r.clinic);
            return (
              <div
                key={r.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 ${
                  i < day.rows.length - 1 ? "border-b border-hairline" : ""
                }`}
              >
                <div className="w-[52px] flex-none text-[13.5px] font-semibold tabular-nums">
                  {r.time}
                </div>
                <Link
                  href={`/clients/${r.clientId}`}
                  className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium hover:text-clay"
                >
                  {r.name}
                </Link>
                {r.isNew ? (
                  <span className="flex-none text-[10.5px] font-semibold tracking-[0.06em] text-clay">
                    NEW · 1ST
                  </span>
                ) : (
                  <span className="flex-none text-[11px] text-muted">
                    session {r.sessionNumber}
                  </span>
                )}
                <Chip color={clinic.color} bg={clinic.bg}>
                  {clinic.label}
                </Chip>
              </div>
            );
          })}
        </Card>
      </div>
    );
  }

  async function markPaid(a: AttentionItem) {
    setBusyId(a.id);
    try {
      await api(`/api/bookings/${a.id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ paid: true }),
      });
      setPaidIds((s) => new Set(s).add(a.id));
      toast(`Marked paid — ${a.name.split(" ")[0]} ✓`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setBusyId(null);
    }
  }

  async function remind(a: AttentionItem) {
    setBusyId(a.id);
    try {
      await api(`/api/bookings/${a.id}/payment-reminder`, { method: "POST" });
      setRemindedIds((s) => new Set(s).add(a.id));
      toast(`Reminder sent to ${a.name.split(" ")[0]} ✓`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setBusyId(null);
    }
  }

  async function scanForPayments() {
    setScanning(true);
    try {
      const s = await api<{
        newCount: number;
        matchedCount: number;
        unmatchedCount: number;
        ambiguousCount: number;
      }>("/api/payments/sync", {
        method: "POST",
        body: JSON.stringify({ force: true }),
      });
      toast(
        s.newCount === 0
          ? "No new payments since last time"
          : `${s.newCount} new · ${s.matchedCount} matched · ${s.unmatchedCount + s.ambiguousCount} need a look`,
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't reach the bank");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex max-w-[1080px] flex-col gap-5 p-4 pb-16 sm:p-5 lg:px-[30px] lg:pt-[26px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[30px]">
            {greeting}, Phoenix
          </h1>
          <div className="mt-[5px] text-[13.5px] text-muted">
            {dateLabel}
            {todayCountLabel ? ` · ${todayCountLabel}` : ""}
          </div>
        </div>
        <Link
          href="/enquiries"
          className="rounded-full bg-clay px-5 py-3 text-[14px] font-semibold text-cream hover:bg-clay-deep sm:py-2.5 sm:text-[13.5px]"
        >
          New enquiry
        </Link>
      </header>

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-7">
          {/* ---------- today ---------- */}
          <section className="flex w-full min-w-0 flex-col gap-2.5">
            <SectionLabel>TODAY</SectionLabel>
            {rows.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[oklch(0.87_0.02_78)] bg-inputbg p-6 text-center text-[13px] text-muted">
                No sessions booked for today.
              </div>
            )}
            {rows.map((r) => {
              const clinic = clinicChip(r.clinic);
              return (
                <Card
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 lg:gap-x-[18px] lg:px-[18px]"
                >
                  <div className="w-[58px] flex-none text-center">
                    <div className="text-xl font-semibold tabular-nums">
                      {r.time}
                    </div>
                    <div className="mt-px text-[11px] text-muted">60 min</div>
                  </div>
                  <div className="hidden w-px self-stretch bg-line sm:block" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <Link
                        href={`/clients/${r.clientId}`}
                        className="font-serif text-[17px] font-medium hover:text-clay lg:text-lg"
                      >
                        {r.name}
                      </Link>
                      {r.isNew ? (
                        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-clay">
                          NEW CLIENT · 1ST SESSION
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted">
                          session {r.sessionNumber}
                        </span>
                      )}
                    </div>
                    <div className="mt-[7px] flex flex-wrap gap-[7px]">
                      <Chip color={clinic.color} bg={clinic.bg}>
                        {clinic.label}
                      </Chip>
                      {r.intakeDone ? (
                        <Chip
                          color="oklch(0.42 0.08 148)"
                          bg="oklch(0.94 0.03 148)"
                        >
                          Intake ✓
                        </Chip>
                      ) : (
                        <Chip
                          color="oklch(0.5 0.09 75)"
                          bg="oklch(0.95 0.035 85)"
                        >
                          Intake pending
                        </Chip>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/clients/${r.clientId}`}
                    className="w-full flex-none rounded-full border-[1.5px] border-clay/45 px-4 py-2.5 text-center text-[13.5px] font-semibold text-clay-text hover:bg-clay-tint sm:w-auto sm:py-2 sm:text-[13px]"
                  >
                    Go to client
                  </Link>
                </Card>
              );
            })}
            {allSynced && rows.length > 0 && (
              <div className="flex items-center gap-2 px-1 pt-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-sage" />
                Calendar synced — invites &amp; reminders out for today
              </div>
            )}
          </section>

          {/* ---------- rest of the week ---------- */}
          <section className="flex w-full min-w-0 flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <SectionLabel>REST OF THE WEEK</SectionLabel>
              {weekCountLabel ? (
                <span className="text-[11px] text-muted">{weekCountLabel}</span>
              ) : null}
            </div>
            {weekAhead.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[oklch(0.87_0.02_78)] bg-inputbg p-6 text-center text-[13px] text-muted">
                Nothing else booked this week.
              </div>
            )}
            {weekAhead.map(weekDayCard)}
          </section>

          {/* ---------- upcoming (everything past this week) ---------- */}
          <section className="flex w-full min-w-0 flex-col gap-2.5">
            <button
              onClick={() => setUpcomingOpen((v) => !v)}
              className="flex cursor-pointer items-baseline justify-between gap-3 text-left"
            >
              <span className="flex items-center gap-1.5">
                <SectionLabel>UPCOMING</SectionLabel>
                <span
                  aria-hidden
                  className={`text-[10px] text-muted transition-transform ${upcomingOpen ? "rotate-180" : ""}`}
                >
                  ▾
                </span>
              </span>
              <span className="text-[11px] text-muted">
                {upcomingCount > 0
                  ? `${upcomingCount} session${upcomingCount === 1 ? "" : "s"} after this week${upcomingOpen ? "" : " — tap to show"}`
                  : "Nothing further out yet"}
              </span>
            </button>
            {upcomingOpen && (
              <>
                {upcoming.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[oklch(0.87_0.02_78)] bg-inputbg p-6 text-center text-[13px] text-muted">
                    Nothing booked beyond this week yet.
                  </div>
                )}
                {upcoming.map(weekDayCard)}
              </>
            )}
          </section>
        </div>

        <div className="flex w-full flex-none flex-col gap-5 lg:w-[300px]">
          {/* ---------- notifications ---------- */}
          <aside className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>NOTIFICATIONS</SectionLabel>
              {visibleNotifications.length > 0 && (
                <button
                  onClick={clearAllNotifications}
                  title="Clear all notifications"
                  className="cursor-pointer text-[12px] font-semibold text-faint hover:text-[oklch(0.55_0.15_25)]"
                >
                  Clear all ✕
                </button>
              )}
            </div>
            <Card className="px-4 py-1.5">
              {visibleNotifications.length === 0 && (
                <div className="py-5 text-center text-[13px] text-muted">
                  Nothing new ✓
                </div>
              )}
              {visibleNotifications.map((n, i) => (
                <div
                  key={`${n.kind}-${n.id}`}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3.5 ${
                    i < visibleNotifications.length - 1
                      ? "border-b border-hairline"
                      : ""
                  }`}
                >
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-semibold">
                        {n.name}
                      </span>
                      {n.isNew && (
                        <span className="h-[6px] w-[6px] flex-none rounded-full bg-[oklch(0.62_0.15_30)]" />
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {n.kind === "booked_online" ? (
                        <span className="text-sage-text">✓ {n.desc}</span>
                      ) : (
                        n.desc
                      )}
                    </div>
                  </div>
                  {n.kind === "enquiry" ? (
                    <button
                      onClick={() => router.push(`/enquiries?open=${n.id}`)}
                      className="flex-none cursor-pointer rounded-full bg-clay px-4 py-2 text-[12.5px] font-semibold text-cream hover:bg-clay-deep"
                    >
                      Book
                    </button>
                  ) : (
                    <div className="flex flex-none items-center gap-2.5">
                      {n.clientId && (
                        <Link
                          href={`/clients/${n.clientId}`}
                          className="text-[12.5px] font-semibold text-sage-text hover:text-sage"
                        >
                          Open client ›
                        </Link>
                      )}
                      <button
                        onClick={() => dismissNotification(n.id)}
                        title="Dismiss this notice"
                        className="cursor-pointer text-[12px] font-semibold text-faint hover:text-[oklch(0.55_0.15_25)]"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          </aside>

          {/* ---------- needs attention ---------- */}
          <aside className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>NEEDS ATTENTION</SectionLabel>
              {unpaidCount > 0 && (
                <button
                  onClick={scanForPayments}
                  disabled={scanning}
                  className="cursor-pointer rounded-full border border-clay/40 px-3 py-1 text-[12px] font-semibold text-clay-text hover:bg-clay-tint disabled:cursor-default disabled:opacity-60"
                >
                  {scanning ? "Scanning…" : "Scan bank"}
                </button>
              )}
            </div>
            <Card className="px-4 py-1.5">
              {visibleAttention.length === 0 && (
                <div className="py-5 text-center text-[13px] text-muted">
                  All clear ✓
                </div>
              )}
              {visibleAttention.map((a, i) => (
                <div
                  key={`${a.kind}-${a.id}`}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3.5 ${
                    i < visibleAttention.length - 1
                      ? "border-b border-hairline"
                      : ""
                  }`}
                >
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <div className="text-[13.5px] font-semibold">{a.name}</div>
                    <div className="mt-0.5 text-xs text-muted">{a.desc}</div>
                  </div>
                  {a.kind === "unpaid" ? (
                    (() => {
                      const reminded = a.reminded || remindedIds.has(a.id);
                      const busy = busyId === a.id;
                      return (
                        <div className="flex flex-none flex-wrap gap-2">
                          <button
                            disabled={busy}
                            onClick={() => markPaid(a)}
                            className="cursor-pointer rounded-full bg-clay px-4 py-2 text-[12.5px] font-semibold text-cream hover:bg-clay-deep disabled:cursor-default disabled:opacity-60"
                          >
                            {busy ? "Saving…" : "Mark paid"}
                          </button>
                          <button
                            disabled={reminded || busy}
                            onClick={() => remind(a)}
                            className="cursor-pointer rounded-full bg-clay-tint px-4 py-2 text-[12.5px] font-semibold text-clay-text disabled:cursor-default disabled:opacity-60"
                          >
                            {reminded ? "Reminded" : "Remind"}
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    <button
                      disabled={busyId === a.id}
                      onClick={async () => {
                        setBusyId(a.id);
                        try {
                          await api(`/api/clients/${a.id}/intake-email`, {
                            method: "POST",
                          });
                          toast(
                            `Intake form re-sent to ${a.name.split(" ")[0]} ✓`,
                          );
                        } catch (err) {
                          toast(
                            err instanceof Error
                              ? err.message
                              : "Couldn't send",
                          );
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="flex-none cursor-pointer rounded-full bg-clay-tint px-4 py-2 text-[12.5px] font-semibold text-clay-text disabled:cursor-default disabled:opacity-60"
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
    </div>
  );
}

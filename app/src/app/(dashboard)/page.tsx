import { prisma, getSettings } from "@/lib/db";
import {
  fmtDate,
  fmtDayLong,
  fmtTime,
  londonAddDays,
  londonDateKey,
  londonDayStart,
  londonWeekStart,
} from "@/lib/time";
import { sessionOrdinals } from "@/lib/sessionOrdinals";
import { findUnpaidSessions } from "@/lib/payments/unpaid";
import { HomeView, type AttentionItem, type TodayRow, type WeekDay, type WeekRow } from "@/components/HomeView";

export default async function HomePage() {
  const settings = await getSettings();
  const dayStart = londonDayStart(0);
  const dayEnd = londonDayStart(1);
  const weekStart = londonWeekStart();
  const weekEnd = londonAddDays(weekStart, 7);

  // One query covers the whole week; today is the slice inside it. This keeps the
  // dashboard to a single booking read even though it now shows both.
  const bookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: weekStart, lt: weekEnd } },
    include: { client: true },
    orderBy: { startsAt: "asc" },
  });

  const ordinals = await sessionOrdinals(bookings.map((b) => b.clientId));

  const todayBookings = bookings.filter((b) => b.startsAt >= dayStart && b.startsAt < dayEnd);
  const rows: TodayRow[] = todayBookings.map((b) => {
    const n = ordinals.get(b.id) ?? 1;
    return {
      id: b.id,
      clientId: b.clientId,
      time: fmtTime(b.startsAt),
      name: b.client.name,
      isNew: n === 1,
      sessionNumber: n,
      clinic: b.clinic,
      intakeDone: b.client.intakeDone,
    };
  });

  // The rest of the week: tomorrow through Sunday, grouped by day, so today's
  // sessions aren't repeated below the detailed cards.
  const todayKey = londonDateKey(dayStart);
  const weekAhead: WeekDay[] = Array.from({ length: 7 }, (_, i) => londonAddDays(weekStart, i))
    .filter((day) => londonDateKey(day) > todayKey)
    .map((day) => {
      const dateKey = londonDateKey(day);
      const dayRows: WeekRow[] = bookings
        .filter((b) => londonDateKey(b.startsAt) === dateKey)
        .map((b) => {
          const n = ordinals.get(b.id) ?? 1;
          return {
            id: b.id,
            clientId: b.clientId,
            time: fmtTime(b.startsAt),
            name: b.client.name,
            isNew: n === 1,
            sessionNumber: n,
            clinic: b.clinic,
          };
        });
      return { dateKey, label: fmtDayLong(day), rows: dayRows };
    })
    .filter((d) => d.rows.length > 0);

  const weekAheadCount = weekAhead.reduce((sum, d) => sum + d.rows.length, 0);

  const [waitingEnquiries, pendingIntake, unpaid] = await Promise.all([
    prisma.enquiry.findMany({ where: { status: "waiting" }, orderBy: { createdAt: "asc" }, take: 8 }),
    prisma.client.findMany({
      where: {
        intakeDone: false,
        bookings: { some: { status: "confirmed", startsAt: { gte: new Date() } } },
      },
      take: 8,
    }),
    findUnpaidSessions(),
  ]);

  const attention: AttentionItem[] = [
    ...waitingEnquiries.map((e) => ({
      kind: "enquiry" as const,
      id: e.id,
      name: e.name || "New enquiry",
      desc: e.text.slice(0, 60),
    })),
    ...unpaid.slice(0, 8).map((s) => ({
      kind: "unpaid" as const,
      id: s.bookingId,
      name: s.clientName,
      desc: `Unpaid — session ${s.whenLabel}`,
      reminded: s.paymentReminderSentAt != null,
    })),
    ...pendingIntake.map((c) => ({
      kind: "intake" as const,
      id: c.id,
      name: c.name,
      desc: "Intake form not yet completed",
    })),
  ];

  return (
    <HomeView
      dateLabel={fmtDayLong(dayStart)}
      todayCountLabel={rows.length ? `${rows.length} session${rows.length === 1 ? "" : "s"} today` : ""}
      rows={rows}
      weekAhead={weekAhead}
      weekCountLabel={
        weekAheadCount
          ? `${weekAheadCount} more · ${fmtDate(dayStart)} – ${fmtDate(londonAddDays(weekStart, 6))}`
          : ""
      }
      attention={attention}
      allSynced={!!settings.googleRefreshToken}
    />
  );
}

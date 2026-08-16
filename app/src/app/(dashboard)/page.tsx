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
import {
  HomeView,
  type AttentionItem,
  type NotificationItem,
  type TodayRow,
  type WeekDay,
  type WeekRow,
} from "@/components/HomeView";

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

  const todayBookings = bookings.filter(
    (b) => b.startsAt >= dayStart && b.startsAt < dayEnd,
  );
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
  const weekAhead: WeekDay[] = Array.from({ length: 7 }, (_, i) =>
    londonAddDays(weekStart, i),
  )
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

  // Everything beyond this week — collapsed by default on the page, so it's
  // there to check without permanently taking up room above the fold.
  const laterBookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: weekEnd } },
    include: { client: true },
    orderBy: { startsAt: "asc" },
    take: 300,
  });
  const laterOrdinals = await sessionOrdinals(
    laterBookings.map((b) => b.clientId),
  );
  const laterDateKeys = [
    ...new Set(laterBookings.map((b) => londonDateKey(b.startsAt))),
  ];
  const upcoming: WeekDay[] = laterDateKeys.map((dateKey) => {
    const dayRows: WeekRow[] = laterBookings
      .filter((b) => londonDateKey(b.startsAt) === dateKey)
      .map((b) => {
        const n = laterOrdinals.get(b.id) ?? 1;
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
    return {
      dateKey,
      label: fmtDayLong(
        laterBookings.find((b) => londonDateKey(b.startsAt) === dateKey)!
          .startsAt,
      ),
      rows: dayRows,
    };
  });

  const [waitingEnquiries, newBookings, pendingIntake, unpaid] =
    await Promise.all([
      // People looking for a time — a reply or a booking is still owed.
      prisma.enquiry.findMany({
        where: { status: "waiting" },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      // Clients who booked themselves — already done, just a heads-up.
      prisma.enquiry.findMany({
        where: { status: "booked_online" },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      prisma.client.findMany({
        where: {
          intakeDone: false,
          bookings: {
            some: { status: "confirmed", startsAt: { gte: new Date() } },
          },
        },
        take: 8,
      }),
      findUnpaidSessions(),
    ]);

  const viewedAt = settings.notificationsViewedAt ?? new Date(0);
  const notifications: NotificationItem[] = [
    ...waitingEnquiries.map((e) => ({
      kind: "enquiry" as const,
      id: e.id,
      name: e.name || "New enquiry",
      desc: e.text.slice(0, 60),
      isNew: e.createdAt > viewedAt,
    })),
    ...newBookings.map((e) => ({
      kind: "booked_online" as const,
      id: e.id,
      name: e.name || "New booking",
      desc: e.text,
      clientId: e.clientId,
      isNew: e.createdAt > viewedAt,
    })),
  ];
  const hasUnviewedNotifications = newBookings.some(
    (e) => e.createdAt > viewedAt,
  );

  // Ongoing chores — things that stay outstanding until Phoenix acts, rather
  // than a one-off arrival to glance at and clear.
  const attention: AttentionItem[] = [
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
      todayCountLabel={
        rows.length
          ? `${rows.length} session${rows.length === 1 ? "" : "s"} today`
          : ""
      }
      rows={rows}
      weekAhead={weekAhead}
      weekCountLabel={
        weekAheadCount
          ? `${weekAheadCount} more · ${fmtDate(dayStart)} – ${fmtDate(londonAddDays(weekStart, 6))}`
          : ""
      }
      upcoming={upcoming}
      upcomingCount={laterBookings.length}
      notifications={notifications}
      hasUnviewedNotifications={hasUnviewedNotifications}
      attention={attention}
      allSynced={!!settings.googleRefreshToken}
    />
  );
}

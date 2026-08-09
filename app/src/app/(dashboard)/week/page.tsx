import { prisma } from "@/lib/db";
import { fmtDate, fmtDayLong, fmtTime, londonAddDays, londonDateKey, londonWeekStart } from "@/lib/time";
import { WeekView, type WeekDay, type WeekRow } from "@/components/WeekView";

export default async function WeekPage() {
  const weekStart = londonWeekStart();
  const weekEnd = londonAddDays(weekStart, 7);

  const bookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: weekStart, lt: weekEnd } },
    include: { client: true },
    orderBy: { startsAt: "asc" },
  });

  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = londonAddDays(weekStart, i);
    const dateKey = londonDateKey(day);
    const rows: WeekRow[] = bookings
      .filter((b) => londonDateKey(b.startsAt) === dateKey)
      .map((b) => ({
        id: b.id,
        clientId: b.clientId,
        time: fmtTime(b.startsAt),
        name: b.client.name,
        isNew: !b.client.welcomeSent,
        clinic: b.clinic,
      }));
    return { dateKey, label: fmtDayLong(day), rows };
  });

  return (
    <WeekView
      rangeLabel={`${fmtDate(weekStart)} – ${fmtDate(londonAddDays(weekStart, 6))}`}
      countLabel={bookings.length ? `${bookings.length} session${bookings.length === 1 ? "" : "s"} this week` : ""}
      days={days}
    />
  );
}

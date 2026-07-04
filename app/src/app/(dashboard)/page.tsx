import { prisma, getSettings } from "@/lib/db";
import { fmtDayLong, fmtTime, londonDayStart } from "@/lib/time";
import { TodayView, type AttentionItem, type TodayRow } from "@/components/TodayView";

export default async function TodayPage() {
  const settings = await getSettings();
  const dayStart = londonDayStart(0);
  const dayEnd = londonDayStart(1);

  const bookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: dayStart, lt: dayEnd } },
    include: { client: true },
    orderBy: { startsAt: "asc" },
  });

  const rows: TodayRow[] = bookings.map((b) => ({
    id: b.id,
    clientId: b.clientId,
    time: fmtTime(b.startsAt),
    name: b.client.name,
    isNew: !b.client.welcomeSent,
    clinic: b.clinic,
    intakeDone: b.client.intakeDone,
  }));

  const [waitingEnquiries, pendingIntake] = await Promise.all([
    prisma.enquiry.findMany({ where: { status: "waiting" }, orderBy: { createdAt: "asc" }, take: 8 }),
    prisma.client.findMany({
      where: {
        intakeDone: false,
        bookings: { some: { status: "confirmed", startsAt: { gte: new Date() } } },
      },
      take: 8,
    }),
  ]);

  const attention: AttentionItem[] = [
    ...waitingEnquiries.map((e) => ({
      kind: "enquiry" as const,
      id: e.id,
      name: e.name || "New enquiry",
      desc: e.text.slice(0, 60),
    })),
    ...pendingIntake.map((c) => ({
      kind: "intake" as const,
      id: c.id,
      name: c.name,
      desc: "Intake form not yet completed",
    })),
  ];

  return (
    <TodayView
      dateLabel={fmtDayLong(dayStart)}
      countLabel={rows.length ? `${rows.length} session${rows.length === 1 ? "" : "s"} today` : ""}
      rows={rows}
      attention={attention}
      allSynced={!!settings.googleRefreshToken}
    />
  );
}

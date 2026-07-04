import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { ClientsList, type ClientRow } from "@/components/ClientsList";

export default async function ClientsPage() {
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: {
      bookings: { orderBy: { startsAt: "desc" }, take: 1 },
    },
  });

  const rows: ClientRow[] = await Promise.all(
    clients.map(async (c) => {
      const [last, next] = await Promise.all([
        prisma.booking.findFirst({ where: { clientId: c.id, startsAt: { lt: new Date() } }, orderBy: { startsAt: "desc" } }),
        prisma.booking.findFirst({
          where: { clientId: c.id, status: "confirmed", startsAt: { gte: new Date() } },
          orderBy: { startsAt: "asc" },
        }),
      ]);
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        clinic: c.clinic,
        marketing: c.marketing,
        last: last ? fmtDate(last.startsAt) : "—",
        next: next ? fmtDate(next.startsAt) : "Nothing booked",
      };
    }),
  );

  return <ClientsList rows={rows} />;
}

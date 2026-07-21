import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { ClientsList, type ClientRow } from "@/components/ClientsList";

export default async function ClientsPage() {
  const now = new Date();

  // Three queries total (was 1 + 2×clients): the roster, then the most recent
  // past booking and the soonest upcoming confirmed booking per client, each
  // aggregated in a single grouped query instead of one lookup per row.
  const [clients, lastByClient, nextByClient] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.booking.groupBy({
      by: ["clientId"],
      where: { startsAt: { lt: now } },
      _max: { startsAt: true },
    }),
    prisma.booking.groupBy({
      by: ["clientId"],
      where: { status: "confirmed", startsAt: { gte: now } },
      _min: { startsAt: true },
    }),
  ]);

  const lastFor = new Map(lastByClient.map((g) => [g.clientId, g._max.startsAt]));
  const nextFor = new Map(nextByClient.map((g) => [g.clientId, g._min.startsAt]));

  const rows: ClientRow[] = clients.map((c) => {
    const last = lastFor.get(c.id);
    const next = nextFor.get(c.id);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      clinic: c.clinic,
      marketing: c.marketing,
      last: last ? fmtDate(last) : "—",
      next: next ? fmtDate(next) : "Nothing booked",
    };
  });

  return <ClientsList rows={rows} />;
}

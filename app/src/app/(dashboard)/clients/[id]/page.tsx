import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDayLong, fmtTime } from "@/lib/time";
import { ClientProfile, type ProfileNote } from "@/components/ClientProfile";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: { notes: { orderBy: { date: "desc" } } },
  });
  if (!client) notFound();

  const nextBooking = await prisma.booking.findFirst({
    where: { clientId: id, status: "confirmed", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
  });

  const offer = await prisma.enquiry.findFirst({
    where: { clientId: id, status: "offered" },
    orderBy: { createdAt: "desc" },
    select: { id: true, offeredTimes: true },
  });
  const activeOffer =
    offer && offer.offeredTimes.length
      ? {
          id: offer.id,
          times: offer.offeredTimes
            .map((t) => ({ iso: t.toISOString(), label: `${fmtDayLong(t)} · ${fmtTime(t)}` })),
        }
      : null;

  const notes: ProfileNote[] = client.notes.map((n) => ({
    id: n.id,
    date: fmtDate(n.date),
    clinic: n.clinic,
    bullets: n.bullets,
    raw: n.raw,
  }));

  return (
    <ClientProfile
      client={{
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        clinic: client.clinic,
        marketing: client.marketing,
        intakeDone: client.intakeDone,
        dob: client.dob,
        occupation: client.occupation,
        doctor: client.doctor,
        meds: client.meds,
        conditions: client.conditions,
        emergency: client.emergency,
        referred: client.referred,
        docId: client.docId,
      }}
      notes={notes}
      nextSession={nextBooking ? `${fmtDayLong(nextBooking.startsAt)} · ${fmtTime(nextBooking.startsAt)}` : null}
      activeOffer={activeOffer}
    />
  );
}

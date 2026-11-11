import { notFound } from "next/navigation";
import { getSettings, prisma } from "@/lib/db";
import { fmtDate, fmtDayLong, fmtTime, londonDayStart } from "@/lib/time";
import { resolveIntakeQuestions } from "@/lib/intakeQuestions";
import { readIntakeAnswers, readLegacyIntakeReason } from "@/lib/intakeProfile";
import { DOC_MIME, getDriveFileText } from "@/lib/google/drive";
import { resolveClientCopy } from "@/lib/clientCopy";
import { ClientProfile, type ProfileNote, type ProfileRecording } from "@/components/ClientProfile";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      alternateEmails: { orderBy: { email: "asc" }, select: { email: true } },
      notes: { orderBy: { date: "desc" } },
      recordings: { orderBy: { date: "desc" } },
    },
  });
  if (!client) notFound();

  const settings = await getSettings();
  let intakeAnswers = readIntakeAnswers(client.intakeAnswers);
  if (!client.intakeSubmittedAt && client.intakeDone && client.docId) {
    const text = await getDriveFileText(client.docId, "", DOC_MIME).catch(() => null);
    if (text) intakeAnswers = readLegacyIntakeReason(text);
  }
  const today = new Date();
  const todayBookings = await prisma.booking.findMany({
    where: { status: "confirmed", startsAt: { gte: londonDayStart(0, today), lt: londonDayStart(1, today) } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { client: { select: { id: true, name: true } }, startsAt: true },
  });
  const queue = todayBookings.filter(({ client }, index) =>
    client && todayBookings.findIndex((booking) => booking.client?.id === client.id) === index,
  );
  const queueIndex = queue.findIndex((booking) => booking.client?.id === id);
  const neighbour = (offset: number) => {
    const booking = queueIndex < 0 ? undefined : queue[queueIndex + offset];
    return booking?.client ? { ...booking.client, time: fmtTime(booking.startsAt) } : null;
  };
  const { reflectionsDocId } = settings;
  const isWaterloo = client.clinic === "waterloo";
  const location = {
    address: isWaterloo ? settings.waterlooAddress : settings.bethnalAddress,
    url: isWaterloo ? settings.waterlooLocationUrl : settings.bethnalLocationUrl,
    directions: isWaterloo ? settings.waterlooDirections : settings.bethnalDirections,
  };

  // Every session still ahead of now, soonest first — a client can have several
  // booked at once (a course of sessions a week apart), so the profile lists them
  // all rather than surfacing only the nearest.
  const upcomingBookings = await prisma.booking.findMany({
    where: { clientId: id, status: "confirmed", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
  });

  // Every booking, for the payments panel. The client's own page computes its
  // numbers from exactly the same rows, so the two views can't disagree.
  const allBookings = await prisma.booking.findMany({
    where: { clientId: id },
    orderBy: { startsAt: "desc" },
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

  const recordings: ProfileRecording[] = client.recordings.map((r) => ({
    id: r.id,
    date: fmtDate(r.date),
    clinic: r.clinic,
    bullets: r.bullets,
    pinned: r.pinned,
    myNotes: r.myNotes,
    transcript: r.transcript,
  }));

  const intakeQuestions = resolveIntakeQuestions(settings.intakeQuestions).filter((q) => q.enabled);
  const clientCopy = resolveClientCopy(settings.clientCopy);

  return (
    <ClientProfile
      key={id}
      intakeAnswers={intakeAnswers}
      intakeSubmitted={client.intakeSubmittedAt ? fmtDate(client.intakeSubmittedAt) : null}
      firstSessionIntake={(client.firstSessionIntake ?? {}) as Record<string, string>}
      historyDocs={client.historyDocIds}
      alternateEmails={client.alternateEmails.map(({ email }) => email)}
      previousClient={neighbour(-1)}
      nextClient={neighbour(1)}
      intakeQuestions={intakeQuestions}
      clientCopy={clientCopy}
      client={{
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        clinic: client.clinic,
        marketing: client.marketing,
        intakeDone: client.intakeDone,
        intakeEmailSentAt: client.intakeEmailSentAt ? fmtDate(client.intakeEmailSentAt) : null,
        reviewEmailSentAt: client.reviewEmailSentAt ? fmtDate(client.reviewEmailSentAt) : null,
        consentGiven: client.consentGiven,
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
      recordings={recordings}
      upcomingSessions={upcomingBookings.map((b) => ({
        id: b.id,
        label: `${fmtDayLong(b.startsAt)} · ${fmtTime(b.startsAt)}`,
        clinic: b.clinic,
      }))}
      activeOffer={activeOffer}
      reflectionsDocId={reflectionsDocId || null}
      location={location}
      paymentRef={client.paymentRef}
      accountBookings={allBookings.map((b) => ({
        id: b.id,
        startsAtISO: b.startsAt.toISOString(),
        clinic: b.clinic,
        status: b.status,
        paid: b.paid,
        amountPence: b.amountPence,
        goodwillPence: b.goodwillPence,
        goodwillReason: b.goodwillReason,
        goodwillSettled: b.goodwillSettled,
        goodwillWaived: b.goodwillWaived,
      }))}
    />
  );
}

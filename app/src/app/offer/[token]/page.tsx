import { prisma, getSettings, getSpaces } from "@/lib/db";
import { spaceName } from "@/lib/spaces";
import { ToastProvider } from "@/components/ui";
import { OfferPickFlow } from "@/components/OfferPickFlow";
import { resolveClientCopy } from "@/lib/clientCopy";
import { practitionerIdentity } from "@/lib/practitioner";

export const dynamic = "force-dynamic";

function ExpiredCard() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
      <div className="font-serif text-2xl font-medium">This link has expired</div>
      <p className="text-[14px] text-muted">Please get in touch with Phoenix directly for a fresh link. Thank you!</p>
    </div>
  );
}

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const enquiry = token
    ? await prisma.enquiry.findFirst({
        where: { offerToken: token },
        select: { status: true, clientId: true, offeredTimes: true, clinic: true },
      })
    : null;

  if (!enquiry) return <ExpiredCard />;

  if (enquiry.status === "booked") {
    return (
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="font-serif text-2xl font-medium">You&apos;re already booked in</div>
        <p className="text-[14px] text-muted">Looks like this is already sorted — see you soon!</p>
      </div>
    );
  }

  if (enquiry.status !== "offered" || !enquiry.clientId || !enquiry.offeredTimes.length) {
    return <ExpiredCard />;
  }

  const client = await prisma.client.findUnique({ where: { id: enquiry.clientId } });
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));

  return (
    <ToastProvider>
      <OfferPickFlow
        token={token}
        clientName={client?.name ?? ""}
        clientEmail={client?.email ?? ""}
        clinicName={spaceName(await getSpaces(), enquiry.clinic)}
        offeredTimes={enquiry.offeredTimes.map((t) => t.toISOString())}
        copy={copy}
      />
    </ToastProvider>
  );
}

import { prisma } from "@/lib/db";
import { EnquiryFlow } from "@/components/EnquiryFlow";

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; client?: string }>;
}) {
  const { open, client: clientId } = await searchParams;

  const existingClient = clientId
    ? await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, clinic: true, email: true, welcomeSent: true },
      })
    : null;

  const waiting = await prisma.enquiry.findMany({
    where: { status: "waiting" },
    orderBy: { createdAt: "desc" },
    select: { id: true, via: true, name: true, text: true, clientId: true, createdAt: true },
  });

  return (
    <EnquiryFlow
      openEnquiryId={open}
      existingClient={existingClient ?? undefined}
      initialWaiting={waiting.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() }))}
    />
  );
}

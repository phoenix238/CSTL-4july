import { prisma } from "@/lib/db";
import { EnquiryFlow } from "@/components/EnquiryFlow";

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    open?: string;
    client?: string;
    pick?: string;
  }>;
}) {
  const { open, client: clientId, pick } = await searchParams;

  const existingClient = clientId
    ? await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, clinic: true, email: true, welcomeSent: true },
      })
    : null;

  const waiting = await prisma.enquiry.findMany({
    where: { status: { in: ["waiting", "offered"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      via: true,
      name: true,
      text: true,
      status: true,
      clientId: true,
      offeredTimes: true,
      createdAt: true,
    },
  });

  return (
    <EnquiryFlow
      openEnquiryId={open}
      existingClient={existingClient ?? undefined}
      initialPick={pick}
      initialWaiting={waiting.map((w) => ({
        ...w,
        offeredTimes: w.offeredTimes.map((t) => t.toISOString()),
        createdAt: w.createdAt.toISOString(),
      }))}
    />
  );
}

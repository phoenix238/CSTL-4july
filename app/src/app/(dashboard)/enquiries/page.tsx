import { prisma } from "@/lib/db";
import { EnquiryFlow } from "@/components/EnquiryFlow";

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    open?: string;
    client?: string;
    text?: string;
    title?: string;
    url?: string;
    pick?: string;
  }>;
}) {
  const { open, client: clientId, text, title, url, pick } = await searchParams;
  const initialText = [title, text, url].filter(Boolean).join("\n") || undefined;

  const existingClient = clientId
    ? await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, clinic: true, email: true, phone: true, welcomeSent: true },
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
      initialText={initialText}
      initialPick={pick}
      initialWaiting={waiting.map((w) => ({
        ...w,
        offeredTimes: w.offeredTimes.map((t) => t.toISOString()),
        createdAt: w.createdAt.toISOString(),
      }))}
    />
  );
}

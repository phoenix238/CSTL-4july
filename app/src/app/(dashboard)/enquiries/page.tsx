import { prisma } from "@/lib/db";
import { EnquiryFlow } from "@/components/EnquiryFlow";

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; client?: string }>;
}) {
  const { open, client: clientId } = await searchParams;

  const existingClient = clientId
    ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, clinic: true } })
    : null;

  return <EnquiryFlow openEnquiryId={open} existingClient={existingClient ?? undefined} />;
}

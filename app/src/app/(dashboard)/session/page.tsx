import { prisma } from "@/lib/db";
import { SessionView, type SessionClient } from "@/components/SessionView";

export default async function SessionPage() {
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, clinic: true },
  });

  return <SessionView clients={clients as SessionClient[]} />;
}

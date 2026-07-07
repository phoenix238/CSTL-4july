import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createClientWithDrive } from "@/lib/clients";

/** Add a client by hand from the clients list — e.g. someone booked outside the usual enquiry flow. */
export const POST = guarded(async (req: Request) => {
  const { name, email, phone, clinic } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const client = await createClientWithDrive({ name, email, phone, clinic });
  revalidatePath("/clients");
  return NextResponse.json(client);
});

/**
 * Client search — powers the global search, quick-book and Drive matching.
 * No `query` → the full client list (for pick-from-a-list dropdowns), capped generously.
 */
export const GET = guarded(async (req: Request) => {
  const query = (new URL(req.url).searchParams.get("query") ?? "").trim();
  const clients = await prisma.client.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: { id: true, name: true, clinic: true, email: true, welcomeSent: true },
    orderBy: { name: "asc" },
    take: query ? 8 : 500,
  });
  return NextResponse.json({ clients });
});

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

/** Quick client search — powers the global search, quick-book and Drive matching. */
export const GET = guarded(async (req: Request) => {
  const query = (new URL(req.url).searchParams.get("query") ?? "").trim();
  if (!query) return NextResponse.json({ clients: [] });
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, clinic: true, email: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return NextResponse.json({ clients });
});

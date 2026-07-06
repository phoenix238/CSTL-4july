import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

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

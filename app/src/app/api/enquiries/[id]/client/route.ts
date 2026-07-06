import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createClientWithDrive, findExistingClient } from "@/lib/clients";

/**
 * Save an enquiry as a client right away — no booking needed. Dedupe-first:
 * an existing record is linked instead of creating a duplicate.
 * Body: { name, email?, phone?, clinic? }
 */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { name, email, phone, clinic } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "A name is needed first" }, { status: 400 });

  const existing = await findExistingClient(name, email || undefined, phone || undefined);
  const client = existing ?? (await createClientWithDrive({ name, email, phone, clinic }));

  await prisma.enquiry.update({ where: { id }, data: { clientId: client.id, name: client.name } });
  return NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      clinic: client.clinic,
      email: client.email,
      phone: client.phone,
      welcomeSent: client.welcomeSent,
    },
    existed: !!existing,
  });
});

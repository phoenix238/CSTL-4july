import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { isValidEmail } from "@/lib/validate";

type Context = { params: Promise<{ id: string }> };

export const POST = guarded(async (req: Request, { params }: Context) => {
  const { id } = await params;
  const body = await req.json();
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email) || email.length > 254) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const primary = await prisma.client.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (primary.some((client) => client.id !== id)) {
    return NextResponse.json({ error: "That email is the main address on a different client record." }, { status: 409 });
  }
  if (primary.length) {
    return NextResponse.json({ error: "That is already this client’s main email address." }, { status: 400 });
  }

  await prisma.clientEmailAlias.createMany({
    data: [{ email, clientId: id }],
    skipDuplicates: true,
  });
  const alias = await prisma.clientEmailAlias.findUnique({ where: { email } });
  if (alias?.clientId !== id) {
    return NextResponse.json({ error: "That email is already linked to a different client." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = guarded(async (req: Request, { params }: Context) => {
  const { id } = await params;
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
  await prisma.clientEmailAlias.deleteMany({ where: { email, clientId: id } });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

export const POST = guarded(async (req: Request) => {
  const input = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(await req.json());
  if (!input.success) return NextResponse.json({ error: "Enter a note of up to 4,000 characters." }, { status: 400 });
  await prisma.improvementNote.create({ data: input.data });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const PATCH = guarded(async (req: Request) => {
  const input = z.object({ id: z.string().cuid(), done: z.boolean() }).safeParse(await req.json());
  if (!input.success) return NextResponse.json({ error: "Choose a note and status." }, { status: 400 });
  const result = await prisma.improvementNote.updateMany({
    where: { id: input.data.id },
    data: { doneAt: input.data.done ? new Date() : null },
  });
  if (!result.count) return NextResponse.json({ error: "That note could not be found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { appendReflectionToDoc, ensureReflectionsDoc } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

export interface ReflectionRow {
  id: string;
  dateISO: string;
  clientId: string | null;
  clientName: string;
  text: string;
}

const PAGE = 50;

/**
 * Phoenix's reflections, newest first — the Personal tab reads this.
 * `client=<id>` narrows to one person, `client=none` to the ones about nobody.
 */
export const GET = guarded(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const client = params.get("client") ?? "";
  const before = params.get("before"); // ISO date cursor, for "load older"

  const rows = await prisma.reflection.findMany({
    where: {
      ...(client === "none" ? { clientId: null } : client ? { clientId: client } : {}),
      ...(before ? { date: { lt: new Date(before) } } : {}),
    },
    orderBy: { date: "desc" },
    take: PAGE + 1,
  });

  const page = rows.slice(0, PAGE);
  return NextResponse.json({
    reflections: page.map(
      (r): ReflectionRow => ({
        id: r.id,
        dateISO: r.date.toISOString(),
        clientId: r.clientId,
        clientName: r.clientName,
        text: r.text,
      }),
    ),
    more: rows.length > PAGE,
  });
});

/**
 * Write one. A client is optional — the whole point of the tab is that a
 * reflection doesn't have to be attached to anybody.
 *
 * Saved here first, then appended to the reflections Doc in Drive. Drive
 * failing shouldn't lose the writing, so it's reported, not thrown.
 */
export const POST = guarded(async (req: Request) => {
  const { text, clientId } = (await req.json()) as { text?: string; clientId?: string | null };
  const body = (text ?? "").trim();
  if (!body) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const client = clientId
    ? await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } })
    : null;

  const reflection = await prisma.reflection.create({
    data: { text: body, clientId: client?.id ?? null, clientName: client?.name ?? "" },
  });

  let docError = "";
  try {
    const docId = await ensureReflectionsDoc();
    await appendReflectionToDoc(docId, {
      date: fmtDate(reflection.date),
      client: client?.name ?? "",
      text: body,
    });
  } catch (err) {
    docError = err instanceof Error ? err.message : "couldn't reach Drive";
    console.error("reflection Doc append failed", err);
  }

  return NextResponse.json({
    reflection: {
      id: reflection.id,
      dateISO: reflection.date.toISOString(),
      clientId: reflection.clientId,
      clientName: reflection.clientName,
      text: reflection.text,
    } satisfies ReflectionRow,
    docError,
  });
});

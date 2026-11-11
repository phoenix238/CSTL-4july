import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseDriveDocLink } from "@/lib/driveLink";
import { DOC_MIME, getDriveFileMeta, getDriveFileText } from "@/lib/google/drive";

type Context = { params: Promise<{ id: string }> };

export const GET = guarded(async (req: Request, { params }: Context) => {
  const { id } = await params;
  const docId = new URL(req.url).searchParams.get("doc");
  const client = await prisma.client.findUniqueOrThrow({
    where: { id },
    select: { docId: true, historyDocIds: true },
  });
  if (!docId || (docId !== client.docId && !client.historyDocIds.includes(docId))) {
    return NextResponse.json({ error: "This document is not linked to this client." }, { status: 404 });
  }
  const meta = await getDriveFileMeta(docId);
  if (!meta || meta.trashed || meta.mimeType !== DOC_MIME) {
    return NextResponse.json({ error: "The linked Google Doc is unavailable." }, { status: 404 });
  }
  const text = await getDriveFileText(docId, meta.name, DOC_MIME);
  if (text === null) {
    return NextResponse.json({ error: "The document is empty or could not be read." }, { status: 422 });
  }
  return NextResponse.json({ name: meta.name, text, modifiedTime: meta.modifiedTime }, {
    headers: { "Cache-Control": "no-store" },
  });
});

export const POST = guarded(async (req: Request, { params }: Context) => {
  const { id } = await params;
  const body = await req.json();
  const docId = typeof body?.doc === "string" && parseDriveDocLink(body.doc);
  if (!docId) return NextResponse.json({ error: "Enter a Google Docs link." }, { status: 400 });
  const meta = await getDriveFileMeta(docId);
  if (!meta || meta.trashed || meta.mimeType !== DOC_MIME) {
    return NextResponse.json({ error: "This Google Doc could not be opened." }, { status: 400 });
  }

  const otherClient = await prisma.client.findFirst({
    where: { id: { not: id }, OR: [{ docId }, { historyDocIds: { has: docId } }] },
    select: { id: true },
  });
  if (otherClient) {
    return NextResponse.json({ error: "That document is already linked to a different client." }, { status: 409 });
  }

  const result = await prisma.client.updateMany({
    where: { id, NOT: [{ docId }, { historyDocIds: { has: docId } }] },
    data: { historyDocIds: { push: docId } },
  });
  return NextResponse.json({ linked: result.count > 0 });
});

export const DELETE = guarded(async (req: Request, { params }: Context) => {
  const { id } = await params;
  const docId = new URL(req.url).searchParams.get("doc");
  if (!docId) return NextResponse.json({ error: "Choose a document to unlink." }, { status: 400 });
  await prisma.$executeRaw`UPDATE "Client"
    SET "historyDocIds" = array_remove("historyDocIds", ${docId}), "updatedAt" = NOW()
    WHERE "id" = ${id} AND ${docId} = ANY("historyDocIds")`;
  return NextResponse.json({ ok: true });
});

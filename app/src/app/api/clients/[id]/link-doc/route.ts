import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseDriveDocLink } from "@/lib/driveLink";
import { DOC_MIME, getDriveFileMeta, getDriveFileText } from "@/lib/google/drive";
import { extractClientsFromFile, summariseNote, type ImportedClient } from "@/lib/claude";

export const maxDuration = 60;

/** Cap on how much of a linked Doc we keep in the app's cached copy of the history. */
const MAX_HISTORY_CHARS = 20_000;

/** Blank-only fields the Doc can fill in, with the label shown back to Phoenix. */
type FillableKey =
  | "email"
  | "phone"
  | "dob"
  | "occupation"
  | "doctor"
  | "meds"
  | "conditions"
  | "emergency"
  | "referred";

const FILLABLE: Array<[FillableKey, string]> = [
  ["email", "email"],
  ["phone", "phone"],
  ["dob", "date of birth"],
  ["occupation", "occupation"],
  ["doctor", "doctor"],
  ["meds", "medications"],
  ["conditions", "health conditions"],
  ["emergency", "emergency contact"],
  ["referred", "referred by"],
];

/**
 * Is this client's Doc link still good? Answers the "it was linked and now it
 * isn't" question: whether a Doc is on file at all, and whether it's still
 * really in Drive (not deleted, not in the bin, not on someone else's account).
 */
export const GET = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const client = await prisma.client.findUniqueOrThrow({ where: { id }, select: { docId: true } });
  if (!client.docId) return NextResponse.json({ linked: false, ok: false, docId: "", name: "" });

  const meta = await getDriveFileMeta(client.docId);
  return NextResponse.json({
    linked: true,
    ok: !!meta && !meta.trashed,
    docId: client.docId,
    name: meta?.name ?? "",
    trashed: meta?.trashed ?? false,
  });
});

/**
 * Link an existing Google Doc to this client — nothing is copied or moved, the
 * Doc stays exactly where it is and simply becomes this client's record, so
 * every future session note appends to it.
 *
 * With `importHistory`, the Doc is also read once: anything the profile is
 * still missing gets filled in (never overwritten), and the case history is
 * cached in the app as a note so it's visible here, not just in Drive.
 *
 * Body: { doc: string (link or id), importHistory?: boolean }
 */
export const POST = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { doc, importHistory = true } = (await req.json()) as { doc?: string; importHistory?: boolean };

  const docId = parseDriveDocLink(doc ?? "");
  if (!docId) {
    return NextResponse.json({ error: "That doesn't look like a Google Doc link" }, { status: 400 });
  }

  const meta = await getDriveFileMeta(docId);
  if (!meta || meta.trashed) {
    return NextResponse.json(
      { error: "Couldn't open that Doc — check the link, and that it isn't in the bin." },
      { status: 400 },
    );
  }
  if (meta.mimeType !== DOC_MIME) {
    return NextResponse.json(
      { error: `"${meta.name}" isn't a Google Doc — pick the Doc itself, not a folder or a PDF.` },
      { status: 400 },
    );
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id } });
  await prisma.client.update({ where: { id }, data: { docId } });

  // Reading the Doc is a bonus, never a reason to fail the link — if Drive or
  // Claude has a bad moment the Doc is still linked and can be re-imported.
  const filled: string[] = [];
  let importedHistory = false;
  let importNote = "";

  if (importHistory) {
    try {
      const text = await getDriveFileText(docId, meta.name, meta.mimeType);
      if (!text?.trim()) {
        importNote = "the Doc looks empty, so there was nothing to bring in";
      } else {
        const record = await pickRecord(meta.name, text, client.name);

        if (record) {
          const data: Record<string, string> = {};
          for (const [key, label] of FILLABLE) {
            const value = record[key];
            if (typeof value === "string" && value.trim() && !(client[key] as string)?.trim()) {
              data[key] = value.trim();
              filled.push(label);
            }
          }
          if (Object.keys(data).length) await prisma.client.update({ where: { id }, data });
        }

        const history = (record?.notes?.trim() || text.trim()).slice(0, MAX_HISTORY_CHARS);
        const raw = `Imported from the linked Google Doc "${meta.name}".\n\n${history}`;
        // Re-linking the same, unchanged Doc shouldn't stack up duplicate copies.
        const already = await prisma.sessionNote.findFirst({ where: { clientId: id, raw } });
        if (already) {
          importNote = "that history was already in the profile";
        } else {
          const bullets = await summariseNote(history.slice(0, 12_000)).catch(() =>
            history
              .split(/\n+/)
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(0, 6),
          );
          await prisma.sessionNote.create({
            data: {
              clientId: id,
              date: meta.modifiedTime ? new Date(meta.modifiedTime) : new Date(),
              clinic: client.clinic,
              raw,
              bullets,
            },
          });
          importedHistory = true;
        }
      }
    } catch (err) {
      console.error(err);
      importNote = "couldn't read the Doc's contents just now — the link is saved, try importing again";
    }
  }

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");

  return NextResponse.json({
    docId,
    name: meta.name,
    url: `https://docs.google.com/document/d/${docId}/edit`,
    filled,
    importedHistory,
    importNote,
  });
});

/** The record in the Doc that's actually this client (a Doc may mention more than one). */
async function pickRecord(
  filename: string,
  text: string,
  clientName: string,
): Promise<ImportedClient | null> {
  const records = await extractClientsFromFile(filename, text);
  if (!records.length) return null;
  const wanted = clientName.trim().toLowerCase();
  const match = records.find((r) => {
    const name = r.name.trim().toLowerCase();
    return name && wanted && (name.includes(wanted) || wanted.includes(name));
  });
  return match ?? records[0];
}

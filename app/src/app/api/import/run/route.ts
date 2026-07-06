import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createClientWithDrive } from "@/lib/clients";
import {
  ensureClientFolderAndDoc,
  appendFormattedSections,
  uploadOriginalFile,
  copyDriveFileTo,
} from "@/lib/google/drive";
import { upsertMarketingRow } from "@/lib/google/sheets";
import { fmtDate } from "@/lib/time";

export const maxDuration = 60;

interface PlanEntry {
  file: string;
  mergeWithId: string | null;
  /** the file already lives in Drive — copy it instead of uploading (original stays put) */
  driveFileId?: string;
  /** unreadable file matched to a client by hand — just store it, change no records */
  storeOnly?: boolean;
  client?: {
    name: string;
    email: string;
    phone: string;
    dob: string;
    occupation: string;
    doctor: string;
    meds: string;
    conditions: string;
    emergency: string;
    referred: string;
    marketing: boolean;
    notes: string;
  };
}

export const POST = guarded(async (req: Request) => {
  const form = await req.formData();
  const plan: PlanEntry[] = JSON.parse(form.get("plan") as string);
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const fileByName = new Map(files.map((f) => [f.name, f]));

  let created = 0;
  let merged = 0;
  let stored = 0;

  const storeOriginal = async (entry: PlanEntry, folderId: string) => {
    if (entry.driveFileId) {
      await copyDriveFileTo(entry.driveFileId, folderId);
      return true;
    }
    const original = fileByName.get(entry.file);
    if (original) {
      const buffer = Buffer.from(await original.arrayBuffer());
      await uploadOriginalFile(folderId, original.name, original.type || "application/octet-stream", buffer);
      return true;
    }
    return false;
  };

  for (const entry of plan) {
    if (entry.storeOnly) {
      if (!entry.mergeWithId) continue; // needs a matched client
      const { folderId } = await ensureClientFolderAndDoc(entry.mergeWithId);
      if (await storeOriginal(entry, folderId)) stored++;
      continue;
    }
    if (!entry.client) continue;

    let clientId = entry.mergeWithId;
    if (clientId) {
      merged++;
      // Merging into an existing client: fill in anything they're still missing,
      // but never overwrite details already on file.
      const existing = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
      const fillBlank = (existingVal: string, imported: string) => existingVal || imported;
      await prisma.client.update({
        where: { id: clientId },
        data: {
          dob: fillBlank(existing.dob, entry.client.dob),
          occupation: fillBlank(existing.occupation, entry.client.occupation),
          doctor: fillBlank(existing.doctor, entry.client.doctor),
          meds: fillBlank(existing.meds, entry.client.meds),
          conditions: fillBlank(existing.conditions, entry.client.conditions),
          emergency: fillBlank(existing.emergency, entry.client.emergency),
          referred: fillBlank(existing.referred, entry.client.referred),
        },
      });
    } else {
      const client = await createClientWithDrive({
        name: entry.client.name,
        email: entry.client.email,
        phone: entry.client.phone,
        marketing: entry.client.marketing,
      });
      clientId = client.id;
      await prisma.client.update({
        where: { id: clientId },
        data: {
          dob: entry.client.dob,
          occupation: entry.client.occupation,
          doctor: entry.client.doctor,
          meds: entry.client.meds,
          conditions: entry.client.conditions,
          emergency: entry.client.emergency,
          referred: entry.client.referred,
        },
      });
      created++;
    }

    await upsertMarketingRow(entry.client.name, entry.client.email, entry.client.marketing);
    const { folderId, docId } = await ensureClientFolderAndDoc(clientId);

    if (entry.client.notes?.trim()) {
      await appendFormattedSections(docId, null, [
        {
          heading: `Imported case history — from ${entry.file}, ${fmtDate(new Date())}`,
          lines: [{ kind: "paragraph", value: entry.client.notes }],
        },
      ]);
      // A case history came in with this import — treat intake as covered.
      await prisma.client.update({ where: { id: clientId }, data: { intakeDone: true } });
    }
    await storeOriginal(entry, folderId);
  }

  return NextResponse.json({ created, merged, stored });
});

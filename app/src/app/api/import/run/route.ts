import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";
import { createClientWithDrive } from "@/lib/clients";
import { ensureClientFolderAndDoc, appendTextToDoc, uploadOriginalFile } from "@/lib/google/drive";
import { upsertMarketingRow } from "@/lib/google/sheets";

interface PlanEntry {
  file: string;
  mergeWithId: string | null;
  client: {
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

  for (const entry of plan) {
    let clientId = entry.mergeWithId;
    if (clientId) {
      merged++;
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
      await appendTextToDoc(docId, `Imported note (from ${entry.file}):\n${entry.client.notes}`);
    }
    const original = fileByName.get(entry.file);
    if (original) {
      const buffer = Buffer.from(await original.arrayBuffer());
      await uploadOriginalFile(folderId, original.name, original.type || "application/octet-stream", buffer);
    }
  }

  return NextResponse.json({ created, merged });
});

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { guarded } from "@/lib/api";
import { deleteClient, updateClientDetails } from "@/lib/clients";
import { ensureClientFolderAndDoc, appendFormattedSections, type DocSection } from "@/lib/google/drive";
import { fmtDate } from "@/lib/time";

export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { syncToDoc, ...data } = await req.json();
  const client = await updateClientDetails(id, data);
  revalidatePath("/clients");

  // The "FROM THE INTAKE FORM" editor on the profile is also how details get
  // corrected/filled in by hand — mirror that into the Doc, same as a real
  // intake-form submission would, so the Doc stays the record of what's known.
  if (syncToDoc) {
    const { docId } = await ensureClientFolderAndDoc(id);
    const sections: DocSection[] = [
      {
        heading: `Details updated — ${fmtDate(new Date())}`,
        lines: [
          { kind: "field", label: "Full name", value: client.name },
          { kind: "field", label: "Email", value: client.email },
          { kind: "field", label: "Phone", value: client.phone },
          { kind: "field", label: "Date of birth", value: client.dob },
          { kind: "field", label: "Occupation", value: client.occupation },
          { kind: "field", label: "Doctor", value: client.doctor },
          { kind: "paragraph", label: "Medications", value: client.meds },
          { kind: "paragraph", label: "Health conditions", value: client.conditions },
          { kind: "field", label: "Emergency contact", value: client.emergency },
          { kind: "field", label: "Referred by", value: client.referred },
        ],
      },
    ];
    await appendFormattedSections(docId, null, sections);
  }

  return NextResponse.json(client);
});

/** Delete a client: cancels any upcoming bookings' Google events, then removes the record. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await deleteClient(id);
  revalidatePath("/clients");
  return NextResponse.json({ ok: true });
});

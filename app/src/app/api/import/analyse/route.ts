import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { extractClientsFromFile } from "@/lib/claude";
import { findExistingClient } from "@/lib/clients";

const TEXT_TYPES = [".txt", ".csv", ".md"];

export const POST = guarded(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  const proposals: Array<{
    file: string;
    client: Awaited<ReturnType<typeof extractClientsFromFile>>[number];
    mergeWithId: string | null;
    mergeWithName: string | null;
    found: string;
  }> = [];
  const unreadable: string[] = [];

  for (const file of files) {
    const isText = TEXT_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!isText) {
      unreadable.push(file.name);
      continue;
    }
    const content = await file.text();
    const clients = await extractClientsFromFile(file.name, content);
    for (const client of clients) {
      const existing = await findExistingClient(client.name, client.email, client.phone);
      proposals.push({
        file: file.name,
        client,
        mergeWithId: existing?.id ?? null,
        mergeWithName: existing?.name ?? null,
        found: existing ? "matches an existing client" : "new client",
      });
    }
  }

  return NextResponse.json({ proposals, unreadable });
});

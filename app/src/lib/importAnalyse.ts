// Shared per-file import analysis — used by both the upload route and the
// Google Drive route so proposals look identical in the review UI.

import { extractClientsFromFile, type ImportedClient } from "@/lib/claude";
import { findExistingClient } from "@/lib/clients";

export interface ImportProposal {
  file: string;
  driveFileId?: string;
  client: ImportedClient;
  mergeWithId: string | null;
  mergeWithName: string | null;
  found: string;
}

export interface UnreadableFile {
  name: string;
  driveFileId?: string;
}

/** AI-extract client records from one file's text and dedupe each against the DB. */
export async function analyseFileText(
  filename: string,
  content: string,
  driveFileId?: string,
): Promise<ImportProposal[]> {
  const clients = await extractClientsFromFile(filename, content);
  const proposals: ImportProposal[] = [];
  for (const client of clients) {
    const existing = await findExistingClient(client.name, client.email, client.phone);
    proposals.push({
      file: filename,
      driveFileId,
      client,
      mergeWithId: existing?.id ?? null,
      mergeWithName: existing?.name ?? null,
      found: existing ? "matches an existing client" : "new client",
    });
  }
  return proposals;
}

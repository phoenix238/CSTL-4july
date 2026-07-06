import type { docs_v1 } from "googleapis";
import { prisma, getSettings } from "@/lib/db";
import { getDriveApi, getDocsApi } from "./client";

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function findChild(parentId: string, name: string, mimeType?: string) {
  const drive = await getDriveApi();
  const escaped = name.replace(/'/g, "\\'");
  const mimeClause = mimeType ? ` and mimeType = '${mimeType}'` : "";
  const parentClause = parentId === "root" ? "'root' in parents" : `'${parentId}' in parents`;
  const res = await drive.files.list({
    q: `name = '${escaped}' and ${parentClause} and trashed = false${mimeClause}`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

async function ensureFolder(parentId: string, name: string): Promise<string> {
  const existing = await findChild(parentId, name, FOLDER_MIME);
  if (existing) return existing;
  const drive = await getDriveApi();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: parentId === "root" ? undefined : [parentId],
    },
    fields: "id",
  });
  return res.data.id!;
}

/** Drive › CSTL › Clients — created once, cached in settings. */
export async function ensureClientsFolder(): Promise<string> {
  const settings = await getSettings();
  if (settings.clientsFolderId) return settings.clientsFolderId;
  const cstl = await ensureFolder("root", "CSTL");
  const clients = await ensureFolder(cstl, "Clients");
  await prisma.appSettings.update({ where: { id: 1 }, data: { clientsFolderId: clients } });
  return clients;
}

/**
 * Every client gets one folder + one Doc: Drive › CSTL › Clients › (client name).
 * Idempotent — returns existing ids if already created.
 */
export async function ensureClientFolderAndDoc(clientId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.driveFolderId && client.docId) {
    return { folderId: client.driveFolderId, docId: client.docId };
  }
  const clientsFolder = await ensureClientsFolder();
  const folderId = client.driveFolderId || (await ensureFolder(clientsFolder, client.name));

  let docId = client.docId;
  if (!docId) {
    docId = (await findChild(folderId, client.name, "application/vnd.google-apps.document")) ?? "";
    if (!docId) {
      const drive = await getDriveApi();
      const res = await drive.files.create({
        requestBody: {
          name: client.name,
          mimeType: "application/vnd.google-apps.document",
          parents: [folderId],
        },
        fields: "id",
      });
      docId = res.data.id!;
      const docs = await getDocsApi();
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: `${client.name} — CSTL client record\nCreated ${new Date().toLocaleDateString("en-GB")}\n\n`,
              },
            },
          ],
        },
      });
    }
  }
  await prisma.client.update({ where: { id: clientId }, data: { driveFolderId: folderId, docId } });
  return { folderId, docId };
}

/** Rename the client's folder + Doc when the client's name changes. */
export async function renameClientDrive(clientId: string, newName: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const drive = await getDriveApi();
  if (client.driveFolderId) {
    await drive.files.update({ fileId: client.driveFolderId, requestBody: { name: newName } });
  }
  if (client.docId) {
    await drive.files.update({ fileId: client.docId, requestBody: { name: newName } });
  }
}

/** Upload an original imported file into the client's folder, unchanged. */
export async function uploadOriginalFile(
  folderId: string,
  filename: string,
  mimeType: string,
  content: Buffer,
) {
  const drive = await getDriveApi();
  const { Readable } = await import("node:stream");
  await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(content) },
    fields: "id",
  });
}

/* ---------- browsing & importing the user's existing Drive files ---------- */

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

/** List folders under a parent (or search all folders by name when `query` is set). */
export async function listDriveFolders(parentId = "root", query?: string): Promise<DriveEntry[]> {
  const drive = await getDriveApi();
  const clauses = [`mimeType = '${FOLDER_MIME}'`, "trashed = false"];
  if (query?.trim()) clauses.push(`name contains '${query.trim().replace(/'/g, "\\'")}'`);
  else clauses.push(parentId === "root" ? "'root' in parents" : `'${parentId}' in parents`);
  const res = await drive.files.list({
    q: clauses.join(" and "),
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "name",
    pageSize: 50,
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
  }));
}

/** List the (non-folder) files inside a folder. */
export async function listDriveFiles(folderId: string): Promise<DriveEntry[]> {
  const drive = await getDriveApi();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "name",
    pageSize: 200,
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
  }));
}

/**
 * Read a Drive file as plain text: Google Docs/Sheets via export, everything
 * else downloaded and run through the same extractors as uploads.
 * Returns null when the format can't be read.
 */
export async function getDriveFileText(
  fileId: string,
  name: string,
  mimeType: string,
): Promise<string | null> {
  const drive = await getDriveApi();
  try {
    if (mimeType === "application/vnd.google-apps.document") {
      const res = await drive.files.export({ fileId, mimeType: "text/plain" }, { responseType: "text" });
      return typeof res.data === "string" && res.data.trim() ? res.data : null;
    }
    if (mimeType === "application/vnd.google-apps.spreadsheet") {
      const res = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "text" });
      return typeof res.data === "string" && res.data.trim() ? res.data : null;
    }
    if (mimeType.startsWith("application/vnd.google-apps.")) return null; // forms, slides…
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const { extractTextFromFile } = await import("@/lib/extractText");
    return extractTextFromFile(name, Buffer.from(res.data as ArrayBuffer));
  } catch {
    return null;
  }
}

/** COPY a Drive file into a client's folder — the original stays where it is. */
export async function copyDriveFileTo(fileId: string, targetFolderId: string) {
  const drive = await getDriveApi();
  await drive.files.copy({
    fileId,
    requestBody: { parents: [targetFolderId] },
    fields: "id",
  });
}

/** Append a session note (summary bullets + raw) to the client's Doc, clearly headed. */
export async function appendNoteToDoc(
  docId: string,
  note: { date: string; clinic: string; bullets: string[]; raw: string },
) {
  const clinicLabel = note.clinic === "waterloo" ? "Waterloo" : "Bethnal Green";
  await appendFormattedSections(docId, null, [
    {
      heading: `Session — ${note.date} · ${clinicLabel}`,
      lines: [
        { kind: "bullets", label: "Summary", items: note.bullets },
        { kind: "paragraph", label: "Raw note", value: note.raw },
      ],
    },
  ]);
}

/* ---------- structured writes: real headers + bold, not just plain text ---------- */

export type DocLine =
  | { kind: "field"; label: string; value: string }
  | { kind: "paragraph"; label?: string; value: string }
  | { kind: "bullets"; label?: string; items: string[] };

export interface DocSection {
  heading: string;
  lines: DocLine[];
}

/**
 * Append a structured, formatted block to the client's Doc: a bold title,
 * bold section headings, and bold labels — not a wall of plain text.
 */
export async function appendFormattedSections(docId: string, title: string | null, sections: DocSection[]) {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const insertAt = (doc.data.body?.content?.at(-1)?.endIndex ?? 1) - 1;

  let text = "\n";
  const bold: Array<{ start: number; end: number }> = [];
  const big: Array<{ start: number; end: number; size: number }> = [];

  if (title) {
    const start = text.length;
    text += `${title}\n\n`;
    bold.push({ start, end: start + title.length });
    big.push({ start, end: start + title.length, size: 13 });
  }

  for (const section of sections) {
    const headStart = text.length;
    text += `${section.heading}\n`;
    bold.push({ start: headStart, end: headStart + section.heading.length });
    big.push({ start: headStart, end: headStart + section.heading.length, size: 12 });

    for (const line of section.lines) {
      if (line.kind === "field") {
        const labelStart = text.length;
        const labelText = `${line.label}:`;
        text += `${labelText} ${line.value || "—"}\n`;
        bold.push({ start: labelStart, end: labelStart + labelText.length });
      } else if (line.kind === "paragraph") {
        if (line.label) {
          const labelStart = text.length;
          const labelText = `${line.label}:`;
          text += `${labelText}\n`;
          bold.push({ start: labelStart, end: labelStart + labelText.length });
        }
        text += `${line.value?.trim() || "—"}\n\n`;
      } else if (line.kind === "bullets") {
        if (line.label) {
          const labelStart = text.length;
          const labelText = `${line.label}:`;
          text += `${labelText}\n`;
          bold.push({ start: labelStart, end: labelStart + labelText.length });
        }
        for (const item of line.items) text += `• ${item}\n`;
        text += "\n";
      }
    }
    text += "\n";
  }

  const requests: docs_v1.Schema$Request[] = [{ insertText: { location: { index: insertAt }, text } }];
  for (const b of bold) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: insertAt + b.start, endIndex: insertAt + b.end },
        textStyle: { bold: true },
        fields: "bold",
      },
    });
  }
  for (const s of big) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: insertAt + s.start, endIndex: insertAt + s.end },
        textStyle: { fontSize: { magnitude: s.size, unit: "PT" } },
        fields: "fontSize",
      },
    });
  }

  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
}

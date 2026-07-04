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

/** Append a session note (summary bullets + raw) to the client's Doc. */
export async function appendNoteToDoc(
  docId: string,
  note: { date: string; clinic: string; bullets: string[]; raw: string },
) {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
  const text =
    `\nSession — ${note.date} · ${note.clinic}\n` +
    note.bullets.map((b) => `• ${b}`).join("\n") +
    `\n\nRaw note:\n${note.raw}\n`;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1 }, text } }],
    },
  });
}

/** Append arbitrary text (e.g. imported legacy notes) to the client's Doc. */
export async function appendTextToDoc(docId: string, text: string) {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1 }, text: `\n${text}\n` } }],
    },
  });
}

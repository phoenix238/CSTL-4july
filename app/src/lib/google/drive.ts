import type { docs_v1 } from "googleapis";
import { prisma, getSettings } from "@/lib/db";
import { getDriveApi, getDocsApi } from "./client";
import {
  renderSections,
  type DocSection,
  type DocTitle,
  type Rendered,
  type Span,
} from "./docFormat";

export type { DocLine, DocSection, DocTitle } from "./docFormat";

const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOC_MIME = "application/vnd.google-apps.document";

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
  let created = false;
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
      created = true;
    }
  }
  await prisma.client.update({ where: { id: clientId }, data: { driveFolderId: folderId, docId } });

  // A Doc we just made starts life on the standard case-history layout, headers
  // and all, so it's never a blank page waiting to be organised later. Only a
  // brand-new Doc — one found already sitting in the folder is left alone until
  // it's explicitly reformatted. Imported lazily: the layout reads Docs back
  // through this module.
  if (created) {
    const { renderCaseHistoryDoc } = await import("@/lib/caseHistory");
    await renderCaseHistoryDoc(clientId, docId);
  }
  return { folderId, docId };
}

/**
 * Drive › CSTL › "Phoenix session reflections" — one Doc, shared across every
 * client, for Phoenix's own private reflections on a session (separate from
 * the client's own Doc). Created once, cached in settings.
 */
export async function ensureReflectionsDoc(): Promise<string> {
  const settings = await getSettings();
  if (settings.reflectionsDocId) return settings.reflectionsDocId;
  const cstl = await ensureFolder("root", "CSTL");
  const name = "Phoenix session reflections";
  let docId = await findChild(cstl, name, "application/vnd.google-apps.document");
  if (!docId) {
    const drive = await getDriveApi();
    const res = await drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.document", parents: [cstl] },
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
              text: "Phoenix session reflections\nPrivate notes on sessions, across every client.\n\n",
            },
          },
        ],
      },
    });
  }
  await prisma.appSettings.update({ where: { id: 1 }, data: { reflectionsDocId: docId } });
  return docId;
}

/** Append a personal reflection (date + client) to the shared reflections Doc. */
export async function appendReflectionToDoc(
  docId: string,
  reflection: { date: string; client: string; text: string },
) {
  await appendFormattedSections(docId, null, [
    {
      heading: `${reflection.date} — ${reflection.client}`,
      lines: [{ kind: "paragraph", value: reflection.text }],
    },
  ]);
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

/**
 * Search the user's Google Docs by name, most recently touched first — how you
 * find an existing case-history Doc to link to a client. No query = the Docs
 * you've worked on lately.
 */
export async function listDriveDocs(query?: string): Promise<DriveEntry[]> {
  const drive = await getDriveApi();
  const clauses = [`mimeType = '${DOC_MIME}'`, "trashed = false"];
  if (query?.trim()) clauses.push(`name contains '${query.trim().replace(/'/g, "\\'")}'`);
  const res = await drive.files.list({
    q: clauses.join(" and "),
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 30,
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    modifiedTime: f.modifiedTime ?? "",
  }));
}

/**
 * Metadata for one Drive file — null when it's gone, never existed, or isn't
 * visible to this Google account. Used to check a client's linked Doc is still
 * really there before trusting it.
 */
export async function getDriveFileMeta(
  fileId: string,
): Promise<(DriveEntry & { trashed: boolean }) | null> {
  const drive = await getDriveApi();
  try {
    const res = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, modifiedTime, trashed",
    });
    const f = res.data;
    return {
      id: f.id!,
      name: f.name ?? "",
      mimeType: f.mimeType ?? "",
      modifiedTime: f.modifiedTime ?? "",
      trashed: f.trashed ?? false,
    };
  } catch {
    return null;
  }
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

/* ---------- structured writes: real headers + bold, not just plain text ---------- */

const MUTED_GREY = { color: { rgbColor: { red: 0.42, green: 0.42, blue: 0.4 } } };

/**
 * The Docs requests that write a rendering in at `insertAt`. Everything is
 * reset to plain body text first, so a block spliced in below a heading doesn't
 * inherit that heading's styling, then the spans are painted back on.
 */
function writeRequests(insertAt: number, r: Rendered): docs_v1.Schema$Request[] {
  const span = (s: Span) => ({ startIndex: insertAt + s.start, endIndex: insertAt + s.end });
  const requests: docs_v1.Schema$Request[] = [
    { insertText: { location: { index: insertAt }, text: r.text } },
    {
      updateParagraphStyle: {
        range: { startIndex: insertAt, endIndex: insertAt + r.text.length },
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        fields: "namedStyleType",
      },
    },
    {
      // foregroundColor is named in `fields` but left unset — the Docs API's way
      // of resetting a property back to the paragraph's inherited default.
      updateTextStyle: {
        range: { startIndex: insertAt, endIndex: insertAt + r.text.length },
        textStyle: { bold: false, italic: false },
        fields: "bold,italic,foregroundColor",
      },
    },
  ];

  for (const h of r.headings) {
    requests.push({
      updateParagraphStyle: {
        range: span(h),
        paragraphStyle: { namedStyleType: h.style },
        fields: "namedStyleType",
      },
    });
  }
  for (const b of r.bold) {
    requests.push({ updateTextStyle: { range: span(b), textStyle: { bold: true }, fields: "bold" } });
  }
  for (const i of r.italic) {
    requests.push({ updateTextStyle: { range: span(i), textStyle: { italic: true }, fields: "italic" } });
  }
  for (const m of r.muted) {
    requests.push({
      updateTextStyle: { range: span(m), textStyle: { foregroundColor: MUTED_GREY }, fields: "foregroundColor" },
    });
  }
  return requests;
}

/** Where the body ends — the index just before the Doc's final, undeletable newline. */
function bodyEnd(doc: docs_v1.Schema$Document): number {
  return (doc.body?.content?.at(-1)?.endIndex ?? 2) - 1;
}

/**
 * Append a structured, formatted block to the client's Doc: a title, real
 * headings, and bold labels — not a wall of plain text.
 */
export async function appendFormattedSections(
  docId: string,
  title: DocTitle | string | null,
  sections: DocSection[],
) {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const insertAt = (doc.data.body?.content?.at(-1)?.endIndex ?? 2) - 1;
  const rendered = renderSections(sections, { title });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: writeRequests(insertAt, rendered) },
  });
}

interface DocParagraph {
  text: string;
  start: number;
  end: number;
  style: string;
}

/** Every paragraph in the Doc, as plain text, with the index range it occupies. */
function paragraphs(doc: docs_v1.Schema$Document): DocParagraph[] {
  const out: DocParagraph[] = [];
  for (const el of doc.body?.content ?? []) {
    if (!el.paragraph || el.startIndex == null || el.endIndex == null) continue;
    const text = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
    out.push({
      text,
      start: el.startIndex,
      end: el.endIndex,
      style: el.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT",
    });
  }
  return out;
}

/**
 * Read the whole Doc as plain text without going back out to Drive's export
 * endpoint — used to capture a Doc's existing contents before rebuilding it.
 */
export async function getDocPlainText(docId: string): Promise<string> {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  return paragraphs(doc.data)
    .map((p) => p.text)
    .join("");
}

/**
 * Replace everything in the Doc with these sections. The Doc keeps its id, its
 * link and its place in Drive — only the contents are rewritten — and Google
 * Docs' own version history still holds what was there before.
 */
export async function rebuildDoc(docId: string, title: DocTitle | string | null, sections: DocSection[]) {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const end = bodyEnd(doc.data);

  const rendered = renderSections(sections, { title, leadingNewline: false });
  const requests: docs_v1.Schema$Request[] = [];
  // Clearing first, in the same batch, so the Doc is never left half-written.
  if (end > 1) requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: end } } });
  requests.push(...writeRequests(1, rendered));

  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
}

/**
 * Splice sections in directly beneath the heading that starts with `prefix` —
 * how a new session note lands inside "13. SESSION LOG" rather than at the
 * bottom of the Doc. Returns false when there's no such heading (a Doc that
 * hasn't been reformatted yet), leaving the caller to append instead.
 */
export async function insertSectionsUnderHeading(
  docId: string,
  prefix: string,
  sections: DocSection[],
): Promise<boolean> {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const heading = paragraphs(doc.data).find((p) => p.text.trimStart().startsWith(prefix));
  if (!heading) return false;

  const rendered = renderSections(sections, { leadingNewline: true });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: writeRequests(heading.end, rendered) },
  });
  return true;
}

/**
 * Swap one section of the Doc for a fresh version of itself, leaving every
 * other section exactly as it is — how "at a glance" keeps up with the client's
 * details without the whole record being rewritten around it.
 *
 * The section runs from its own heading to the next one. Returns false when the
 * heading isn't there (a Doc not yet on the layout).
 */
export async function replaceSectionUnderHeading(
  docId: string,
  prefix: string,
  section: DocSection,
): Promise<boolean> {
  const docs = await getDocsApi();
  const doc = await docs.documents.get({ documentId: docId });
  const all = paragraphs(doc.data);

  const headingAt = all.findIndex((p) => p.text.trimStart().startsWith(prefix));
  if (headingAt === -1) return false;

  const next = all.slice(headingAt + 1).find((p) => p.style === "HEADING_2" || p.style === "HEADING_1");
  const start = all[headingAt].start;
  const end = Math.min(next?.start ?? bodyEnd(doc.data), bodyEnd(doc.data));
  if (end <= start) return false;

  const rendered = renderSections([section], { leadingNewline: false });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        { deleteContentRange: { range: { startIndex: start, endIndex: end } } },
        ...writeRequests(start, rendered),
      ],
    },
  });
  return true;
}

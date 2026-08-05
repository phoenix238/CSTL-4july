/** Pull a folder id out of a pasted Drive link (or return a bare id unchanged). */
export function parseDriveFolderLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const byPath = trimmed.match(/\/folders\/([\w-]{10,})/);
  if (byPath) return byPath[1];
  const byParam = trimmed.match(/[?&]id=([\w-]{10,})/);
  if (byParam) return byParam[1];
  if (/^[\w-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Pull a Google Doc id out of a pasted Docs link (or return a bare id
 * unchanged). Folder links have no `/d/` segment, so they're rejected — a
 * folder is never a Doc.
 */
export function parseDriveDocLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const byPath = trimmed.match(/\/d\/([\w-]{10,})/);
  if (byPath) return byPath[1];
  const byParam = trimmed.match(/[?&]id=([\w-]{10,})/);
  if (byParam) return byParam[1];
  if (/^[\w-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

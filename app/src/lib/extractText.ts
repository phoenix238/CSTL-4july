// Turn an uploaded/Drive file into plain text for the AI to read.
// Returns null when the format can't be read (legacy .doc, scanned PDFs, images…).

const PLAIN_TEXT = [".txt", ".csv", ".md"];

export async function extractTextFromFile(name: string, buf: Buffer): Promise<string | null> {
  const lower = name.toLowerCase();
  try {
    if (PLAIN_TEXT.some((ext) => lower.endsWith(ext))) {
      return buf.toString("utf8");
    }
    if (lower.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return value?.trim() ? value : null;
    }
    if (lower.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return text?.trim() ? text : null;
    }
  } catch {
    // A corrupt file shouldn't sink the whole batch — treat it as unreadable.
    return null;
  }
  return null;
}

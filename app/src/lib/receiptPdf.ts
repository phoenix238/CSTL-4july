import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatPence } from "@/lib/account";
import { fmtDate } from "@/lib/time";
import type { ReceiptLine } from "@/lib/portalNotify";

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

/**
 * Render a client's receipt as a one-page (or more, if there are enough
 * sessions) downloadable PDF — the email body alone isn't something a client
 * can save or hand to an insurer/employer the way an attachment is.
 */
export async function buildReceiptPdf({
  clientName,
  lines,
  totalPence,
  unpricedCount,
  signOff,
}: {
  clientName: string;
  lines: ReceiptLine[];
  totalPence: number;
  unpricedCount: number;
  signOff: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.13, 0.13);
  const muted = rgb(0.45, 0.45, 0.45);
  const rule = rgb(0.82, 0.82, 0.82);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const colDate = MARGIN;
  const colClinic = MARGIN + 260;
  const colAmount = PAGE_WIDTH - MARGIN - 70;

  const text = (s: string, x: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });

  const drawTableHeader = () => {
    text("Session", colDate, 11, bold);
    text("Location", colClinic, 11, bold);
    text("Amount", colAmount, 11, bold);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: rule });
    y -= 18;
  };

  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawTableHeader();
  };

  text("Receipt", MARGIN, 26, bold);
  y -= 34;
  text("Craniosacral therapy with Phoenix Tanner", MARGIN, 12, font, muted);
  y -= 28;
  text(`Issued to: ${clientName}`, MARGIN, 11);
  y -= 16;
  text(`Date issued: ${fmtDate(new Date())}`, MARGIN, 11);
  y -= 28;

  drawTableHeader();

  for (const line of lines) {
    if (y < MARGIN + 60) newPage();
    text(line.whenLabel, colDate, 11);
    text(line.clinicLabel, colClinic, 11);
    text(line.amountPence != null ? formatPence(line.amountPence) : "—", colAmount, 11);
    y -= 20;
  }

  if (y < MARGIN + 110) newPage();
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: rule });
  y -= 26;
  text(`Total paid: ${formatPence(totalPence)}`, MARGIN, 14, bold);
  y -= 22;

  if (unpricedCount) {
    text(
      `${unpricedCount} sliding-scale ${unpricedCount === 1 ? "session is" : "sessions are"} listed without an amount.`,
      MARGIN,
      10,
      font,
      muted,
    );
    y -= 18;
  }

  y -= 16;
  for (const l of signOff.split("\n")) {
    if (l) text(l, MARGIN, 10, font, muted);
    y -= 14;
  }

  return doc.save();
}

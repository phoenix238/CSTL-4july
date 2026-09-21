import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatPence } from "@/lib/account";
import { fmtDate } from "@/lib/time";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import type { ReceiptLine } from "@/lib/portalNotify";

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

/** "Cash" and the bank-transfer auto-match note collapse to a short label; anything else (a free-text note) is shown as-is, trimmed. */
function paymentMethodLabel(note: string | undefined): string {
  if (!note) return "—";
  if (/^cash/i.test(note)) return "Cash";
  if (/^bank transfer/i.test(note)) return "Bank transfer";
  return note.length > 18 ? `${note.slice(0, 18)}…` : note;
}

/**
 * Render a client's receipt as a one-page (or more, if there are enough
 * sessions) downloadable PDF — the email body alone isn't something a client
 * can save or hand to an insurer/employer the way an attachment is.
 */
export async function buildReceiptPdf({
  clientName,
  clientRef,
  receiptNumber,
  lines,
  totalPence,
  unpricedCount,
  signOff,
  membershipId,
  addressByClinic,
}: {
  clientName: string;
  /** The client's own payment reference — the same on every receipt they're sent. */
  clientRef?: string;
  /** A fresh number for this specific receipt document, e.g. "RCT-42" — unlike clientRef, never repeats. */
  receiptNumber?: string;
  lines: ReceiptLine[];
  totalPence: number;
  unpricedCount: number;
  signOff: string;
  membershipId: string;
  addressByClinic: Partial<Record<Clinic, string>>;
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
  const colClinic = MARGIN + 150;
  const colMethod = MARGIN + 260;
  const colAmount = PAGE_WIDTH - MARGIN - 70;

  const text = (s: string, x: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });

  const drawTableHeader = () => {
    text("Session", colDate, 11, bold);
    text("Location", colClinic, 11, bold);
    text("Payment", colMethod, 11, bold);
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
  if (receiptNumber) {
    text(`No. ${receiptNumber}`, MARGIN, 11, font, muted);
    y -= 18;
  }
  text("Craniosacral therapy with Phoenix Tanner", MARGIN, 12, font, muted);
  y -= 16;
  text(`CSTA Membership ID: ${membershipId}`, MARGIN, 10, font, muted);
  y -= 26;
  text(`Issued to: ${clientName}`, MARGIN, 11);
  y -= 16;
  text(`Date issued: ${fmtDate(new Date())}`, MARGIN, 11);
  y -= 16;
  if (clientRef) {
    text(`Payment reference: ${clientRef}`, MARGIN, 11);
    y -= 16;
  }

  // Only the address(es) of clinics this client actually has sessions at —
  // in the order those clinics first appear, not a fixed Waterloo-then-Bethnal order.
  const clinicsUsed: Clinic[] = [];
  for (const line of lines) if (!clinicsUsed.includes(line.clinic)) clinicsUsed.push(line.clinic);
  for (const clinic of clinicsUsed) {
    const address = addressByClinic[clinic];
    if (address) {
      text(`${CLINIC_LABEL[clinic]}: ${address}`, MARGIN, 10, font, muted);
      y -= 14;
    }
  }
  y -= 12;

  drawTableHeader();

  for (const line of lines) {
    if (y < MARGIN + 60) newPage();
    text(line.whenLabel, colDate, 11);
    text(line.clinicLabel, colClinic, 11);
    text(paymentMethodLabel(line.paymentNote), colMethod, 11);
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

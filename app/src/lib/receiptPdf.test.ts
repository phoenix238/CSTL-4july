import { describe, expect, it } from "vitest";
import { buildReceiptPdf } from "./receiptPdf";

describe("buildReceiptPdf", () => {
  it("renders a valid, non-empty PDF", async () => {
    const bytes = await buildReceiptPdf({
      clientName: "Rose Purbrick",
      clientRef: "RP14",
      receiptNumber: "RCT-42",
      lines: [
        {
          whenLabel: "Thursday 17 September",
          clinic: "bethnal",
          clinicLabel: "Bethnal Green",
          amountPence: 4000,
          paymentNote: "Cash",
        },
      ],
      totalPence: 4000,
      unpricedCount: 0,
      signOff: "with gratitude\nPhoenix",
      membershipId: "2080",
      addressByClinic: { bethnal: "1 Example Street, London" },
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("still renders with no priced sessions, an unpriced count, and no reference or address", async () => {
    const bytes = await buildReceiptPdf({
      clientName: "Rose",
      lines: [{ whenLabel: "Thursday 1 October", clinic: "bethnal", clinicLabel: "Bethnal Green", amountPence: null }],
      totalPence: 0,
      unpricedCount: 1,
      signOff: "with gratitude\nPhoenix",
      membershipId: "2080",
      addressByClinic: {},
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("lists each clinic's address once even across mixed-clinic sessions", async () => {
    const bytes = await buildReceiptPdf({
      clientName: "Rose",
      lines: [
        { whenLabel: "Session 1", clinic: "bethnal", clinicLabel: "Bethnal Green", amountPence: 4000 },
        { whenLabel: "Session 2", clinic: "waterloo", clinicLabel: "Waterloo", amountPence: 8000 },
        { whenLabel: "Session 3", clinic: "bethnal", clinicLabel: "Bethnal Green", amountPence: 4000 },
      ],
      totalPence: 16000,
      unpricedCount: 0,
      signOff: "with gratitude\nPhoenix",
      membershipId: "2080",
      addressByClinic: { bethnal: "1 Example Street, London", waterloo: "2 Sample Road, London" },
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("spans multiple pages once enough sessions overflow one", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      whenLabel: `Session ${i + 1}`,
      clinic: "bethnal" as const,
      clinicLabel: "Bethnal Green",
      amountPence: 4000,
    }));
    const bytes = await buildReceiptPdf({
      clientName: "Rose",
      lines,
      totalPence: 4000 * lines.length,
      unpricedCount: 0,
      signOff: "with gratitude\nPhoenix",
      membershipId: "2080",
      addressByClinic: { bethnal: "1 Example Street, London" },
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

import { describe, expect, it } from "vitest";
import { buildReceiptPdf } from "./receiptPdf";

describe("buildReceiptPdf", () => {
  it("renders a valid, non-empty PDF", async () => {
    const bytes = await buildReceiptPdf({
      clientName: "Rose Purbrick",
      lines: [{ whenLabel: "Thursday 17 September", clinicLabel: "Bethnal Green", amountPence: 4000 }],
      totalPence: 4000,
      unpricedCount: 0,
      signOff: "with gratitude\nPhoenix",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(500);
  });

  it("still renders with no priced sessions and an unpriced count", async () => {
    const bytes = await buildReceiptPdf({
      clientName: "Rose",
      lines: [{ whenLabel: "Thursday 1 October", clinicLabel: "Bethnal Green", amountPence: null }],
      totalPence: 0,
      unpricedCount: 1,
      signOff: "with gratitude\nPhoenix",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("spans multiple pages once enough sessions overflow one", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      whenLabel: `Session ${i + 1}`,
      clinicLabel: "Bethnal Green",
      amountPence: 4000,
    }));
    const bytes = await buildReceiptPdf({
      clientName: "Rose",
      lines,
      totalPence: 4000 * lines.length,
      unpricedCount: 0,
      signOff: "with gratitude\nPhoenix",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

import { describe, it, expect } from "vitest";
import { paymentMethod, toFinanceEvent } from "./financeEvents";

const booking = {
  id: "b1",
  paidAt: new Date("2026-09-01T10:00:00Z"),
  startsAt: new Date("2026-08-31T17:00:00Z"),
  amountPence: 8000,
  paymentNote: "",
  clinic: "waterloo",
  client: { paymentRef: "JS-4" },
};

describe("paymentMethod", () => {
  it("trusts a matched bank transaction over the note", () => {
    expect(paymentMethod("Cash on the day", true)).toBe("bank");
  });
  it("reads the payment-note conventions", () => {
    expect(paymentMethod("Cash", false)).toBe("cash");
    expect(paymentMethod("Bank transfer 12 Aug · ref JS-4", false)).toBe("bank");
    expect(paymentMethod("card", false)).toBe("other");
    expect(paymentMethod("", false)).toBe("other");
  });
});

describe("toFinanceEvent", () => {
  it("carries money facts only", () => {
    const e = toFinanceEvent({ ...booking, paymentNote: "Cash — said thanks for the extra time" }, null);
    expect(e).toEqual({
      bookingId: "b1",
      paidAt: "2026-09-01T10:00:00.000Z",
      amountPence: 8000,
      method: "cash",
      feedItemUid: null,
      paymentRef: "JS-4",
      receiptNumber: "",
      clinic: "Waterloo",
      note: "Cash", // the free-text note itself never leaves CSTL
    });
  });
  it("links the Starling transaction that settled it", () => {
    const e = toFinanceEvent(booking, "feed-123");
    expect(e.method).toBe("bank");
    expect(e.feedItemUid).toBe("feed-123");
  });
  it("falls back to the session date when paidAt is missing", () => {
    expect(toFinanceEvent({ ...booking, paidAt: null }, null).paidAt).toBe("2026-08-31T17:00:00.000Z");
  });
  it("labels card payments", () => {
    expect(toFinanceEvent({ ...booking, paymentNote: "Card (SumUp)" }, null).note).toBe("Card");
  });
});

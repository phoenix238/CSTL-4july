import { describe, it, expect } from "vitest";
import { isSessionPayment } from "./starling";

const item = (over: Record<string, unknown> = {}) => ({
  feedItemUid: "x",
  status: "SETTLED",
  direction: "IN",
  source: "FASTER_PAYMENTS_IN",
  amount: { minorUnits: 6000 },
  ...over,
});

describe("isSessionPayment", () => {
  it("accepts an ordinary settled incoming payment", () => {
    expect(isSessionPayment(item())).toBe(true);
  });
  it("accepts exactly £100 but not a penny more", () => {
    expect(isSessionPayment(item({ amount: { minorUnits: 10000 } }))).toBe(true);
    expect(isSessionPayment(item({ amount: { minorUnits: 10001 } }))).toBe(false);
  });
  it("ignores transfers between your own accounts", () => {
    expect(isSessionPayment(item({ source: "INTERNAL_TRANSFER" }))).toBe(false);
  });
  it("ignores pending, outgoing and zero-value items", () => {
    expect(isSessionPayment(item({ status: "PENDING" }))).toBe(false);
    expect(isSessionPayment(item({ direction: "OUT" }))).toBe(false);
    expect(isSessionPayment(item({ amount: { minorUnits: 0 } }))).toBe(false);
  });
});

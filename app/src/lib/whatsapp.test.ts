import { describe, expect, it } from "vitest";
import { normalizeUkPhone, waLink } from "./whatsapp";

describe("normalizeUkPhone", () => {
  it("converts a UK mobile 07… to 447…", () => {
    expect(normalizeUkPhone("07911 123456")).toBe("447911123456");
  });
  it("keeps an already-international 44 number", () => {
    expect(normalizeUkPhone("44 7911 123456")).toBe("447911123456");
  });
  it("keeps a +44 number's digits", () => {
    expect(normalizeUkPhone("+44 7911 123456")).toBe("447911123456");
  });
  it("returns null for empty/garbage", () => {
    expect(normalizeUkPhone("")).toBeNull();
    expect(normalizeUkPhone("no digits here")).toBeNull();
  });
});

describe("waLink", () => {
  it("builds a wa.me link with encoded text", () => {
    const link = waLink("07911123456", "Hi there!");
    expect(link).toBe("https://wa.me/447911123456?text=Hi%20there!");
  });
  it("returns null when there's no usable number", () => {
    expect(waLink("", "hi")).toBeNull();
  });
});

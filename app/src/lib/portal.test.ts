import { describe, it, expect } from "vitest";
import { initialsFor } from "./portal";

describe("initialsFor", () => {
  it("takes the first and last name", () => {
    expect(initialsFor("Jono Smith")).toBe("JS");
  });

  it("skips middle names so the surname still lands", () => {
    expect(initialsFor("Jono Michael Smith")).toBe("JS");
  });

  it("gives a one-word name two letters, not a lone initial", () => {
    expect(initialsFor("Jono")).toBe("JO");
  });

  it("pads a single-letter name rather than returning something ragged", () => {
    expect(initialsFor("J")).toBe("JX");
  });

  it("ignores punctuation and casing", () => {
    expect(initialsFor("jono o'smith")).toBe("JO");
    expect(initialsFor("  ANNA-MARIE  DE VRIES ")).toBe("AV");
  });

  it("falls back rather than producing an empty reference", () => {
    expect(initialsFor("")).toBe("CL");
    expect(initialsFor("   ")).toBe("CL");
    expect(initialsFor("123")).toBe("CL");
  });

  it("gives two people the same initials — the number is what disambiguates", () => {
    // Deliberate: JS-4 and JS-9 are both fine, and never collide.
    expect(initialsFor("Jono Smith")).toBe(initialsFor("Jane Sharma"));
  });
});

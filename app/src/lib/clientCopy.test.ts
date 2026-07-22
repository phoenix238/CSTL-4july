import { describe, expect, it } from "vitest";
import { CLIENT_COPY_DEFAULTS, CLIENT_COPY_KEYS, applyCopy, resolveClientCopy } from "./clientCopy";

describe("resolveClientCopy", () => {
  it("returns the full defaults for null/garbage input", () => {
    expect(resolveClientCopy(null)).toEqual(CLIENT_COPY_DEFAULTS);
    expect(resolveClientCopy("nonsense")).toEqual(CLIENT_COPY_DEFAULTS);
    expect(resolveClientCopy({})).toEqual(CLIENT_COPY_DEFAULTS);
  });

  it("layers stored overrides over the defaults, key by key", () => {
    const resolved = resolveClientCopy({ intakePageTitle: "Welcome!" });
    expect(resolved.intakePageTitle).toBe("Welcome!");
    // every other field still comes from defaults
    expect(resolved.bookPageTitle).toBe(CLIENT_COPY_DEFAULTS.bookPageTitle);
    // and the object is always fully populated
    for (const k of CLIENT_COPY_KEYS) expect(typeof resolved[k]).toBe("string");
  });

  it("ignores blank or non-string overrides (falls back to default)", () => {
    const resolved = resolveClientCopy({ intakePageTitle: "   ", bookPageTitle: 42 });
    expect(resolved.intakePageTitle).toBe(CLIENT_COPY_DEFAULTS.intakePageTitle);
    expect(resolved.bookPageTitle).toBe(CLIENT_COPY_DEFAULTS.bookPageTitle);
  });
});

describe("applyCopy", () => {
  it("substitutes every occurrence of a placeholder", () => {
    expect(applyCopy("Hi {name}, {name}!", { name: "Maya" })).toBe("Hi Maya, Maya!");
  });
  it("leaves unknown placeholders untouched", () => {
    expect(applyCopy("Hi {name} at {clinic}", { name: "Sam" })).toBe("Hi Sam at {clinic}");
  });
});

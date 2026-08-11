import { describe, it, expect } from "vitest";
import { describeReturningClient } from "./clients";

describe("describeReturningClient", () => {
  it("greets them by name when they've already typed it themselves", () => {
    const { knownName, nameMatches } = describeReturningClient("Maya Okonkwo", "Maya Okonkwo");
    expect(nameMatches).toBe(true);
    expect(knownName).toBe("Maya");
  });

  it("matches on the first name, so a surname change still recognises them", () => {
    expect(describeReturningClient("Maya Okonkwo", "maya smith").knownName).toBe("Maya");
  });

  it("never reveals the name on the record to someone who didn't already know it", () => {
    // The prompt is shown to whoever typed the address, so echoing a stored
    // name back would turn the public booking page into a way of asking "is
    // this person a client of yours?" — which, for a therapy practice, is
    // exactly the question it must not answer.
    const { knownName, nameMatches } = describeReturningClient("Maya Okonkwo", "Someone Else");
    expect(nameMatches).toBe(false);
    expect(knownName).toBeUndefined();
  });

  it("says nothing when the record has no usable name", () => {
    expect(describeReturningClient("", "Maya").nameMatches).toBe(false);
  });
});

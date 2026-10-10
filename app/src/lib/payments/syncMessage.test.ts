import { describe, expect, it } from "vitest";
import { describeSync } from "./syncMessage";

const base = { newCount: 0, matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0 };

describe("describeSync", () => {
  it("says nothing new when nothing happened", () => {
    expect(describeSync(base)).toBe("No new payments since last time");
    expect(describeSync({ ...base, rematchedCount: 0 })).toBe("No new payments since last time");
  });

  it("reports an earlier payment placed late even when nothing is new", () => {
    expect(describeSync({ ...base, rematchedCount: 1 })).toBe("No new payments · 1 earlier payment now matched");
  });

  it("adds late matches to a normal summary", () => {
    expect(
      describeSync({ newCount: 3, matchedCount: 1, unmatchedCount: 1, ambiguousCount: 1, rematchedCount: 2 }),
    ).toBe("3 new · 1 matched · 2 need a look · 2 earlier payments now matched");
  });
});

import { describe, it, expect } from "vitest";
import { chalkFarmBlockRanges } from "./chalkFarm";

const at = (h: number, m = 0) => new Date(`2026-08-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

// A gap wide enough that nothing in these fixtures clusters unless meant to.
const SPLIT = 60;

describe("chalkFarmBlockRanges", () => {
  it("pads a single-cluster block by edgeBufferMinutes before the first and after the last", () => {
    // 9:00 and 10:00 are back-to-back (0-min gap) → one cluster.
    const [range, ...rest] = chalkFarmBlockRanges([at(9), at(10)], 15, SPLIT);
    expect(rest).toHaveLength(0);
    expect(range.start).toEqual(at(8, 45)); // 9:00 - 15min
    expect(range.end).toEqual(at(11, 15)); // 10:00 + 60min session + 15min
  });

  it("spans exactly the sessions with no padding when edgeBufferMinutes is 0", () => {
    const [range] = chalkFarmBlockRanges([at(9), at(10)], 0, SPLIT);
    expect(range.start).toEqual(at(9));
    expect(range.end).toEqual(at(11)); // last session's end
  });

  it("a single session still gets padding on both edges", () => {
    const [range] = chalkFarmBlockRanges([at(14)], 15, SPLIT);
    expect(range.start).toEqual(at(13, 45));
    expect(range.end).toEqual(at(15, 15));
  });

  it("splits two sessions further apart than the cluster gap into separate blocks", () => {
    // 9:00 (ends 10:00) and 12:00 → 2h gap, well over the 60-min split → two blocks.
    const ranges = chalkFarmBlockRanges([at(9), at(12)], 15, SPLIT);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toEqual(at(8, 45));
    expect(ranges[0].end).toEqual(at(10, 15));
    expect(ranges[1].start).toEqual(at(11, 45));
    expect(ranges[1].end).toEqual(at(13, 15));
  });

  it("keeps sessions within the cluster gap in one block", () => {
    // 9:00 (ends 10:00) and 10:45 → 45-min gap, within the 60-min split → one block.
    const ranges = chalkFarmBlockRanges([at(9), at(10, 45)], 15, SPLIT);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toEqual(at(8, 45));
    expect(ranges[0].end).toEqual(at(12)); // 10:45 + 60 + 15
    expect(ranges[0].starts).toEqual([at(9), at(10, 45)]);
  });

  it("clusters a run then splits off a distant session", () => {
    const ranges = chalkFarmBlockRanges([at(9), at(10), at(15)], 15, SPLIT);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].starts).toEqual([at(9), at(10)]);
    expect(ranges[1].starts).toEqual([at(15)]);
  });

  it("returns nothing for no sessions", () => {
    expect(chalkFarmBlockRanges([], 15, SPLIT)).toEqual([]);
  });
});

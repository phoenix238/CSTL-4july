import { describe, it, expect } from "vitest";
import { chalkFarmBlockRange } from "./chalkFarm";

const at = (h: number, m = 0) => new Date(`2026-08-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

describe("chalkFarmBlockRange", () => {
  it("pads the block by edgeBufferMinutes before the first session and after the last", () => {
    const range = chalkFarmBlockRange([at(9), at(11)], 15);
    expect(range.start).toEqual(at(8, 45)); // 9:00 - 15min
    expect(range.end).toEqual(at(12, 15)); // 11:00 + 60min session + 15min
  });

  it("spans exactly the sessions with no padding when edgeBufferMinutes is 0", () => {
    const range = chalkFarmBlockRange([at(9), at(10)], 0);
    expect(range.start).toEqual(at(9));
    expect(range.end).toEqual(at(11)); // last session's end
  });

  it("a single session still gets padding on both edges", () => {
    const range = chalkFarmBlockRange([at(14)], 15);
    expect(range.start).toEqual(at(13, 45));
    expect(range.end).toEqual(at(15, 15));
  });
});

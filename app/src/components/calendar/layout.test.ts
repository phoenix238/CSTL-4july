import { describe, expect, it } from "vitest";
import { layoutDayEvents } from "./layout";

const ev = (startMin: number, endMin: number) => ({ startMin, endMin });

describe("layoutDayEvents", () => {
  it("gives non-overlapping events full width", () => {
    const out = layoutDayEvents([ev(540, 600), ev(600, 660), ev(720, 780)]);
    expect(out.every((o) => o.lanes === 1 && o.lane === 0)).toBe(true);
  });

  it("splits two overlapping events into two lanes", () => {
    const out = layoutDayEvents([ev(540, 660), ev(600, 720)]);
    expect(out.map((o) => o.lane).sort()).toEqual([0, 1]);
    expect(out.every((o) => o.lanes === 2)).toBe(true);
  });

  it("reuses a freed lane within a cluster", () => {
    // A 9–10, B 9:30–10:30, C 10–11 → C fits back into A's lane; cluster is 2 wide
    const out = layoutDayEvents([ev(540, 600), ev(570, 630), ev(600, 660)]);
    const c = out.find((o) => o.event.startMin === 600)!;
    expect(c.lane).toBe(0);
    expect(out.every((o) => o.lanes === 2)).toBe(true);
  });

  it("keeps separate clusters independent", () => {
    const out = layoutDayEvents([ev(540, 660), ev(600, 720), ev(900, 960)]);
    const late = out.find((o) => o.event.startMin === 900)!;
    expect(late.lanes).toBe(1);
  });

  it("handles the Bethnal pattern — session centred inside its block", () => {
    // 2h Chalk Farm block 18:00–20:00 with the 1h session 18:30–19:30 inside it
    const out = layoutDayEvents([ev(1080, 1200), ev(1110, 1170)]);
    expect(out.every((o) => o.lanes === 2)).toBe(true);
    expect(new Set(out.map((o) => o.lane)).size).toBe(2);
  });
});

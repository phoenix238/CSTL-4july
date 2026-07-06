import { describe, expect, it } from "vitest";
import { blockedRange, mergeBethnalBlocks, planBookingEvents, slotConflicts } from "./rules";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 7, h, m));

describe("planBookingEvents", () => {
  it("Waterloo creates two 1-hour events: personal + R5 room", () => {
    const plan = planBookingEvents("waterloo", "Jonah M", at(9));
    expect(plan).toHaveLength(2);

    const personal = plan.find((e) => e.calendar === "personal")!;
    expect(personal.summary).toBe("Jonah M — Waterloo");
    expect(personal.start).toEqual(at(9));
    expect(personal.end).toEqual(at(10));
    expect(personal.inviteClient).toBe(true);

    const room = plan.find((e) => e.calendar === "room")!;
    expect(room.summary).toBe("R5 - Phoenix");
    expect(room.start).toEqual(at(9));
    expect(room.end).toEqual(at(10));
    expect(room.inviteClient).toBe(false);
  });

  it("Bethnal Green creates a 2h Chalk Farm block with the 1h session centred in it", () => {
    const plan = planBookingEvents("bethnal", "Amara Wilson", at(14));
    expect(plan).toHaveLength(2);

    const personal = plan.find((e) => e.calendar === "personal")!;
    expect(personal.summary).toBe("Amara Wilson — Bethnal Green");
    expect(personal.start).toEqual(at(14));
    expect(personal.end).toEqual(at(15));

    const block = plan.find((e) => e.calendar === "chalkFarm")!;
    expect(block.summary).toBe("Phoenix");
    expect(block.start).toEqual(at(13, 30));
    expect(block.end).toEqual(at(15, 30));
    // session is exactly centred: 30 min either side
    expect(personal.start.getTime() - block.start.getTime()).toBe(30 * 60_000);
    expect(block.end.getTime() - personal.end.getTime()).toBe(30 * 60_000);
  });
});

describe("blockedRange", () => {
  it("Waterloo blocks only the session hour", () => {
    expect(blockedRange("waterloo", at(9))).toEqual({ start: at(9), end: at(10) });
  });
  it("Bethnal blocks the full 2h window", () => {
    expect(blockedRange("bethnal", at(14))).toEqual({ start: at(13, 30), end: at(15, 30) });
  });
});

describe("mergeBethnalBlocks", () => {
  it("leaves non-overlapping blocks as separate groups", () => {
    const groups = mergeBethnalBlocks([
      { id: "a", start: at(9), end: at(11) },
      { id: "b", start: at(14), end: at(16) },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.ids.includes("a"))).toEqual({ ids: ["a"], start: at(9), end: at(11) });
  });

  it("merges a 6-7pm and a 7:15-8:15pm session into one 5:30-8:45pm block", () => {
    const groups = mergeBethnalBlocks([
      { id: "first", ...blockedRange("bethnal", at(18)) }, // 5:30–7:30
      { id: "second", ...blockedRange("bethnal", at(19, 15)) }, // 6:45–8:45
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ ids: ["first", "second"], start: at(17, 30), end: at(20, 45) });
  });

  it("merges transitively — a chain of three sessions becomes one block", () => {
    const groups = mergeBethnalBlocks([
      { id: "a", ...blockedRange("bethnal", at(9)) }, // 8:30–10:30
      { id: "c", ...blockedRange("bethnal", at(11)) }, // 10:30–12:30 — overlaps b, not a
      { id: "b", ...blockedRange("bethnal", at(10)) }, // 9:30–11:30 — bridges a and c
    ]);
    expect(groups).toHaveLength(1);
    expect(new Set(groups[0].ids)).toEqual(new Set(["a", "b", "c"]));
    expect(groups[0]).toMatchObject({ start: at(8, 30), end: at(12, 30) });
  });
});

describe("slotConflicts", () => {
  it("blocks a Bethnal slot that overlaps another Bethnal session", () => {
    const spans = [{ start: at(18), end: at(19), source: "booking" as const, known: true, clinic: "bethnal" as const }];
    expect(slotConflicts("bethnal", at(18, 30), spans)).toBe(true); // 6:30–7:30 overlaps 6–7
  });

  it("allows a Bethnal slot 15 minutes after another Bethnal session ends", () => {
    const spans = [
      { start: at(18), end: at(19), source: "booking" as const, known: true, clinic: "bethnal" as const },
      { start: at(17, 30), end: at(19, 30), source: "chalkFarm" as const, known: true },
    ];
    expect(slotConflicts("bethnal", at(19, 15), spans)).toBe(false); // 7:15pm, own block would be 6:45–8:45
  });

  it("still blocks a Waterloo slot during another clinic's Chalk Farm buffer", () => {
    const spans = [{ start: at(17, 30), end: at(19, 30), source: "chalkFarm" as const, known: true }];
    expect(slotConflicts("waterloo", at(19), spans)).toBe(true);
  });

  it("blocks a Bethnal slot overlapping a genuine outside Chalk Farm commitment", () => {
    const spans = [{ start: at(19), end: at(20), source: "chalkFarm" as const, known: false }];
    expect(slotConflicts("bethnal", at(19, 15), spans)).toBe(true);
  });
});

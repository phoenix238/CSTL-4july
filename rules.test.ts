import { describe, expect, it } from "vitest";
import { blockedRange, planBookingEvents } from "./rules";

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

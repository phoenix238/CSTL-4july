import { describe, expect, it } from "vitest";
import { blockedRange, planBookingEvents } from "./rules";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 7, h, m));

describe("planBookingEvents", () => {
  it("Waterloo creates two 1-hour events: personal + R5 room, both anonymous", () => {
    const plan = planBookingEvents("waterloo", at(9));
    expect(plan).toHaveLength(2);

    const personal = plan.find((e) => e.calendar === "personal")!;
    // No client name anywhere — a generic title, the clinic as location.
    expect(personal.summary).toBe("Craniosacral therapy");
    expect(personal.location).toBe("Waterloo");
    expect(personal.start).toEqual(at(9));
    expect(personal.end).toEqual(at(10));
    expect(personal.inviteClient).toBe(true);

    const room = plan.find((e) => e.calendar === "room")!;
    expect(room.summary).toBe("R5 - Phoenix");
    expect(room.start).toEqual(at(9));
    expect(room.end).toEqual(at(10));
    expect(room.inviteClient).toBe(false);
  });

  it("puts the venue note on the room event's description, and nowhere client-facing", () => {
    const note = "Craniosacral session 09:00–10:00.\nContact Phoenix: 07000 000000";
    const plan = planBookingEvents("waterloo", at(9), note);

    const room = plan.find((e) => e.calendar === "room")!;
    expect(room.description).toBe(note);

    // The client's own (personal) event never carries the venue note.
    const personal = plan.find((e) => e.calendar === "personal")!;
    expect(personal.description).toBeUndefined();
  });

  it("leaves the room description unset when no venue note is given", () => {
    const room = planBookingEvents("waterloo", at(9)).find((e) => e.calendar === "room")!;
    expect(room.description).toBeUndefined();
  });

  it("Bethnal Green creates just the 1h personal session — the shared Chalk Farm block is computed separately", () => {
    const plan = planBookingEvents("bethnal", at(14));
    expect(plan).toHaveLength(1);

    const personal = plan[0];
    expect(personal.calendar).toBe("personal");
    expect(personal.summary).toBe("Craniosacral therapy");
    expect(personal.location).toBe("Bethnal Green");
    expect(personal.start).toEqual(at(14));
    expect(personal.end).toEqual(at(15));
    expect(personal.inviteClient).toBe(true);
  });
});

describe("blockedRange", () => {
  it("Waterloo blocks only the session hour", () => {
    expect(blockedRange("waterloo", at(9))).toEqual({ start: at(9), end: at(10) });
  });
  it("Bethnal also blocks only the session hour — no room padding, sessions can sit close together", () => {
    expect(blockedRange("bethnal", at(14))).toEqual({ start: at(14), end: at(15) });
  });
});

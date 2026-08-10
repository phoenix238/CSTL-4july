import { describe, expect, it } from "vitest";
import { filterBusyForClinic } from "./slots";
import type { BusySpan } from "@/lib/google/calendar";

const settings = { chalkFarmBufferMinutes: 30, crossClinicGapMinutes: 90 };

const span = (over: Partial<BusySpan>): BusySpan => ({
  start: new Date("2026-08-10T10:00:00Z"),
  end: new Date("2026-08-10T11:00:00Z"),
  title: "Busy",
  known: false,
  source: "personal",
  ...over,
});

const buffersOf = (spans: ReturnType<typeof filterBusyForClinic>) => spans.map((s) => s.bufferMinutes);

describe("filterBusyForClinic", () => {
  it("keeps a studio-mate's Chalk Farm booking out of Waterloo's availability", () => {
    // The Chalk Farm calendar is shared: someone else's booking there means the
    // *room* is taken, which says nothing about whether Phoenix can be at Waterloo.
    const busy = [span({ source: "chalkFarm", title: "Amy" })];
    expect(filterBusyForClinic(busy, "waterloo", settings)).toEqual([]);
    expect(filterBusyForClinic(busy, "bethnal", settings)).toHaveLength(1);
  });

  it("keeps the Waterloo room calendar out of Bethnal Green's availability", () => {
    const busy = [span({ source: "room", title: "R5 - someone else" })];
    expect(filterBusyForClinic(busy, "bethnal", settings)).toEqual([]);
    expect(filterBusyForClinic(busy, "waterloo", settings)).toHaveLength(1);
  });

  it("always counts Phoenix's own personal-calendar time, whichever clinic is asked about", () => {
    const busy = [span({ source: "personal", title: "Dentist" })];
    expect(filterBusyForClinic(busy, "waterloo", settings)).toHaveLength(1);
    expect(filterBusyForClinic(busy, "bethnal", settings)).toHaveLength(1);
  });

  it("applies the travel gap to a session at the other clinic, and the ordinary gap to one at this clinic", () => {
    // A Waterloo morning and a Bethnal Green evening on the same day is allowed —
    // the travel gap is what stops them being booked impossibly close together.
    const busy = [span({ source: "booking", clinic: "waterloo", known: true })];
    expect(buffersOf(filterBusyForClinic(busy, "bethnal", settings))).toEqual([90]);
    expect(buffersOf(filterBusyForClinic(busy, "waterloo", settings))).toEqual([undefined]);
  });

  it("drops the shared Chalk Farm day block — only real sessions block time", () => {
    const busy = [span({ source: "chalkFarm", title: "Phoenix", roomBlock: true })];
    expect(filterBusyForClinic(busy, "bethnal", settings)).toEqual([]);
  });

  it("excludes both halves of the booking being rescheduled, session and room event", () => {
    // Without the room event going too, a client moving their session still
    // couldn't see the slot they currently hold.
    const busy = [
      span({ source: "booking", known: true, bookingId: "b1", ownBookingId: "b1", clinic: "bethnal" }),
      span({ source: "chalkFarm", title: "R5 - Phoenix", ownBookingId: "b1" }),
      span({ source: "chalkFarm", title: "Amy", ownBookingId: undefined }),
    ];
    const kept = filterBusyForClinic(busy, "bethnal", settings, "b1");
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe("Amy");
  });
});

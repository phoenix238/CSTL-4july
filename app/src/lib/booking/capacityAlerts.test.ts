import { describe, expect, it } from "vitest";
import { diffCapacityAlerts, emptyDayReason, type CapacityIssue } from "./capacityAlerts";
import type { DayTrace } from "./availability";

const asOf = new Date("2026-09-05T09:00:00Z");

const issue = (dateKey: string, clinic: "waterloo" | "bethnal" = "bethnal"): CapacityIssue => ({
  key: `${clinic}:${dateKey}`,
  clinic,
  dateKey,
  reason: "Weekly Chalk Farm hours cap reached for this week",
});

/** A day trace with everything zeroed, so each test states only what it's about. */
const trace = (
  over: Omit<Partial<DayTrace>, "dropped"> & { dropped?: Partial<DayTrace["dropped"]> } = {},
): DayTrace => ({
  dateKey: "2026-09-07",
  openMinutes: 480,
  candidates: 8,
  bookable: 0,
  ...over,
  dropped: { past: 0, hours: 0, busy: 0, cap: 0, clockChange: 0, ...(over.dropped ?? {}) },
});

const open = { hasOwnBookings: false, weekdayHasHours: true };

describe("emptyDayReason — what's worth waking Phoenix for", () => {
  it("says nothing when the day has bookable slots", () => {
    expect(emptyDayReason(trace({ bookable: 3 }), open)).toBeNull();
  });

  it("flags the weekly cap — the original Monday bug", () => {
    expect(emptyDayReason(trace({ dropped: { cap: 8 } }), open)).toMatch(/cap/i);
  });

  it("flags a drawn window too short to hold a session", () => {
    expect(emptyDayReason(trace({ openMinutes: 30, candidates: 0 }), open)).toMatch(/shorter than one session/i);
  });

  it("flags a normally-open weekday that's been fully blocked out", () => {
    const reason = emptyDayReason(trace({ openMinutes: 0, candidates: 0 }), open);
    expect(reason).toMatch(/blocked/i);
  });

  it("stays quiet for a weekday that never has hours — a deliberate closure", () => {
    expect(
      emptyDayReason(trace({ openMinutes: 0, candidates: 0 }), { hasOwnBookings: false, weekdayHasHours: false }),
    ).toBeNull();
  });

  it("flags a day swallowed by calendar busy time with nothing booked into it", () => {
    expect(emptyDayReason(trace({ dropped: { busy: 8 } }), open)).toMatch(/busy time/i);
  });

  it("stays quiet when busy time is Phoenix's own full diary", () => {
    expect(emptyDayReason(trace({ dropped: { busy: 8 } }), { ...open, hasOwnBookings: true })).toBeNull();
  });

  it("stays quiet for the minimum-notice window — expected on today, every run", () => {
    expect(emptyDayReason(trace({ dropped: { past: 8 } }), open)).toBeNull();
  });

  it("stays quiet on a clock-change day — nothing to act on", () => {
    expect(emptyDayReason(trace({ dropped: { clockChange: 2 } }), open)).toBeNull();
  });
});

describe("diffCapacityAlerts", () => {
  it("treats every issue as new when nothing was previously alerted", () => {
    const { newIssues, nextAlerted } = diffCapacityAlerts([issue("2026-09-07")], {}, asOf);
    expect(newIssues).toEqual([issue("2026-09-07")]);
    expect(nextAlerted).toEqual({ "bethnal:2026-09-07": asOf.toISOString() });
  });

  it("does not re-report a day already alerted, and keeps its original timestamp", () => {
    const firstAlerted = "2026-09-04T09:00:00.000Z";
    const { newIssues, nextAlerted } = diffCapacityAlerts(
      [issue("2026-09-07")],
      { "bethnal:2026-09-07": firstAlerted },
      asOf,
    );
    expect(newIssues).toEqual([]);
    expect(nextAlerted).toEqual({ "bethnal:2026-09-07": firstAlerted });
  });

  it("drops a day from the map once it's no longer an issue — a later recurrence re-alerts", () => {
    const { nextAlerted } = diffCapacityAlerts([], { "bethnal:2026-09-07": "2026-09-04T09:00:00.000Z" }, asOf);
    expect(nextAlerted).toEqual({});
  });

  it("only reports the days that are actually new, alongside ones already known", () => {
    const known = "2026-09-04T09:00:00.000Z";
    const { newIssues, nextAlerted } = diffCapacityAlerts(
      [issue("2026-09-07"), issue("2026-09-08")],
      { "bethnal:2026-09-07": known },
      asOf,
    );
    expect(newIssues).toEqual([issue("2026-09-08")]);
    expect(nextAlerted).toEqual({
      "bethnal:2026-09-07": known,
      "bethnal:2026-09-08": asOf.toISOString(),
    });
  });
});

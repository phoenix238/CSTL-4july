import { describe, it, expect } from "vitest";
import { normaliseLeadDays, VALID_LEAD_DAYS, leadDayLabel } from "./leadTimes";
import { dueLeadDays } from "./sessionReminders";

describe("normaliseLeadDays", () => {
  it("keeps only valid values, de-dupes, and orders largest-lead first", () => {
    expect(normaliseLeadDays([0, 1, 1, 0])).toEqual([1, 0]);
  });
  it("drops values that aren't offered", () => {
    expect(normaliseLeadDays([1, 3, 7, 99])).toEqual([1]);
  });
  it("coerces numeric strings and rejects junk", () => {
    expect(normaliseLeadDays(["1", "0"])).toEqual([1, 0]);
    expect(normaliseLeadDays("nope")).toEqual([]);
    expect(normaliseLeadDays(undefined)).toEqual([]);
  });
  it("treats an empty list as a valid 'reminders off' choice", () => {
    expect(normaliseLeadDays([])).toEqual([]);
  });
});

describe("leadDayLabel", () => {
  it("names known lead times", () => {
    expect(leadDayLabel(1)).toBe("The day before");
    expect(leadDayLabel(0)).toBe("On the morning");
    expect(leadDayLabel(42)).toBe("");
  });
  it("has 1 and 0 as the offered set", () => {
    expect(VALID_LEAD_DAYS).toEqual([1, 0]);
  });
});

describe("dueLeadDays", () => {
  // A session at 14:00 London on Thu 3 Sep 2026 (BST, UTC+1 → 13:00Z).
  const session = new Date("2026-09-03T13:00:00Z");

  it("fires the day-before lead on the day before", () => {
    const asOf = new Date("2026-09-02T06:00:00Z"); // 2 Sep, morning
    expect(dueLeadDays({ startsAt: session, remindersSentLead: [] }, [1, 0], asOf)).toEqual([1]);
  });

  it("fires the morning-of lead on the session's own day", () => {
    const asOf = new Date("2026-09-03T06:00:00Z"); // 3 Sep, before the session
    expect(dueLeadDays({ startsAt: session, remindersSentLead: [] }, [1, 0], asOf)).toEqual([0]);
  });

  it("never re-sends a lead already recorded", () => {
    const asOf = new Date("2026-09-02T06:00:00Z");
    expect(dueLeadDays({ startsAt: session, remindersSentLead: [1] }, [1, 0], asOf)).toEqual([]);
  });

  it("only considers the client's chosen leads", () => {
    const asOf = new Date("2026-09-03T06:00:00Z"); // the session's own day
    expect(dueLeadDays({ startsAt: session, remindersSentLead: [] }, [1], asOf)).toEqual([]);
  });

  it("never fires for a session that has already started", () => {
    const asOf = new Date("2026-09-03T13:30:00Z"); // after the 14:00 BST start
    expect(dueLeadDays({ startsAt: session, remindersSentLead: [] }, [1, 0], asOf)).toEqual([]);
  });
});

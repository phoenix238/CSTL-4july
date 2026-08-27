import { describe, expect, it } from "vitest";
import {
  canonicalSummary,
  clinicFromTitle,
  expectedWindows,
  geometryOf,
  windowInstants,
} from "./availabilityProjection";
import type { WeeklyHours, OverrideWindow } from "@/lib/booking/availability";
import { londonAddDays, londonDateKey, londonTime } from "@/lib/time";

describe("canonicalSummary", () => {
  it("names the clinic", () => {
    expect(canonicalSummary("waterloo")).toBe("Available — Waterloo");
    expect(canonicalSummary("bethnal")).toBe("Available — Bethnal Green");
  });
});

describe("clinicFromTitle", () => {
  it("reads a clinic keyword from the title", () => {
    expect(clinicFromTitle("Bethnal 6–7pm", "waterloo")).toBe("bethnal");
    expect(clinicFromTitle("BG evening", "waterloo")).toBe("bethnal");
    expect(clinicFromTitle("chalk farm slot", "waterloo")).toBe("bethnal");
    expect(clinicFromTitle("Waterloo morning", "bethnal")).toBe("waterloo");
  });
  it("falls back when there is no keyword", () => {
    expect(clinicFromTitle("Available", "waterloo")).toBe("waterloo");
    expect(clinicFromTitle("", "bethnal")).toBe("bethnal");
    expect(clinicFromTitle(null, "bethnal")).toBe("bethnal");
  });
});

describe("geometryOf", () => {
  it("reads a timed event's London day and minute span (BST)", () => {
    // 08:00–11:00 UTC on 7 Jul 2026 is 09:00–12:00 London (BST, +1).
    expect(geometryOf("2026-07-07T08:00:00Z", "2026-07-07T11:00:00Z")).toEqual({
      dateKey: "2026-07-07",
      startMin: 540,
      endMin: 720,
    });
  });
  it("reads a timed event in GMT (winter, +0)", () => {
    // 09:00–10:00 UTC on 7 Jan 2026 is the same wall-clock in London (GMT).
    expect(geometryOf("2026-01-07T09:00:00Z", "2026-01-07T10:00:00Z")).toEqual({
      dateKey: "2026-01-07",
      startMin: 540,
      endMin: 600,
    });
  });
  it("clamps an event ending at the next midnight to end-of-day", () => {
    // 22:00 UTC → 23:00 London; ends 23:00 UTC → 00:00 next London day.
    expect(geometryOf("2026-07-07T22:00:00Z", "2026-07-07T23:00:00Z")).toEqual({
      dateKey: "2026-07-07",
      startMin: 1380,
      endMin: 1440,
    });
  });
  it("ignores all-day / malformed / zero-length events", () => {
    expect(geometryOf(null, "2026-07-07T11:00:00Z")).toBeNull();
    expect(geometryOf("2026-07-07T11:00:00Z", null)).toBeNull();
    expect(geometryOf("not-a-date", "2026-07-07T11:00:00Z")).toBeNull();
    expect(geometryOf("2026-07-07T11:00:00Z", "2026-07-07T11:00:00Z")).toBeNull();
  });
});

describe("windowInstants", () => {
  it("maps a wall-clock window to the correct UTC instants across DST", () => {
    // Winter (GMT): 09:00 London == 09:00 UTC.
    const winter = windowInstants("2026-01-13", 540, 600);
    expect(winter.start.toISOString()).toBe("2026-01-13T09:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2026-01-13T10:00:00.000Z");
    // Summer (BST, +1): 09:00 London == 08:00 UTC.
    const summer = windowInstants("2026-07-07", 540, 600);
    expect(summer.start.toISOString()).toBe("2026-07-07T08:00:00.000Z");
    expect(summer.end.toISOString()).toBe("2026-07-07T09:00:00.000Z");
  });
});

describe("expectedWindows", () => {
  const emptyOverrides = { waterloo: [] as OverrideWindow[], bethnal: [] as OverrideWindow[] };
  // Weekly hours: Waterloo 09:00–12:00 every weekday; Bethnal none.
  const weeklyHours: WeeklyHours = {
    waterloo: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMin: 540, endMin: 720 })),
    bethnal: [],
  };
  // A plain 7-day window (well clear of clock changes).
  const windowStart = londonTime(2026, 7, 6, 0, 0); // Mon 6 Jul 2026
  const windowEnd = londonAddDays(windowStart, 7);

  it("expands weekly hours to one window per day per clinic", () => {
    const out = expectedWindows({ weeklyHours, overridesByClinic: emptyOverrides, windowStart, windowEnd });
    const waterloo = out.filter((w) => w.clinic === "waterloo");
    const bethnal = out.filter((w) => w.clinic === "bethnal");
    expect(waterloo).toHaveLength(7);
    expect(bethnal).toHaveLength(0);
    expect(waterloo.every((w) => w.startMin === 540 && w.endMin === 720)).toBe(true);
  });

  it("subtracts a one-off block override for its date only", () => {
    const day0 = londonDateKey(windowStart);
    const overrides = {
      waterloo: [{ date: day0, kind: "block", startMin: 540, endMin: 720, repeatWeekly: false }] as OverrideWindow[],
      bethnal: [] as OverrideWindow[],
    };
    const out = expectedWindows({ weeklyHours, overridesByClinic: overrides, windowStart, windowEnd });
    const waterloo = out.filter((w) => w.clinic === "waterloo");
    expect(waterloo).toHaveLength(6); // the blocked day drops out
    expect(waterloo.some((w) => w.dateKey === day0)).toBe(false);
  });

  it("adds a one-off open override as a new window", () => {
    const day1 = londonDateKey(londonAddDays(windowStart, 1));
    const overrides = {
      waterloo: [] as OverrideWindow[],
      bethnal: [{ date: day1, kind: "open", startMin: 600, endMin: 660, repeatWeekly: false }] as OverrideWindow[],
    };
    const out = expectedWindows({ weeklyHours, overridesByClinic: overrides, windowStart, windowEnd });
    const bethnal = out.filter((w) => w.clinic === "bethnal");
    expect(bethnal).toEqual([{ clinic: "bethnal", dateKey: day1, startMin: 600, endMin: 660 }]);
  });

  it("repeats a repeatWeekly open override on the same weekday in later weeks", () => {
    const day0 = londonDateKey(windowStart);
    const twoWeeks = londonAddDays(windowStart, 14);
    const overrides = {
      waterloo: [] as OverrideWindow[],
      bethnal: [{ date: day0, kind: "open", startMin: 600, endMin: 660, repeatWeekly: true }] as OverrideWindow[],
    };
    const out = expectedWindows({ weeklyHours, overridesByClinic: overrides, windowStart, windowEnd: twoWeeks });
    const bethnal = out.filter((w) => w.clinic === "bethnal");
    // The draw date plus the same weekday one week later — two occurrences in a fortnight.
    expect(bethnal).toHaveLength(2);
    expect(bethnal.map((w) => w.dateKey)).toEqual([day0, londonDateKey(londonAddDays(windowStart, 7))]);
  });
});

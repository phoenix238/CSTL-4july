import { describe, expect, it } from "vitest";
import {
  computeAvailableSlots,
  dayOpenIntervals,
  isSlotAvailable,
  mergeIntervals,
  resolveWeeklyHours,
  subtractInterval,
  type OverrideWindow,
  type WeeklyWindow,
} from "./availability";
import { londonDayStart, londonTime, londonWeekdayIndex, londonYMD } from "@/lib/time";

// Tue 7 July 2026 and Sun 5 July 2026 (same week, London/BST).
const TUESDAY = londonDayStart(0, new Date("2026-07-07T12:00:00Z"));
const SUNDAY = londonDayStart(0, new Date("2026-07-05T12:00:00Z"));
const tueWeekday = londonWeekdayIndex(TUESDAY);
const sunWeekday = londonWeekdayIndex(SUNDAY);

const dayWindow = (day: Date) => ({ windowStart: day, windowEnd: londonDayStart(1, day) });
const at = (h: number, m = 0, day = TUESDAY) => {
  const { y, m: mo, d } = londonYMD(day);
  return londonTime(y, mo, d, h, m);
};

describe("mergeIntervals", () => {
  it("merges overlapping and adjacent intervals, leaves disjoint ones apart", () => {
    expect(mergeIntervals([{ start: 60, end: 120 }, { start: 100, end: 180 }, { start: 300, end: 360 }])).toEqual([
      { start: 60, end: 180 },
      { start: 300, end: 360 },
    ]);
  });
});

describe("subtractInterval", () => {
  it("splits an interval in two when the cut is in the middle", () => {
    expect(subtractInterval([{ start: 0, end: 100 }], { start: 40, end: 60 })).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });
  it("trims from one side when the cut overlaps an edge", () => {
    expect(subtractInterval([{ start: 0, end: 100 }], { start: 80, end: 120 })).toEqual([{ start: 0, end: 80 }]);
  });
  it("removes the interval entirely when the cut covers it", () => {
    expect(subtractInterval([{ start: 0, end: 100 }], { start: -10, end: 200 })).toEqual([]);
  });
});

describe("resolveWeeklyHours", () => {
  it("returns empty (nothing bookable) for null/malformed input", () => {
    expect(resolveWeeklyHours(null)).toEqual({ waterloo: [], bethnal: [] });
    expect(resolveWeeklyHours({ waterloo: "nonsense" })).toEqual({ waterloo: [], bethnal: [] });
  });
  it("drops malformed windows but keeps valid ones", () => {
    const raw = { waterloo: [{ weekday: 1, startMin: 540, endMin: 1020 }, { weekday: 9, startMin: 0, endMin: 60 }] };
    expect(resolveWeeklyHours(raw).waterloo).toEqual([{ weekday: 1, startMin: 540, endMin: 1020 }]);
  });
});

describe("dayOpenIntervals", () => {
  const weekly: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 720 }]; // 9-12

  it("an 'open' override adds a window on a normally-closed day", () => {
    const overrides: OverrideWindow[] = [{ date: "2026-07-05", kind: "open", startMin: 600, endMin: 660 }];
    expect(dayOpenIntervals(sunWeekday, "2026-07-05", [], overrides)).toEqual([{ start: 600, end: 660 }]);
  });

  it("a 'block' override cancels part of a normally-open day", () => {
    const overrides: OverrideWindow[] = [{ date: "2026-07-07", kind: "block", startMin: 600, endMin: 660 }];
    expect(dayOpenIntervals(tueWeekday, "2026-07-07", weekly, overrides)).toEqual([
      { start: 540, end: 600 },
      { start: 660, end: 720 },
    ]);
  });
});

describe("computeAvailableSlots", () => {
  it("Waterloo: lists every 30-min start that leaves a full hour inside the weekly window", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 720 }]; // 9-12
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
    });
    expect(slots).toEqual([at(9), at(9, 30), at(10), at(10, 30), at(11)]);
  });

  it("a block override removes the slots that would land inside it", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 720 }];
    const overrides: OverrideWindow[] = [{ date: "2026-07-07", kind: "block", startMin: 600, endMin: 660 }];
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides,
      busy: [],
      now: at(0),
    });
    expect(slots).toEqual([at(9), at(11)]);
  });

  it("an open override makes a normally-closed Sunday bookable", () => {
    const overrides: OverrideWindow[] = [{ date: "2026-07-05", kind: "open", startMin: 600, endMin: 660 }];
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(SUNDAY),
      weeklyHours: [],
      overrides,
      busy: [],
      now: londonDayStart(0, SUNDAY),
    });
    expect(slots).toEqual([at(10, 0, SUNDAY)]);
  });

  it("Bethnal: slots span edge-to-edge like Waterloo — no fixed room padding, sessions can sit close together", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10, exactly 1h
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
    });
    expect(slots).toEqual([at(9)]); // fits exactly — no 30-min pad eating into the window
  });

  it("Bethnal: a prior session's real busy span still blocks, but leaves the very next 15-min slot free", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 720 }]; // 9-12
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [{ start: at(9), end: at(10) }], // an existing 9-10 session
      slotMinutes: 15,
      now: at(0),
    });
    // 9:00 is taken; 10:00 (right after) is free — no artificial 2h gap.
    expect(slots).not.toContainEqual(at(9));
    expect(slots).toContainEqual(at(10));
  });

  it("excludes slots inside the minimum-notice window from now", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 720 }];
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(9),
      minNoticeMinutes: 120, // nothing bookable before 11:00
    });
    expect(slots).toEqual([at(11)]);
  });

  it("a busy span blocks the slot it overlaps", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 720 }];
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [{ start: at(10), end: at(10, 30) }],
      now: at(0),
    });
    expect(slots).not.toContainEqual(at(10));
    expect(slots).toContainEqual(at(9));
    expect(slots).toContainEqual(at(11));
  });

  it("bufferMinutes pads every session's footprint before checking collisions", () => {
    // A wide window (8-14) so the buffer padding lands well clear of the
    // window's own edges — isolates the busy-collision effect being tested.
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 480, endMin: 840 }];
    const busy = [{ start: at(10, 30), end: at(11) }];
    const withoutBuffer = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy,
      now: at(0),
    });
    const withBuffer = computeAvailableSlots({
      clinic: "waterloo",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy,
      now: at(0),
      bufferMinutes: 30,
    });
    // The 9:30 slot (9:30-10:30) doesn't touch the 10:30-11:00 busy span, but
    // a 30-min buffer either side pads its footprint out to 9:00-11:00, which does.
    expect(withoutBuffer).toContainEqual(at(9, 30));
    expect(withBuffer).not.toContainEqual(at(9, 30));
  });

  it("a busy span's own bufferMinutes overrides the default — e.g. a bigger gap around a studio-mate's booking", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 480, endMin: 1200 }]; // 8-20
    // A studio-mate's Chalk Farm booking 16:00-17:00, needing a 30-min gap either side.
    const busy = [{ start: at(16), end: at(17), bufferMinutes: 30 }];
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy,
      slotMinutes: 30,
      bufferMinutes: 15, // Phoenix's own default buffer between his own clients
      now: at(0),
    });
    // 17:15 (only 15 min clear) is still inside the studio-mate's 30-min gap.
    expect(slots).not.toContainEqual(at(17, 15));
    // 17:30 (a full 30 min clear) is bookable.
    expect(slots).toContainEqual(at(17, 30));
  });
});

describe("isSlotAvailable", () => {
  const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }]; // 9-17

  it("is true for a free time even off the slotMinutes grid (e.g. offered at a 15-min mark)", () => {
    expect(
      isSlotAvailable(at(9, 15), { clinic: "waterloo", weeklyHours, overrides: [], busy: [], now: at(0) }),
    ).toBe(true);
  });

  it("is false once a busy span now overlaps it", () => {
    expect(
      isSlotAvailable(at(9, 15), {
        clinic: "waterloo",
        weeklyHours,
        overrides: [],
        busy: [{ start: at(9), end: at(10) }],
        now: at(0),
      }),
    ).toBe(false);
  });

  it("is false outside the open hours", () => {
    expect(
      isSlotAvailable(at(18), { clinic: "waterloo", weeklyHours, overrides: [], busy: [], now: at(0) }),
    ).toBe(false);
  });

  it("is false once inside the minimum-notice window", () => {
    expect(
      isSlotAvailable(at(10), {
        clinic: "waterloo",
        weeklyHours,
        overrides: [],
        busy: [],
        now: at(9),
        minNoticeMinutes: 120,
      }),
    ).toBe(false);
  });
});

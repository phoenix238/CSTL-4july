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
import { londonDateKey, londonDayStart, londonTime, londonWeekdayIndex, londonWeekStart, londonYMD } from "@/lib/time";

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

describe("computeAvailableSlots across the autumn DST fall-back", () => {
  // Open 09:00–17:00 every weekday, so each day yields slots.
  const everyDay: WeeklyWindow[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    startMin: 540,
    endMin: 1020,
  }));
  const pastNow = new Date("2020-01-01T00:00:00Z");

  it("produces no duplicate slot instants over the 25-hour Sunday", () => {
    // Window spans Sat 25 → Mon 27 Oct 2025 (the 26th is the fall-back day).
    const windowStart = londonDayStart(0, new Date("2025-10-25T12:00:00Z"));
    const windowEnd = londonDayStart(3, new Date("2025-10-25T12:00:00Z"));
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      windowStart,
      windowEnd,
      weeklyHours: everyDay,
      overrides: [],
      busy: [],
      slotMinutes: 30,
      now: pastNow,
    });
    const isos = slots.map((d) => d.toISOString());
    expect(new Set(isos).size).toBe(isos.length); // no duplicates

    // All three days are present exactly once (15 one-hour slots each on 09–17/30m).
    const sundaySlots = slots.filter((d) => londonYMD(d).d === 26 && londonYMD(d).m === 10);
    expect(sundaySlots).toHaveLength(15);
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

  it("two separate windows on the same weekday (e.g. a day slot and an evening slot) both stay open, with the gap between them closed", () => {
    const dayAndEvening: WeeklyWindow[] = [
      { weekday: tueWeekday, startMin: 540, endMin: 780 }, // 9:00-13:00
      { weekday: tueWeekday, startMin: 1020, endMin: 1260 }, // 17:00-21:00
    ];
    expect(dayOpenIntervals(tueWeekday, "2026-07-07", dayAndEvening, [])).toEqual([
      { start: 540, end: 780 },
      { start: 1020, end: 1260 },
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

  it("the buffer doesn't eat the edges of the working day — a full day's hours stay fully bookable", () => {
    // 09:00-17:00 with a 15-min gap between clients. The gap is breathing room
    // from *other bookings*, not clearance Phoenix needs from 9am itself, so an
    // empty day must offer the very first and very last session the hours allow.
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }];
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    });
    expect(slots).toContainEqual(at(9)); // 09:00-10:00, flush with the start
    expect(slots).toContainEqual(at(16)); // 16:00-17:00, flush with the end
    expect(slots).not.toContainEqual(at(16, 30)); // would run past 17:00
  });

  it("still keeps the buffer between two of Phoenix's own sessions", () => {
    // The other half of the rule above: dropping the edge padding must not have
    // dropped the gap that actually matters.
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }];
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [{ start: at(12), end: at(13) }],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    });
    expect(slots).not.toContainEqual(at(11)); // 11:00-12:00 leaves no gap before
    expect(slots).not.toContainEqual(at(13)); // 13:00-14:00 leaves no gap after
    expect(slots).toContainEqual(at(10, 30)); // ends 11:30, a clear hour before
    expect(slots).toContainEqual(at(13, 30)); // starts a clear 30 min after
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

  it("weeklyCap excludes a candidate that would push the week's total past the cap", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10
    const weekKey = londonDateKey(londonWeekStart(TUESDAY));
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      // Already at the 600-min (10 hr) cap this week — the 60-min candidate would push it over.
      weeklyCap: { capMinutes: 600, bookedMinutesByWeek: { [weekKey]: 600 } },
    });
    expect(slots).toEqual([]);
  });

  it("weeklyCap still allows a candidate that exactly fills the remaining cap", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10
    const weekKey = londonDateKey(londonWeekStart(TUESDAY));
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      // 540 min (9 hr) already booked this week — 60 more exactly reaches the 600-min cap.
      weeklyCap: { capMinutes: 600, bookedMinutesByWeek: { [weekKey]: 540 } },
    });
    expect(slots).toEqual([at(9)]);
  });

  it("weeklyCap only counts the candidate's own week — a different week's total doesn't block it", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10
    const otherWeekKey = londonDateKey(londonWeekStart(londonDayStart(-7, TUESDAY)));
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      weeklyCap: { capMinutes: 600, bookedMinutesByWeek: { [otherWeekKey]: 600 } },
    });
    expect(slots).toEqual([at(9)]);
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

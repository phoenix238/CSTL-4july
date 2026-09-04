import { describe, expect, it } from "vitest";
import {
  chalkFarmDayBlockMinutes,
  computeAvailability,
  computeAvailableSlots,
  dayOpenIntervals,
  explainEmptyDay,
  isSlotAvailable,
  mergeIntervals,
  resolveWeeklyHours,
  subtractInterval,
  type AvailabilityParams,
  type OverrideWindow,
  type WeeklyWindow,
} from "./availability";
import { fmtTime, londonDateKey, londonDayStart, londonTime, londonWeekdayIndex, londonWeekStart, londonYMD } from "@/lib/time";

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

describe("computeAvailableSlots across the spring DST jump", () => {
  // Sun 29 March 2026: the clocks go forward at 01:00 GMT, so 01:00–01:59
  // London never happens that day. Hours are set right across the gap.
  const SPRING = londonDayStart(0, new Date("2026-03-29T12:00:00Z"));
  const springWeekday = londonWeekdayIndex(SPRING);
  const overnight: WeeklyWindow[] = [{ weekday: springWeekday, startMin: 0, endMin: 300 }]; // 00:00–05:00
  const pastNow = new Date("2020-01-01T00:00:00Z");

  const run = () =>
    computeAvailability({
      clinic: "waterloo",
      windowStart: SPRING,
      windowEnd: londonDayStart(1, SPRING),
      weeklyHours: overnight,
      overrides: [],
      busy: [],
      slotMinutes: 30,
      now: pastNow,
    });

  it("never offers a time that doesn't exist", () => {
    // Every slot must report back the wall-clock time it claims to be.
    for (const slot of run().slots) {
      const label = fmtTime(slot);
      expect(label).not.toBe("01:00");
      expect(label).not.toBe("01:30");
    }
  });

  it("produces no duplicate instants across the gap", () => {
    // Before the fix, 01:00 and 02:00 both resolved to the same moment.
    const isos = run().slots.map((d) => d.toISOString());
    expect(new Set(isos).size).toBe(isos.length);
  });

  it("still offers the hours either side of the jump", () => {
    const labels = run().slots.map(fmtTime);
    expect(labels).toContain("00:00");
    expect(labels).toContain("02:00");
    expect(labels).toContain("03:00");
  });

  it("counts the skipped hour rather than losing track of it", () => {
    const day = run().days[0];
    const { past, hours, busy, cap, clockChange } = day.dropped;
    expect(clockChange).toBe(2); // 01:00 and 01:30
    expect(day.bookable + past + hours + busy + cap + clockChange).toBe(day.candidates);
  });
});

describe("computeAvailableSlots on ordinary times on DST days", () => {
  // The change must not disturb the times a session actually happens at.
  const pastNow = new Date("2020-01-01T00:00:00Z");
  for (const [label, iso] of [
    ["spring forward", "2026-03-29T12:00:00Z"],
    ["autumn fall back", "2026-10-25T12:00:00Z"],
  ] as const) {
    it(`keeps working hours intact on the ${label} day`, () => {
      const day = londonDayStart(0, new Date(iso));
      const slots = computeAvailableSlots({
        clinic: "waterloo",
        windowStart: day,
        windowEnd: londonDayStart(1, day),
        weeklyHours: [{ weekday: londonWeekdayIndex(day), startMin: 540, endMin: 1020 }], // 9-5
        overrides: [],
        busy: [],
        slotMinutes: 30,
        now: pastNow,
      });
      expect(slots.map(fmtTime)).toContain("09:00");
      expect(slots.map(fmtTime)).toContain("16:00");
      expect(slots).toHaveLength(15);
    });
  }
});

describe("chalkFarmDayBlockMinutes", () => {
  it("is zero for a day with no sessions", () => {
    expect(chalkFarmDayBlockMinutes([], 15, 60)).toBe(0);
  });
  it("a lone session is its hour plus both edges", () => {
    expect(chalkFarmDayBlockMinutes([600], 15, 60)).toBe(60 + 30); // 10:00 session, 15-min edges
  });
  it("one block spans a cluster's first-to-last, inner gaps included", () => {
    // 10:00 and 11:30 — 30-min gap, within a 60-min split → one block, no edge:
    // 10:00→12:30 = (690-600)+60 = 150.
    expect(chalkFarmDayBlockMinutes([600, 690], 0, 60)).toBe(690 - 600 + 60);
  });
  it("splits sessions past the cluster gap into separate blocks, gap not counted", () => {
    // 10:00 and 14:00 — 3h gap, over the 60-min split → two lone blocks:
    // each 60 min with no edge → 120 total, the 3h gap uncounted.
    expect(chalkFarmDayBlockMinutes([600, 840], 0, 60)).toBe(120);
  });
  it("keeps a whole day as one block when the split gap is wide enough", () => {
    // Same 10:00 and 14:00, but a 240-min split → one block: (840-600)+60 = 300.
    expect(chalkFarmDayBlockMinutes([600, 840], 0, 240)).toBe(840 - 600 + 60);
  });
  it("back-to-back sessions cost only the extra hour, not double the edges", () => {
    // 10:00 and 11:00 with 15-min edges, one cluster: 09:45→12:15 = 150.
    expect(chalkFarmDayBlockMinutes([600, 660], 15, 60)).toBe(660 - 600 + 60 + 30);
  });
  it("two split blocks each carry their own edges", () => {
    // 10:00 and 14:00 with 15-min edges, over the split → two lone blocks of 90 each.
    expect(chalkFarmDayBlockMinutes([600, 840], 15, 60)).toBe((60 + 30) * 2);
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

describe("explainEmptyDay", () => {
  const run = (params: Partial<Parameters<typeof computeAvailability>[0]> = {}) =>
    computeAvailability({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }], // 9-5
      overrides: [],
      busy: [],
      slotMinutes: 30,
      now: at(0),
      ...params,
    }).days[0];

  it("says nothing at all when the day has bookable time", () => {
    expect(explainEmptyDay(run())).toBe("");
  });

  it("names the weekly cap — the reason that costs the most time to work out by hand", () => {
    const trace = run({
      weeklyCap: {
        capMinutes: 600,
        edgeBufferMinutes: 0,
        clusterGapMinutes: 60,
        blockMinutesByWeek: { [londonDateKey(londonWeekStart(TUESDAY))]: 600 },
        sessionMinsByDay: {},
      },
    });
    expect(trace.bookable).toBe(0);
    expect(explainEmptyDay(trace)).toMatch(/cap/i);
  });

  it("says when no hours are set for the day", () => {
    expect(explainEmptyDay(run({ weeklyHours: [] }))).toMatch(/no hours/i);
  });

  it("says when a full diary is what's blocking it", () => {
    const trace = run({ busy: [{ start: at(9), end: at(17) }] });
    expect(explainEmptyDay(trace)).toMatch(/taken/i);
  });

  it("says when it's the minimum-notice window", () => {
    // "Now" is late in the day, so every slot on it is already past the cutoff.
    const trace = run({ now: at(16, 30) });
    expect(explainEmptyDay(trace)).toMatch(/too soon/i);
  });

  it("says when the hours are too short to hold a session", () => {
    const trace = run({ weeklyHours: [{ weekday: tueWeekday, startMin: 540, endMin: 570 }] }); // 30 min
    expect(explainEmptyDay(trace)).toMatch(/shorter than one session/i);
  });
});

describe("computeAvailability", () => {
  it("returns exactly what computeAvailableSlots does — the calendar and /book can't disagree", () => {
    const params = {
      clinic: "bethnal" as const,
      ...dayWindow(TUESDAY),
      weeklyHours: [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }],
      overrides: [],
      busy: [{ start: at(11), end: at(12) }],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    };
    expect(computeAvailability(params).slots).toEqual(computeAvailableSlots(params));
  });

  it("accounts for every candidate — bookable plus dropped equals the total considered", () => {
    const day = computeAvailability({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }],
      overrides: [],
      busy: [{ start: at(11), end: at(12) }],
      slotMinutes: 30,
      now: at(10),
      minNoticeMinutes: 120,
    }).days[0];
    const { past, hours, busy, cap, clockChange } = day.dropped;
    expect(day.bookable + past + hours + busy + cap + clockChange).toBe(day.candidates);
  });
});

describe("grid-independent candidate injection: the slot right next to a booking is always offered", () => {
  const hours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 1020 }]; // 9-17

  it("offers the slot right after a booking even when the grid step skips over it", () => {
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: hours,
      overrides: [],
      busy: [{ start: at(11), end: at(12) }],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    }).map(fmtTime);
    expect(slots).toContain("12:15");
    expect(slots).toContain("12:30");
    expect(slots).not.toContain("12:00");
  });

  it("offers the slot right before a booking too", () => {
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: hours,
      overrides: [],
      busy: [{ start: at(15), end: at(16) }],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    }).map(fmtTime);
    expect(slots).toContain("13:45"); // 15:00 minus a 60-min session minus the 15-min buffer
  });

  it("doesn't spawn an extra pickable time inside an exact-start window", () => {
    const overrides: OverrideWindow[] = [
      { date: "2026-07-07", kind: "open", startMin: 20 * 60, endMin: 21 * 60, exactStart: true },
    ];
    // A later busy span whose "before" injection (21:15 minus a session, no
    // buffer) lands at 20:15 — inside the exact window but not its own start,
    // and far enough from 20:00 that the window's own slot stays clear of it.
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: [{ weekday: tueWeekday, startMin: 10 * 60, endMin: 12 * 60 }],
      overrides,
      busy: [{ start: at(21, 15), end: at(22, 15), bufferMinutes: 0 }],
      slotMinutes: 30,
      now: at(0),
    }).map(fmtTime);
    expect(slots).toContain("20:00"); // the exact window's own configured start
    expect(slots).not.toContain("20:15"); // would be inside the exact window but isn't its own start
  });

  it("agrees with isSlotAvailable on the injected candidate", () => {
    const params = {
      clinic: "bethnal" as const,
      weeklyHours: hours,
      overrides: [],
      busy: [{ start: at(11), end: at(12) }],
      bufferMinutes: 15,
      now: at(0),
    };
    expect(isSlotAvailable(at(12, 15), params)).toBe(true);
    expect(isSlotAvailable(at(12, 0), params)).toBe(false);
  });

  it("keeps trace accounting balanced when an injected candidate is itself rejected", () => {
    const day = computeAvailability({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: hours,
      overrides: [],
      busy: [
        { start: at(11), end: at(12) },
        { start: at(12, 15), end: at(13, 15) },
      ],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    }).days[0];
    const { past, hours: droppedHours, busy, cap, clockChange } = day.dropped;
    expect(day.bookable + past + droppedHours + busy + cap + clockChange).toBe(day.candidates);
    expect(busy).toBeGreaterThan(0); // the injected 12:15 candidate collided with the second booking
  });

  it("doesn't offer a slot that collides with a neighbouring booking, and still finds the real next slot", () => {
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: hours,
      overrides: [],
      busy: [
        { start: at(11), end: at(12) },
        { start: at(12, 15), end: at(13, 15) },
      ],
      slotMinutes: 30,
      bufferMinutes: 15,
      now: at(0),
    }).map(fmtTime);
    expect(slots).not.toContain("12:15"); // would collide with the second booking
    expect(slots).not.toContain("12:00"); // still inside the first booking's buffer
    expect(slots).toContain("13:30"); // real next slot: 13:15 end + 15 min buffer
  });
});

describe("repeating overrides", () => {
  // Drawn on Tue 7 July 2026, repeating weekly.
  const repeatingOpen: OverrideWindow[] = [
    { date: "2026-07-07", kind: "open", startMin: 19 * 60, endMin: 21 * 60, repeatWeekly: true },
  ];

  it("applies to the same weekday on a later week", () => {
    // Tue 14 July — a week on. The window should be open even though no weekly
    // hours are set and no override exists for that exact date.
    const nextTue = londonDayStart(0, new Date("2026-07-14T12:00:00Z"));
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      windowStart: nextTue,
      windowEnd: londonDayStart(1, nextTue),
      weeklyHours: [],
      overrides: repeatingOpen,
      busy: [],
      slotMinutes: 30,
      now: at(0),
    });
    expect(slots.map(fmtTime)).toContain("19:00");
    expect(slots.map(fmtTime)).toContain("20:00");
  });

  it("does not apply to other weekdays, or to weeks before it was drawn", () => {
    const wedAfter = londonDayStart(0, new Date("2026-07-08T12:00:00Z")); // Wed
    const tueBefore = londonDayStart(0, new Date("2026-06-30T12:00:00Z")); // Tue, a week earlier
    for (const day of [wedAfter, tueBefore]) {
      const slots = computeAvailableSlots({
        clinic: "waterloo",
        windowStart: day,
        windowEnd: londonDayStart(1, day),
        weeklyHours: [],
        overrides: repeatingOpen,
        busy: [],
        slotMinutes: 30,
        now: at(0),
      });
      expect(slots).toEqual([]);
    }
  });

  it("a repeating block closes that weekday every week", () => {
    const repeatingBlock: OverrideWindow[] = [
      { date: "2026-07-07", kind: "block", startMin: 12 * 60, endMin: 13 * 60, repeatWeekly: true },
    ];
    const nextTue = londonDayStart(0, new Date("2026-07-14T12:00:00Z"));
    const slots = computeAvailableSlots({
      clinic: "waterloo",
      windowStart: nextTue,
      windowEnd: londonDayStart(1, nextTue),
      weeklyHours: [{ weekday: tueWeekday, startMin: 9 * 60, endMin: 17 * 60 }],
      overrides: repeatingBlock,
      busy: [],
      slotMinutes: 30,
      now: at(0),
    });
    expect(slots.map(fmtTime)).not.toContain("12:00");
    expect(slots.map(fmtTime)).toContain("11:00"); // ends 12:00, right up to the block
    expect(slots.map(fmtTime)).toContain("13:00");
  });
});

describe("exact-start windows offer a single pickable slot", () => {
  const run = (overrides: OverrideWindow[], weeklyHours: WeeklyWindow[] = [], busy: { start: Date; end: Date }[] = []) =>
    computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides,
      busy,
      slotMinutes: 30,
      now: at(0),
    }).map(fmtTime);

  it("offers only the start time, not a grid, however long the window is", () => {
    // A two-hour window that, as an open block, would give four starts.
    const exact: OverrideWindow[] = [
      { date: "2026-07-07", kind: "open", startMin: 19 * 60, endMin: 21 * 60, exactStart: true },
    ];
    expect(run(exact)).toEqual(["19:00"]);
  });

  it("two exact slots build a bespoke evening — 19:00 and 20:15 only", () => {
    const exact: OverrideWindow[] = [
      { date: "2026-07-07", kind: "open", startMin: 19 * 60, endMin: 20 * 60, exactStart: true },
      { date: "2026-07-07", kind: "open", startMin: 20 * 60 + 15, endMin: 21 * 60 + 15, exactStart: true },
    ];
    expect(run(exact)).toEqual(["19:00", "20:15"]);
  });

  it("an exact slot inside a block is closed", () => {
    const overrides: OverrideWindow[] = [
      { date: "2026-07-07", kind: "open", startMin: 19 * 60, endMin: 20 * 60, exactStart: true },
      { date: "2026-07-07", kind: "block", startMin: 19 * 60, endMin: 20 * 60 },
    ];
    expect(run(overrides)).toEqual([]);
  });

  it("an exact slot already taken by a booking drops out", () => {
    const exact: OverrideWindow[] = [
      { date: "2026-07-07", kind: "open", startMin: 19 * 60, endMin: 20 * 60, exactStart: true },
    ];
    expect(run(exact, [], [{ start: at(19), end: at(20) }])).toEqual([]);
  });

  it("coexists with open-block windows the same day — daytime grid plus a fixed evening slot", () => {
    const overrides: OverrideWindow[] = [
      { date: "2026-07-07", kind: "open", startMin: 20 * 60, endMin: 21 * 60, exactStart: true },
    ];
    const weekly: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 10 * 60, endMin: 12 * 60 }]; // 10-12 block
    const slots = run(overrides, weekly);
    expect(slots).toEqual(["10:00", "10:30", "11:00", "20:00"]);
  });
});

describe("a deliberately-drawn gap between two windows is respected", () => {
  // Exactly Phoenix's two evening slots: 19:00-20:00 then 20:15-21:15.
  const twoEvenings: WeeklyWindow[] = [
    { weekday: tueWeekday, startMin: 19 * 60, endMin: 20 * 60 },
    { weekday: tueWeekday, startMin: 20 * 60 + 15, endMin: 21 * 60 + 15 },
  ];
  const run = (bufferMinutes: number, busy: { start: Date; end: Date }[] = []) =>
    computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: twoEvenings,
      overrides: [],
      busy,
      slotMinutes: 30,
      bufferMinutes,
      now: at(0),
    }).map(fmtTime);

  it("offers both sessions even with a client gap larger than the drawn gap", () => {
    // The 15-min gap Phoenix drew is his answer; a 30-min slider must not shrink it.
    expect(run(30)).toEqual(["19:00", "20:15"]);
  });

  it("booking the first evening still leaves the second bookable", () => {
    // This is the exact failure mode: 19:00 taken, does 20:15 survive a 30-min gap?
    expect(run(30, [{ start: at(19), end: at(20) }])).toEqual(["20:15"]);
  });

  it("still keeps the gap between two sessions inside one window", () => {
    // 9-11 single window, a booking at 9: the 30-min gap should push the next
    // start out — the default gap still does its job within a window.
    const oneWindow: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 9 * 60, endMin: 11 * 60 }];
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours: oneWindow,
      overrides: [],
      busy: [{ start: at(9), end: at(10) }],
      slotMinutes: 15,
      bufferMinutes: 30,
      now: at(0),
    }).map(fmtTime);
    expect(slots).not.toContain("10:00"); // only 0 min after the 9-10 booking
    expect(slots).not.toContain("10:15"); // only 15 min
    // 10:30 would need to end by 11:00 — it does (10:30-11:30 doesn't fit), so none.
    expect(slots).toEqual([]);
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
    // A wide window (8-14) so there's room either side of the busy span for
    // the collision effect to show up on its own.
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

  it("bufferMinutes never eats into the open window itself — the first and last slot stay bookable", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 660 }]; // 9-11
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      bufferMinutes: 15,
    });
    // The buffer is spacing between sessions, not a reason to open late or
    // close early — 9:00 and 10:00 both still fit the 9-11 window.
    expect(slots).toEqual([at(9), at(9, 30), at(10)]);
  });

  it("a window exactly one session long still works with a buffer set (e.g. a 1-hour evening segment)", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 1080, endMin: 1140 }]; // 18-19
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      bufferMinutes: 15,
    });
    expect(slots).toEqual([at(18)]);
  });

  const weekKey = londonDateKey(londonWeekStart(TUESDAY));
  const cap = (over: Partial<NonNullable<AvailabilityParams["weeklyCap"]>> = {}) => ({
    capMinutes: 600,
    edgeBufferMinutes: 0,
    clusterGapMinutes: 60,
    blockMinutesByWeek: {},
    sessionMinsByDay: {},
    ...over,
  });

  it("weeklyCap excludes a candidate that would push the week's room total past the cap", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      // Already at the 600-min (10 hr) cap this week — one more 60-min block tips it over.
      weeklyCap: cap({ blockMinutesByWeek: { [weekKey]: 600 } }),
    });
    expect(slots).toEqual([]);
  });

  it("weeklyCap still allows a candidate that exactly fills the remaining cap", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      // 540 min held this week — a fresh day adds exactly 60 (no edge padding), reaching 600.
      weeklyCap: cap({ blockMinutesByWeek: { [weekKey]: 540 } }),
    });
    expect(slots).toEqual([at(9)]);
  });

  it("counts room-block time, not sessions: a nearby session extends the block, a distant one starts its own", () => {
    // 9-10 already booked, 60 min of the 600-min cap left, 60-min cluster gap.
    // A 10:00 session clusters back-to-back and adds only its own hour (+60). An
    // 11:00 session still clusters (60-min gap) but extends the block to 9-12
    // (+120) — over. A 14:00 session is past the cluster gap, so it starts a
    // *separate* block costing only its own hour (+60) — the empty gap isn't held.
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 960 }]; // 9-16
    const base = {
      clinic: "bethnal" as const,
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [{ start: at(9), end: at(10) }], // the existing 9-10 session, as busy time
      slotMinutes: 60,
      now: at(0),
    };
    const slots = computeAvailableSlots({
      ...base,
      // 540 of the 600-min cap used; the day already holds a 9-10 block.
      weeklyCap: cap({ blockMinutesByWeek: { [weekKey]: 540 }, sessionMinsByDay: { [londonDateKey(TUESDAY)]: [540] } }),
    }).map(fmtTime);
    expect(slots).toContain("10:00"); // extends block to 9-11: +60, reaches 600 — allowed
    expect(slots).not.toContain("11:00"); // still clusters, extends to 9-12: +120, over the cap
    expect(slots).toContain("14:00"); // past the gap → its own 60-min block, +60 — allowed
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
      weeklyCap: cap({ blockMinutesByWeek: { [otherWeekKey]: 600 } }),
    });
    expect(slots).toEqual([at(9)]);
  });

  it("edge padding is part of the room time — a lone session costs its hour plus both edges", () => {
    const weeklyHours: WeeklyWindow[] = [{ weekday: tueWeekday, startMin: 540, endMin: 600 }]; // 9-10
    // Cap 80 min, 15-min edges: a lone session costs 60 + 2×15 = 90 > 80, so none.
    const slots = computeAvailableSlots({
      clinic: "bethnal",
      ...dayWindow(TUESDAY),
      weeklyHours,
      overrides: [],
      busy: [],
      now: at(0),
      weeklyCap: cap({ capMinutes: 80, edgeBufferMinutes: 15 }),
    });
    expect(slots).toEqual([]);
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

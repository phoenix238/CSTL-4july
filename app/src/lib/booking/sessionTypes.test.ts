import { describe, expect, it } from "vitest";
import {
  blockedRange,
  MAX_SESSION_MINUTES,
  parseSessionType,
  planBookingEvents,
  sessionMinutes,
  sessionPrice,
} from "./rules";
import { chalkFarmCapMinutes, computeAvailableSlots, isSlotAvailable } from "./availability";
import { chalkFarmBlockRanges } from "@/lib/google/chalkFarm";
import { defaultAmountPence, sessionPriceLabel } from "@/lib/account";
import { composeBookingEmail, type EmailSettings } from "./email";
import { fmtTime, londonDayStart, londonTime, londonWeekdayIndex, londonYMD } from "@/lib/time";

// The 90-minute Clean Language + craniosacral session, end to end: what it's
// called, how long it runs, what it costs, and where it fits in the diary.

const TUESDAY = londonDayStart(0, new Date("2026-07-07T12:00:00Z"));
const tueWeekday = londonWeekdayIndex(TUESDAY);
const at = (h: number, m = 0) => {
  const { y, m: mo, d } = londonYMD(TUESDAY);
  return londonTime(y, mo, d, h, m);
};

describe("session types", () => {
  it("defaults anything unknown or missing to the standard 60-minute session", () => {
    expect(parseSessionType(undefined)).toBe("cst");
    expect(parseSessionType("")).toBe("cst");
    expect(parseSessionType("nonsense")).toBe("cst");
    expect(parseSessionType("clean")).toBe("clean");
    expect(sessionMinutes(null)).toBe(60);
    expect(sessionMinutes("clean")).toBe(90);
    expect(MAX_SESSION_MINUTES).toBe(90);
  });

  it("prices the Clean Language session at £120 in Waterloo and £45–75 sliding in Bethnal Green", () => {
    expect(sessionPrice("waterloo", "clean")).toBe("£120");
    expect(sessionPrice("bethnal", "clean")).toBe("£45–75 sliding scale");
    // the standard session is unchanged
    expect(sessionPrice("waterloo", "cst")).toBe("£80");
    expect(sessionPrice("bethnal")).toBe("£30–60 sliding scale");
  });

  it("records £120 up front for a Waterloo Clean Language session, and leaves Bethnal's scale blank", () => {
    expect(defaultAmountPence("waterloo", "clean")).toBe(12000);
    expect(defaultAmountPence("waterloo")).toBe(8000);
    expect(defaultAmountPence("bethnal", "clean")).toBeNull();
    expect(sessionPriceLabel("bethnal", null, "clean")).toBe("£45–75 sliding scale");
    expect(sessionPriceLabel("waterloo", null, "clean")).toBe("£120");
    expect(sessionPriceLabel("waterloo", 5000, "clean")).toBe("£50"); // a recorded amount always wins
  });
});

describe("calendar events for a Clean Language session", () => {
  it("runs every Waterloo event — personal and room — for the full 90 minutes", () => {
    const start = new Date(Date.UTC(2026, 6, 7, 9));
    const plan = planBookingEvents("waterloo", start, "1 Rd", undefined, "clean");
    expect(plan).toHaveLength(2);
    for (const ev of plan) expect(ev.end.getTime() - ev.start.getTime()).toBe(90 * 60_000);
    expect(plan.find((e) => e.calendar === "personal")!.summary).toBe("Clean Language + craniosacral therapy");
  });

  it("keeps the standard session's events exactly as before", () => {
    const start = new Date(Date.UTC(2026, 6, 7, 9));
    const [personal] = planBookingEvents("bethnal", start);
    expect(personal.summary).toBe("Craniosacral therapy");
    expect(personal.end.getTime() - start.getTime()).toBe(60 * 60_000);
  });

  it("blocks out 90 minutes of availability", () => {
    expect(blockedRange("bethnal", at(14), 90)).toEqual({ start: at(14), end: at(15, 30) });
  });

  it("stretches the shared Chalk Farm block to the end of the longer session", () => {
    // 9:00 (90 min, ends 10:30) and 10:30 (60 min) sit back to back → one block.
    const d = (h: number, m = 0) => new Date(`2026-08-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    const ranges = chalkFarmBlockRanges([{ start: d(9), minutes: 90 }, d(10, 30)], 15, 60);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toEqual(d(8, 45));
    expect(ranges[0].end).toEqual(d(11, 45));
  });

  it("ends a block at whichever session finishes last, not whichever starts last", () => {
    const d = (h: number, m = 0) => new Date(`2026-08-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    // A 90-min session at 9:00 ends 10:30, after a 60-min one at 9:15 ends (10:15).
    const [range] = chalkFarmBlockRanges([{ start: d(9), minutes: 90 }, d(9, 15)], 0, 60);
    expect(range.end).toEqual(d(10, 30));
  });
});

describe("availability for a 90-minute session", () => {
  const base = {
    clinic: "bethnal" as const,
    windowStart: TUESDAY,
    windowEnd: londonDayStart(1, TUESDAY),
    overrides: [],
    busy: [],
    slotMinutes: 30,
    now: at(0),
  };

  it("won't offer a Clean Language slot in a window only an hour long", () => {
    const weeklyHours = [{ weekday: tueWeekday, startMin: 18 * 60, endMin: 19 * 60 }];
    expect(computeAvailableSlots({ ...base, weeklyHours }).map(fmtTime)).toEqual(["18:00"]);
    expect(computeAvailableSlots({ ...base, weeklyHours, sessionMinutes: 90 })).toEqual([]);
  });

  it("needs the whole 90 minutes to fit before the day's hours end", () => {
    const weeklyHours = [{ weekday: tueWeekday, startMin: 9 * 60, endMin: 12 * 60 }];
    const slots = computeAvailableSlots({ ...base, weeklyHours, sessionMinutes: 90 }).map(fmtTime);
    expect(slots).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("needs 90 clear minutes before the next busy span", () => {
    const weeklyHours = [{ weekday: tueWeekday, startMin: 9 * 60, endMin: 17 * 60 }];
    const busy = [{ start: at(11), end: at(12) }];
    // 9:30 → 11:00 fits exactly; 10:00 would run into the 11:00 booking.
    expect(isSlotAvailable(at(9, 30), { ...base, weeklyHours, busy, sessionMinutes: 90 })).toBe(true);
    expect(isSlotAvailable(at(10), { ...base, weeklyHours, busy, sessionMinutes: 90 })).toBe(false);
    // …which a standard hour at 10:00 is still fine with.
    expect(isSlotAvailable(at(10), { ...base, weeklyHours, busy })).toBe(true);
  });

  it("counts a Clean Language session as 90 minutes against the weekly Chalk Farm cap", () => {
    expect(chalkFarmCapMinutes([600, { start: 780, minutes: 90 }])).toBe(150);
    const weeklyHours = [{ weekday: tueWeekday, startMin: 9 * 60, endMin: 17 * 60 }];
    const weekKey = "2026-07-06";
    // 60 minutes of budget left: a standard hour fits, a 90-minute session doesn't.
    const weeklyCap = { capMinutes: 600, capMinutesByWeek: { [weekKey]: 540 }, sessionMinsByDay: {} };
    expect(computeAvailableSlots({ ...base, weeklyHours, weeklyCap }).length).toBeGreaterThan(0);
    expect(computeAvailableSlots({ ...base, weeklyHours, weeklyCap, sessionMinutes: 90 })).toEqual([]);
  });
});

describe("the confirmation email for a Clean Language session", () => {
  const settings: EmailSettings = {
    emailTemplateWaterloo: "Hi {name},\n\nIt's {price}.\n\nSee you soon,\nPhoenix",
    emailTemplateBethnal: "Hi {name},\n\nPay what feels fair — {price}.\n\nSee you soon,\nPhoenix",
    accessNote: "",
    paymentDetails: "",
    waterlooAddress: "1 Waterloo Rd, London",
    bethnalAddress: "2 Bethnal Green Rd, London",
  };
  const compose = (clinic: "waterloo" | "bethnal", type?: "cst" | "clean") =>
    composeBookingEmail({ name: "Maya", welcomeSent: false }, clinic, "Tue 7 Jul · 2:00 pm", false, settings, undefined, type);

  it("names the session, says what happens in it, and fills in its own price", () => {
    const email = compose("waterloo", "clean");
    expect(email.subject).toMatch(/Clean Language/);
    expect(email.body).toContain("It's £120.");
    expect(email.body).toMatch(/90-minute Clean Language/);
    expect(email.body).toMatch(/allow the full 90 minutes/);
  });

  it("uses the 90-minute sliding scale at Bethnal Green", () => {
    expect(compose("bethnal", "clean").body).toContain("£45–75 sliding scale");
  });

  it("leaves the standard session's email untouched", () => {
    const email = compose("waterloo");
    expect(email.subject).not.toMatch(/Clean Language/);
    expect(email.body).toContain("It's £80.");
    expect(email.body).not.toMatch(/90-minute/);
  });
});

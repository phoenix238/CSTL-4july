import { describe, expect, it } from "vitest";
import {
  londonAddDays,
  londonDayStart,
  londonWeekStart,
  londonYMD,
  londonMinutes,
  calcAge,
  formatDateInput,
} from "./time";

describe("londonAddDays / londonDayStart (DST-safe)", () => {
  it("advances exactly one London calendar day across the autumn fall-back (25h day)", () => {
    // Sun 26 Oct 2025 is the 25-hour day; a fixed +24h step would land back on the same date.
    const sun = londonDayStart(0, new Date("2025-10-26T12:00:00Z"));
    expect(londonYMD(sun)).toEqual({ y: 2025, m: 10, d: 26 });
    const next = londonAddDays(sun, 1);
    expect(londonYMD(next)).toEqual({ y: 2025, m: 10, d: 27 });
    expect(londonMinutes(next)).toBe(0);
  });

  it("advances exactly one London calendar day across the spring forward (23h day)", () => {
    // Sun 30 Mar 2025 is the 23-hour day.
    const sun = londonDayStart(0, new Date("2025-03-30T12:00:00Z"));
    expect(londonYMD(sun)).toEqual({ y: 2025, m: 3, d: 30 });
    const next = londonAddDays(sun, 1);
    expect(londonYMD(next)).toEqual({ y: 2025, m: 3, d: 31 });
    expect(londonMinutes(next)).toBe(0);
  });

  it("londonDayStart offsets land on the right day across a DST boundary", () => {
    // From Sat 25 Oct 2025, +2 days must be Mon 27 Oct — not Sun again.
    const sat = new Date("2025-10-25T12:00:00Z");
    expect(londonYMD(londonDayStart(2, sat))).toEqual({ y: 2025, m: 10, d: 27 });
    // Negative offsets too: -3 days from Mon 27 Oct is Fri 24 Oct.
    expect(londonYMD(londonDayStart(-3, new Date("2025-10-27T12:00:00Z")))).toEqual({
      y: 2025,
      m: 10,
      d: 24,
    });
  });

  it("stays at 00:00 London and round-trips across a month boundary", () => {
    const start = londonDayStart(0, new Date("2026-01-31T09:00:00Z"));
    const next = londonAddDays(start, 1);
    expect(londonYMD(next)).toEqual({ y: 2026, m: 2, d: 1 });
    expect(londonMinutes(next)).toBe(0);
  });
});

describe("londonWeekStart", () => {
  it("returns the Monday of a mid-week date", () => {
    // Wed 8 July 2026 (BST)
    const wed = new Date("2026-07-08T10:00:00Z");
    const start = londonWeekStart(wed);
    expect(londonYMD(start)).toEqual({ y: 2026, m: 7, d: 6 });
    expect(londonMinutes(start)).toBe(0);
  });

  it("returns the same day for a Monday", () => {
    const mon = new Date("2026-07-06T08:00:00Z");
    expect(londonYMD(londonWeekStart(mon))).toEqual({ y: 2026, m: 7, d: 6 });
  });

  it("handles Sundays (end of the London week)", () => {
    const sun = new Date("2026-07-12T20:00:00Z");
    expect(londonYMD(londonWeekStart(sun))).toEqual({ y: 2026, m: 7, d: 6 });
  });

  it("works across the spring DST switch", () => {
    // Sun 29 Mar 2026, clocks go forward in London — week starts Mon 23 Mar (GMT)
    const dstSunday = new Date("2026-03-29T12:00:00Z");
    const start = londonWeekStart(dstSunday);
    expect(londonYMD(start)).toEqual({ y: 2026, m: 3, d: 23 });
    expect(londonMinutes(start)).toBe(0);
  });

  it("works across the autumn DST switch", () => {
    // Sun 25 Oct 2026, clocks go back — week starts Mon 19 Oct (BST)
    const dstSunday = new Date("2026-10-25T12:00:00Z");
    const start = londonWeekStart(dstSunday);
    expect(londonYMD(start)).toEqual({ y: 2026, m: 10, d: 19 });
    expect(londonMinutes(start)).toBe(0);
  });
});

describe("calcAge", () => {
  const at = new Date("2026-07-06T12:00:00Z");

  it("parses DD/MM/YYYY and computes age when the birthday has passed this year", () => {
    expect(calcAge("14/03/1990", at)).toBe(36);
  });

  it("hasn't had the birthday yet this year", () => {
    expect(calcAge("25/12/1990", at)).toBe(35);
  });

  it("counts the birthday itself as turning that age", () => {
    expect(calcAge("06/07/2000", at)).toBe(26);
  });

  it("parses ISO-style YYYY-MM-DD", () => {
    expect(calcAge("1990-03-14", at)).toBe(36);
  });

  it("returns null for empty or unparseable input", () => {
    expect(calcAge("", at)).toBeNull();
    expect(calcAge("not a date", at)).toBeNull();
  });
});

describe("formatDateInput", () => {
  it("inserts slashes as digits accumulate", () => {
    expect(formatDateInput("1")).toBe("1");
    expect(formatDateInput("14")).toBe("14");
    expect(formatDateInput("1403")).toBe("14/03");
    expect(formatDateInput("14031990")).toBe("14/03/1990");
  });

  it("strips non-digits typed along the way", () => {
    expect(formatDateInput("14/03/1990")).toBe("14/03/1990");
    expect(formatDateInput("14-03-1990")).toBe("14/03/1990");
  });

  it("caps at 8 digits (DDMMYYYY)", () => {
    expect(formatDateInput("140319905678")).toBe("14/03/1990");
  });
});

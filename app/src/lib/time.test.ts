import { describe, expect, it } from "vitest";
import { londonWeekStart, londonYMD, londonMinutes, calcAge, formatDateInput } from "./time";

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

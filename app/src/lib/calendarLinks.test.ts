import { describe, it, expect } from "vitest";
import { buildSessionIcs, toCalendarUTC, sessionLocation } from "./calendarLinks";

describe("toCalendarUTC", () => {
  it("renders a compact UTC stamp", () => {
    expect(toCalendarUTC(new Date("2026-09-02T14:00:00Z"))).toBe("20260902T140000Z");
  });
});

describe("buildSessionIcs", () => {
  const base = {
    uid: "bk1",
    start: new Date("2026-09-02T14:00:00Z"),
    end: new Date("2026-09-02T15:00:00Z"),
    title: "Craniosacral therapy",
    location: "1 Test St, London",
  };

  it("produces a valid VEVENT with CRLF endings and the session times", () => {
    const ics = buildSessionIcs(base, new Date("2026-09-01T00:00:00Z"));
    expect(ics).toContain("\r\n");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:bk1");
    expect(ics).toContain("DTSTART:20260902T140000Z");
    expect(ics).toContain("DTEND:20260902T150000Z");
    expect(ics).toContain("SUMMARY:Craniosacral therapy");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("defaults the end to one session after the start", () => {
    const ics = buildSessionIcs({ uid: "x", start: new Date("2026-09-02T14:00:00Z") });
    expect(ics).toContain("DTEND:20260902T150000Z");
  });

  it("escapes commas and semicolons in text fields", () => {
    const ics = buildSessionIcs({ ...base, location: "Flat 2, London; UK" });
    expect(ics).toContain("LOCATION:Flat 2\\, London\\; UK");
  });

  it("adds one VALARM per chosen lead time", () => {
    const ics = buildSessionIcs({ ...base, reminderLeadDays: [1, 0] });
    expect(ics).toContain("TRIGGER:-P1D");
    // "the morning of" has no whole-day trigger — it becomes an hour before,
    // which fires locally on the client's own calendar regardless of our cron.
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics.match(/BEGIN:VALARM/g)?.length).toBe(2);
  });

  it("carries no alarms when none are chosen", () => {
    const ics = buildSessionIcs(base);
    expect(ics).not.toContain("VALARM");
  });
});

describe("sessionLocation", () => {
  it("uses the address when present", () => {
    expect(sessionLocation("waterloo", " 1 Test St ")).toBe("1 Test St");
  });
  it("falls back to the clinic name", () => {
    expect(sessionLocation("bethnal", "")).toBe("Bethnal Green");
    expect(sessionLocation("waterloo", null)).toBe("Waterloo");
  });
});

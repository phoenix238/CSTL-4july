import { describe, expect, it } from "vitest";
import { composeOfferMessage, composeOfferTimesOnly } from "./offer";
import { fmtDayLong, fmtTime } from "@/lib/time";

describe("composeOfferMessage", () => {
  const t1 = new Date("2026-07-07T14:00:00Z");
  const t2 = new Date("2026-07-08T09:30:00Z");

  it("greets by first name and lists every offered time", () => {
    const msg = composeOfferMessage("Maya Okonkwo", "waterloo", [t2, t1]);
    expect(msg).toContain("Hi Maya,");
    expect(msg).toContain("Waterloo");
    expect(msg).toContain(fmtTime(t1));
    expect(msg).toContain(fmtTime(t2));
  });

  it("sorts times chronologically", () => {
    const msg = composeOfferMessage("Sam", "bethnal", [t2, t1]);
    expect(msg.indexOf(fmtTime(t1))).toBeLessThan(msg.indexOf(fmtTime(t2)));
  });

  it("falls back to 'there' with no name", () => {
    expect(composeOfferMessage("", "waterloo", [t1])).toContain("Hi there,");
  });
});

describe("composeOfferTimesOnly", () => {
  const t1 = new Date("2026-07-07T14:00:00Z");
  const t2 = new Date("2026-07-08T09:30:00Z");

  it("lists only the days and times, one per line, no greeting or blurb", () => {
    const raw = composeOfferTimesOnly([t2, t1]);
    expect(raw).toBe(`${fmtDayLong(t1)} at ${fmtTime(t1)}\n${fmtDayLong(t2)} at ${fmtTime(t2)}`);
    expect(raw).not.toContain("Hi");
    expect(raw).not.toContain("•");
    expect(raw).not.toContain("Phoenix");
  });

  it("sorts times chronologically", () => {
    const raw = composeOfferTimesOnly([t2, t1]);
    expect(raw.indexOf(fmtTime(t1))).toBeLessThan(raw.indexOf(fmtTime(t2)));
  });
});

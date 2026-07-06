import { describe, expect, it } from "vitest";
import { composeOfferMessage } from "./offer";
import { fmtTime } from "@/lib/time";

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

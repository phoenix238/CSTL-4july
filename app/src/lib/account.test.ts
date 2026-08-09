import { describe, it, expect } from "vitest";
import {
  canRescheduleSelf,
  defaultAmountPence,
  formatPence,
  goodwillOpenPence,
  hoursUntil,
  sessionPriceLabel,
  suggestedGoodwillPence,
  summariseAccount,
  type AccountBooking,
} from "./account";

const NOW = new Date("2026-08-09T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function booking(over: Partial<AccountBooking> = {}): AccountBooking {
  return {
    id: "b1",
    startsAt: hoursFromNow(-24),
    clinic: "waterloo",
    status: "confirmed",
    amountPence: 8000,
    paid: false,
    goodwillPence: 0,
    goodwillSettled: false,
    goodwillWaived: false,
    goodwillReason: "",
    ...over,
  };
}

describe("defaultAmountPence", () => {
  it("prices Waterloo at £80", () => {
    expect(defaultAmountPence("waterloo")).toBe(8000);
  });

  it("leaves Bethnal's sliding scale unset rather than guessing", () => {
    expect(defaultAmountPence("bethnal")).toBeNull();
  });
});

describe("summariseAccount", () => {
  it("counts a past unpaid session as owed", () => {
    const s = summariseAccount([booking()], NOW);
    expect(s.completedCount).toBe(1);
    expect(s.unpaidCount).toBe(1);
    expect(s.balancePence).toBe(8000);
  });

  it("counts a paid session as settled and owes nothing", () => {
    const s = summariseAccount([booking({ paid: true })], NOW);
    expect(s.paidCount).toBe(1);
    expect(s.balancePence).toBe(0);
  });

  it("ignores sessions that haven't happened yet", () => {
    const s = summariseAccount([booking({ startsAt: hoursFromNow(48) })], NOW);
    expect(s.completedCount).toBe(0);
    expect(s.balancePence).toBe(0);
  });

  it("ignores cancelled sessions — a session not had is not a session owed", () => {
    const s = summariseAccount([booking({ status: "cancelled" })], NOW);
    expect(s.completedCount).toBe(0);
    expect(s.balancePence).toBe(0);
  });

  it("flags an unpriced sliding-scale session instead of valuing it at zero", () => {
    const s = summariseAccount([booking({ clinic: "bethnal", amountPence: null })], NOW);
    expect(s.unpaidCount).toBe(1);
    expect(s.unpricedCount).toBe(1);
    // Genuinely owed, but not a figure we can invent — so it must not silently
    // inflate or deflate the balance.
    expect(s.balancePence).toBe(0);
  });

  it("keeps goodwill out of the balance entirely — it is an invitation, not a debt", () => {
    const s = summariseAccount(
      [booking({ status: "cancelled", goodwillPence: 1000, goodwillReason: "late_cancel" })],
      NOW,
    );
    expect(s.goodwillPence).toBe(1000);
    expect(s.balancePence).toBe(0);
  });

  it("drops goodwill once given or waived", () => {
    const given = summariseAccount([booking({ goodwillPence: 1000, goodwillSettled: true })], NOW);
    expect(given.goodwillPence).toBe(0);
    const waived = summariseAccount([booking({ goodwillPence: 1000, goodwillWaived: true })], NOW);
    expect(waived.goodwillPence).toBe(0);
  });

  it("totals a mixed history", () => {
    const s = summariseAccount(
      [
        booking({ id: "a", paid: true }),
        booking({ id: "b", startsAt: hoursFromNow(-48) }),
        booking({ id: "c", startsAt: hoursFromNow(72) }),
        booking({ id: "d", status: "cancelled", goodwillPence: 1000 }),
      ],
      NOW,
    );
    expect(s.completedCount).toBe(2);
    expect(s.paidCount).toBe(1);
    expect(s.unpaidCount).toBe(1);
    expect(s.balancePence).toBe(8000);
    expect(s.goodwillPence).toBe(1000);
  });
});

describe("goodwillOpenPence", () => {
  it("is zero when nothing was suggested", () => {
    expect(goodwillOpenPence(booking())).toBe(0);
  });

  it("is the suggested amount while it's outstanding", () => {
    expect(goodwillOpenPence(booking({ goodwillPence: 1000 }))).toBe(1000);
  });
});

describe("notice period", () => {
  it("measures hours until a session, fractionally", () => {
    expect(hoursUntil(hoursFromNow(23.5), NOW)).toBeCloseTo(23.5);
  });

  it("allows a self-reschedule with full notice", () => {
    expect(canRescheduleSelf(hoursFromNow(25), 24, NOW)).toBe(true);
  });

  it("blocks a self-reschedule inside the window, including just inside", () => {
    expect(canRescheduleSelf(hoursFromNow(23.9), 24, NOW)).toBe(false);
  });

  it("treats exactly the notice period as enough", () => {
    expect(canRescheduleSelf(hoursFromNow(24), 24, NOW)).toBe(true);
  });
});

describe("suggestedGoodwillPence", () => {
  it("suggests nothing when they gave enough notice", () => {
    expect(suggestedGoodwillPence(hoursFromNow(48), 24, 1000, NOW)).toBe(0);
  });

  it("suggests a contribution inside the window", () => {
    expect(suggestedGoodwillPence(hoursFromNow(3), 24, 1000, NOW)).toBe(1000);
  });

  it("suggests nothing when the amount is switched off", () => {
    expect(suggestedGoodwillPence(hoursFromNow(3), 24, 0, NOW)).toBe(0);
  });
});

describe("sessionPriceLabel", () => {
  it("shows Waterloo's fixed price", () => {
    expect(sessionPriceLabel("waterloo", null)).toBe("£80");
  });

  it("shows Bethnal's scale rather than naming an amount", () => {
    expect(sessionPriceLabel("bethnal", null)).toBe("£30–60 sliding scale");
  });

  it("prefers what was actually recorded", () => {
    expect(sessionPriceLabel("bethnal", 4500)).toBe("£45");
    expect(sessionPriceLabel("waterloo", 6000)).toBe("£60");
  });

  it("shows a recorded zero as £0, not as the standard price", () => {
    // Someone who genuinely paid nothing is not someone who owes £80.
    expect(sessionPriceLabel("waterloo", 0)).toBe("£0");
  });
});

describe("formatPence", () => {
  it("drops the decimals on a whole number of pounds", () => {
    expect(formatPence(8000)).toBe("£80");
  });

  it("keeps them otherwise", () => {
    expect(formatPence(1250)).toBe("£12.50");
  });
});

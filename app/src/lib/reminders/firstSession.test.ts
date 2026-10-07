import { describe, it, expect } from "vitest";
import { composeFirstSessionEmail, firstSessionEmailDue } from "./firstSession";
import { composeNoShowEmail } from "@/lib/noShow";
import { cancellationPolicyText } from "@/lib/account";
import { CLIENT_COPY_DEFAULTS } from "@/lib/clientCopy";

const copy = CLIENT_COPY_DEFAULTS;
const space = { name: "Garden Room", address: "3 Lane, Bristol", mapUrl: "https://maps.app.goo.gl/x", findIt: "Side gate" };
const base = {
  clientFirstName: "Maya",
  whenLabel: "Thu 9 Oct · 14:00",
  space,
  intakeLink: "https://app/intake/t",
  portalLink: "https://app/me/t",
  remindersLink: "https://app/me/t#reminders",
  offerReminders: false,
};

describe("composeFirstSessionEmail", () => {
  it("asks for the intake form — and says it can be done in the session — when it isn't done", () => {
    const { subject, body } = composeFirstSessionEmail({ ...base, intakeDone: false }, copy, "Warmly,\nEmily");
    expect(subject).toBe("Looking forward to meeting you — Thu 9 Oct · 14:00");
    expect(body).toContain("Looking forward to meeting you for our first session: Thu 9 Oct · 14:00 at Garden Room");
    expect(body).toContain("haven't filled in your intake form");
    expect(body).toContain("https://app/intake/t");
    expect(body).toContain("we can go through it together");
  });

  it("just says hello when the intake form is done — no form link", () => {
    const { body } = composeFirstSessionEmail({ ...base, intakeDone: true }, copy, "Warmly,\nEmily");
    expect(body).toContain("Thank you for filling in your intake form");
    expect(body).not.toContain("https://app/intake/t");
  });

  it("gives the address, map, how to find the door and their page, then signs off once", () => {
    const { body } = composeFirstSessionEmail({ ...base, intakeDone: true }, copy, "Warmly,\nEmily");
    for (const part of ["3 Lane, Bristol", "https://maps.app.goo.gl/x", "Side gate", "https://app/me/t"]) {
      expect(body).toContain(part);
    }
    expect(body.trimEnd().endsWith("Warmly,\nEmily")).toBe(true);
  });

  it("offers reminders, linking to the ticks on their page, only to someone without any", () => {
    const off = composeFirstSessionEmail({ ...base, intakeDone: true, offerReminders: true }, copy, "x").body;
    const on = composeFirstSessionEmail({ ...base, intakeDone: true, offerReminders: false }, copy, "x").body;
    expect(off).toContain("https://app/me/t#reminders");
    expect(on).not.toContain("#reminders");
  });
});

describe("firstSessionEmailDue", () => {
  // 08:00 London time on Wed 8 Oct 2026 (BST) = 07:00 UTC
  const asOf = new Date("2026-10-08T07:00:00Z");
  const bookedLastWeek = new Date("2026-10-01T10:00:00Z");

  it("is due the day before the session", () => {
    expect(
      firstSessionEmailDue({ startsAt: new Date("2026-10-09T13:00:00Z"), createdAt: bookedLastWeek, firstSessionEmailSentAt: null }, asOf),
    ).toBe(true);
  });

  it("falls back to the morning of, for a booking made too late for the day before", () => {
    const bookedYesterdayEvening = new Date("2026-10-07T19:00:00Z");
    expect(
      firstSessionEmailDue(
        { startsAt: new Date("2026-10-08T15:00:00Z"), createdAt: bookedYesterdayEvening, firstSessionEmailSentAt: null },
        asOf,
      ),
    ).toBe(true);
  });

  it("isn't sent for a session booked the same day — the confirmation has only just gone", () => {
    const bookedThisMorning = new Date("2026-10-08T06:30:00Z");
    expect(
      firstSessionEmailDue(
        { startsAt: new Date("2026-10-08T15:00:00Z"), createdAt: bookedThisMorning, firstSessionEmailSentAt: null },
        asOf,
      ),
    ).toBe(false);
  });

  it("is never sent twice, nor for a session two days off or already past", () => {
    const sent = new Date("2026-10-08T06:00:00Z");
    expect(firstSessionEmailDue({ startsAt: new Date("2026-10-09T13:00:00Z"), createdAt: bookedLastWeek, firstSessionEmailSentAt: sent }, asOf)).toBe(false);
    expect(firstSessionEmailDue({ startsAt: new Date("2026-10-10T13:00:00Z"), createdAt: bookedLastWeek, firstSessionEmailSentAt: null }, asOf)).toBe(false);
    expect(firstSessionEmailDue({ startsAt: new Date("2026-10-08T06:00:00Z"), createdAt: bookedLastWeek, firstSessionEmailSentAt: null }, asOf)).toBe(false);
  });
});

describe("cancellationPolicyText", () => {
  it("names the notice and the contribution", () => {
    const text = cancellationPolicyText(copy, 24, 1000);
    expect(text).toContain("up to 24 hours before");
    expect(text).toContain("£10 contribution");
    expect(text).toContain("missed");
  });

  it("says nothing when no contribution is set", () => {
    expect(cancellationPolicyText(copy, 24, 0)).toBe("");
  });
});

describe("composeNoShowEmail", () => {
  const input = {
    clientFirstName: "Maya",
    whenLabel: "Wed 8 Oct · 10:00",
    clinicName: "Garden Room",
    contributionPence: 1000,
    paymentRef: "MAYA-4K2",
    portalLink: "https://app/me/t",
  };

  it("is kind, names the contribution and the reference, and invites a rebook", () => {
    const { subject, body } = composeNoShowEmail(input, copy, "Warmly,\nEmily");
    expect(subject).toBe("Sorry we missed you");
    expect(body).toContain("Wed 8 Oct · 10:00 at Garden Room");
    expect(body).toContain("£10 contribution");
    expect(body).toContain("MAYA-4K2");
    expect(body).toContain("https://app/me/t");
    expect(body.trimEnd().endsWith("Warmly,\nEmily")).toBe(true);
  });

  it("leaves the contribution out entirely when none is set", () => {
    const { body } = composeNoShowEmail({ ...input, contributionPence: 0 }, copy, "x");
    expect(body).not.toContain("contribution");
    expect(body).not.toContain("MAYA-4K2");
  });
});

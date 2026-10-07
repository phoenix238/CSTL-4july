import { describe, it, expect } from "vitest";
import { fillIdentity, practitionerIdentity } from "./practitioner";
import { CLIENT_COPY_KEYS, applyCopyOptional, resolveClientCopy } from "./clientCopy";
import { composeBookingEmail, type EmailSettings } from "./booking/email";
import { composeBookingPageEmail } from "./bookingPageEmail";
import { composePaymentReminder } from "./payments/unpaid";

// A second practitioner, set up the way Emily would be: her name in Settings ›
// Your details, everything else left at the built-in wording.
const EMILY = { practitionerName: "Emily", practitionerFullName: "Emily Yung", practiceName: "Emily Yung Bodywork" };

describe("practitionerIdentity", () => {
  it("falls back to the original practice when nothing is set", () => {
    expect(practitionerIdentity({})).toEqual({
      yourName: "Phoenix",
      yourFullName: "Phoenix",
      practiceName: "Phoenix",
    });
  });

  it("fills only the identity placeholders and leaves the rest for the composer", () => {
    expect(fillIdentity("Hi {name}, love {yourName} at {practiceName}", practitionerIdentity(EMILY))).toBe(
      "Hi {name}, love Emily at Emily Yung Bodywork",
    );
  });
});

describe("resolveClientCopy with a second practitioner", () => {
  it("puts her name in every built-in message — never Phoenix's", () => {
    const copy = resolveClientCopy(null, practitionerIdentity(EMILY));
    for (const key of CLIENT_COPY_KEYS) {
      expect(copy[key], key).not.toMatch(/phoenix/i);
      expect(copy[key], key).not.toMatch(/\{your(Full)?Name\}|\{practiceName\}/);
    }
    expect(copy.intakeEmailSubject).toBe("Your intake form — Emily Yung Bodywork");
    expect(copy.receiptEmailIntro).toContain("Emily Yung");
  });

  it("leaves placeholders visible for the Settings editor when no identity is passed", () => {
    expect(resolveClientCopy(null).intakeEmailSubject).toBe("Your intake form — {practiceName}");
  });

  it("fills her own edited wording too", () => {
    const copy = resolveClientCopy({ cancelEmailBody: "Hi {name}, sorry — {yourName}" }, practitionerIdentity(EMILY));
    expect(copy.cancelEmailBody).toBe("Hi {name}, sorry — Emily");
  });
});

describe("applyCopyOptional", () => {
  it("drops a line whose placeholder has nothing to fill it", () => {
    const out = applyCopyOptional("Moved to {when}.\n\n(Previously {previousWhen}.)", {
      when: "Fri",
      previousWhen: "",
    });
    expect(out).toBe("Moved to Fri.");
  });

  it("keeps the line when there is a value", () => {
    expect(applyCopyOptional("Ref: {paymentRef}", { paymentRef: "MAYA-4K2" })).toBe("Ref: MAYA-4K2");
  });
});

describe("booking confirmation for a second practitioner", () => {
  const settings: EmailSettings = {
    ...EMILY,
    emailTemplate: "Hi {name},\n\nSee you {when}.\n\nWarmly,\nEmily",
    emailSignOff: "Warmly,\n{yourName}",
    accessNote: "",
    paymentDetails: "",
    waterlooAddress: "1 Waterloo Rd",
    bethnalAddress: "2 Bethnal Green Rd",
  };
  const email = composeBookingEmail({ name: "Maya", welcomeSent: false }, "waterloo", "Tue 5 Aug · 3:00 pm", false, settings, {
    intakeLink: "https://x/intake/t",
    portalLink: "https://x/me/t",
    paymentRef: "MAYA-1",
  });
  const sent = fillIdentity(email.body, practitionerIdentity(settings));

  it("lifts a sign-off ending in HER name out of the letter, so it ends once", () => {
    expect(sent.match(/Warmly,/g)?.length).toBe(1);
    expect(sent.trimEnd().endsWith("Warmly,\nEmily")).toBe(true);
  });

  it("has no trace of Phoenix", () => {
    expect(sent).not.toMatch(/phoenix/i);
  });

  it("uses an edited subject line", () => {
    const custom = composeBookingEmail({ name: "Maya", welcomeSent: true }, "waterloo", "Tue", false, {
      ...settings,
      clientCopy: { bookingEmailSubject: "See you {when} at {clinic}" },
    });
    expect(custom.subject).toBe("See you Tue at Waterloo");
  });
});

describe("emails that used to be hardcoded", () => {
  it("the booking-page email uses the editable wording and her sign-off", () => {
    const { subject, body } = composeBookingPageEmail(
      { ...EMILY, emailSignOff: "Love,\nEmily", clientCopy: { bookingPageEmailSubject: "Your page with Emily" } },
      { clientName: "Maya Sample", link: "https://x/me/t" },
    );
    expect(subject).toBe("Your page with Emily");
    expect(body).toContain("https://x/me/t");
    expect(body.trimEnd().endsWith("Love,\nEmily")).toBe(true);
    expect(body).not.toMatch(/phoenix|warm wishes/i);
  });

  it("the booking-page email adds bank details only when sent with a reference", () => {
    const bank = { bankAccountName: "E Yung", bankSortCode: "11-22-33", bankAccountNumber: "12345678" };
    const withRef = composeBookingPageEmail({ ...EMILY, ...bank }, { clientName: "Maya", link: "l", paymentRef: "MAYA-1" });
    const without = composeBookingPageEmail({ ...EMILY, ...bank }, { clientName: "Maya", link: "l" });
    expect(withRef.body).toContain("Reference: MAYA-1");
    expect(without.body).not.toContain("11-22-33");
  });

  it("the payment reminder uses the editable wording", () => {
    const { subject, body } = composePaymentReminder(
      { ...EMILY, emailSignOff: "Emily", clientCopy: { paymentReminderSubject: "A note from Emily" } },
      { clientName: "Maya Sample", whenLabel: "Tue 5 Aug", clinic: "waterloo" },
    );
    expect(subject).toBe("A note from Emily");
    expect(body.startsWith("Hi Maya,")).toBe(true);
    expect(body).toContain("Tue 5 Aug");
  });
});

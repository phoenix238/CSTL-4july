import { describe, it, expect } from "vitest";
import { composeBookingEmail, type EmailSettings } from "./email";

const settings: EmailSettings = {
  emailTemplateWaterloo: "Hi {name},\n\nWelcome to Waterloo.\n\n{accessNote}\n\nPhoenix",
  emailTemplateBethnal: "Hi {name},\n\nWelcome to Bethnal Green.\n\n{accessNote}\n\nPhoenix",
  accessNote: "There are stairs — please let me know about access needs.",
  paymentDetails: "Bank: 12-34-56 / 12345678",
  waterlooAddress: "1 Waterloo Rd, London",
  bethnalAddress: "2 Bethnal Green Rd, London",
};

describe("composeBookingEmail", () => {
  it("keeps the intake form OUT of a new client's first (welcome) email", () => {
    const email = composeBookingEmail(
      { name: "Maya Okonkwo", welcomeSent: false },
      "waterloo",
      "Tue 5 Aug · 3:00 pm",
      true,
      settings,
    );
    // The welcome email is warm and uncluttered — no intake link, ever.
    expect(email.body.toLowerCase()).not.toContain("intake");
    expect(email.includes.join(" ").toLowerCase()).not.toContain("intake");
    // But it still carries the welcome essentials.
    expect(email.body).toContain("Maya");
    expect(email.body).toContain(settings.accessNote);
    expect(email.body).toContain(settings.waterlooAddress);
    expect(email.body).toContain(settings.paymentDetails);
  });

  it("omits payment details when sendPayment is false", () => {
    const email = composeBookingEmail(
      { name: "Sam", welcomeSent: false },
      "bethnal",
      "Wed · 10:00 am",
      false,
      settings,
    );
    expect(email.body).not.toContain(settings.paymentDetails);
    expect(email.body.toLowerCase()).not.toContain("intake");
  });

  it("sends a returning client just a short confirmation, no intake", () => {
    const email = composeBookingEmail(
      { name: "Maya", welcomeSent: true },
      "waterloo",
      "Tue 5 Aug · 3:00 pm",
      true,
      settings,
    );
    expect(email.body).toContain("confirming your next session");
    expect(email.body.toLowerCase()).not.toContain("intake");
    expect(email.body).not.toContain(settings.paymentDetails);
  });
});

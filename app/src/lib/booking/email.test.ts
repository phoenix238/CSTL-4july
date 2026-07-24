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

const INTAKE_LINK = "https://cstl.example/intake/tok-123";

describe("composeBookingEmail", () => {
  it("folds the intake link INTO a new client's first (welcome) email", () => {
    const email = composeBookingEmail(
      { name: "Maya Okonkwo", welcomeSent: false },
      "waterloo",
      "Tue 5 Aug · 3:00 pm",
      true,
      settings,
      INTAKE_LINK,
    );
    // The welcome email now carries the intake link, so it's one message not two.
    expect(email.body).toContain(INTAKE_LINK);
    expect(email.includes.join(" ").toLowerCase()).toContain("intake");
    // And it still carries the welcome essentials.
    expect(email.body).toContain("Maya");
    expect(email.body).toContain(settings.accessNote);
    expect(email.body).toContain(settings.waterlooAddress);
    expect(email.body).toContain(settings.paymentDetails);
  });

  it("uses a template's {intakeLink} placeholder in place, without appending a duplicate", () => {
    const withPlaceholder: EmailSettings = {
      ...settings,
      emailTemplateWaterloo: "Hi {name},\n\n{accessNote}\n\nForm: {intakeLink}\n\nPhoenix",
    };
    const email = composeBookingEmail(
      { name: "Maya", welcomeSent: false },
      "waterloo",
      "Tue 5 Aug · 3:00 pm",
      false,
      withPlaceholder,
      INTAKE_LINK,
    );
    expect(email.body).toContain(`Form: ${INTAKE_LINK}`);
    // Positioned by the placeholder → appears exactly once.
    expect(email.body.split(INTAKE_LINK).length - 1).toBe(1);
  });

  it("falls back to a placeholder link string when none is passed (browser preview)", () => {
    const email = composeBookingEmail(
      { name: "Sam", welcomeSent: false },
      "bethnal",
      "Wed · 10:00 am",
      false,
      settings,
    );
    expect(email.body).toContain("(your personal intake link)");
  });

  it("omits payment details when sendPayment is false", () => {
    const email = composeBookingEmail(
      { name: "Sam", welcomeSent: false },
      "bethnal",
      "Wed · 10:00 am",
      false,
      settings,
      INTAKE_LINK,
    );
    expect(email.body).not.toContain(settings.paymentDetails);
    expect(email.body).toContain(INTAKE_LINK);
  });

  it("sends a returning client just a short confirmation, no intake", () => {
    const email = composeBookingEmail(
      { name: "Maya", welcomeSent: true },
      "waterloo",
      "Tue 5 Aug · 3:00 pm",
      true,
      settings,
      INTAKE_LINK,
    );
    expect(email.body).toContain("confirming your next session");
    expect(email.body).not.toContain(INTAKE_LINK);
    expect(email.body).not.toContain(settings.paymentDetails);
  });
});

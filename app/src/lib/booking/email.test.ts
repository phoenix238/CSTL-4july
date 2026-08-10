import { describe, it, expect } from "vitest";
import { composeBookingEmail, type EmailSettings } from "./email";

const settings: EmailSettings = {
  emailTemplateWaterloo: "Hi {name},\n\nWelcome to Waterloo.\n\n{accessNote}\n\nSee you soon,\nPhoenix",
  emailTemplateBethnal: "Hi {name},\n\nWelcome to Bethnal Green.\n\n{accessNote}\n\nSee you soon,\nPhoenix",
  accessNote: "There are stairs — please let me know about access needs.",
  paymentDetails: "Bank: 12-34-56 / 12345678",
  waterlooAddress: "1 Waterloo Rd, London",
  bethnalAddress: "2 Bethnal Green Rd, London",
  waterlooLocationUrl: "https://maps.app.goo.gl/waterloo",
  waterlooDirections: "Blue door, buzzer 4.",
};

const INTAKE_LINK = "https://cstl.example/intake/tok-123";

const compose = (over: Partial<EmailSettings> = {}, welcomeSent = false, sendPayment = true) =>
  composeBookingEmail(
    { name: "Maya Okonkwo", welcomeSent },
    "waterloo",
    "Tue 5 Aug · 3:00 pm",
    sendPayment,
    { ...settings, ...over },
    INTAKE_LINK,
  );

describe("composeBookingEmail", () => {
  it("folds the intake link INTO a new client's first (welcome) email", () => {
    const email = compose();
    expect(email.body).toContain(INTAKE_LINK);
    expect(email.includes.join(" ").toLowerCase()).toContain("intake");
    expect(email.body).toContain("Maya");
    expect(email.body).toContain(settings.accessNote);
    expect(email.body).toContain(settings.waterlooAddress);
    expect(email.body).toContain(settings.paymentDetails);
  });

  it("signs off once, at the very end", () => {
    // The template ends with a sign-off, and the composer used to append the
    // address and payment details after it — so the email signed off halfway
    // down and then carried on.
    const body = compose().body;
    expect(body.trimEnd().endsWith("See you soon,\nPhoenix")).toBe(true);
    expect(body.split("See you soon,").length - 1).toBe(1);
    // Everything factual sits above the signature.
    expect(body.indexOf(settings.waterlooAddress)).toBeLessThan(body.indexOf("See you soon,"));
    expect(body.indexOf(settings.paymentDetails)).toBeLessThan(body.indexOf("See you soon,"));
  });

  it("uses the map pin from Settings rather than a generated Maps search link", () => {
    const body = compose().body;
    expect(body).toContain("https://maps.app.goo.gl/waterloo");
    expect(body).not.toContain("maps/search");
    // …and the address is right above it, as one block rather than two labelled lines.
    expect(body).toContain(`${settings.waterlooAddress}\nhttps://maps.app.goo.gl/waterloo`);
  });

  it("falls back to a Maps search link only when no pin has been set", () => {
    const body = compose({ waterlooLocationUrl: "" }).body;
    expect(body).toContain("maps/search");
    expect(body).toContain(settings.waterlooAddress);
  });

  it("includes how to find the door", () => {
    expect(compose().body).toContain("Blue door, buzzer 4.");
  });

  it("uses a template's {intakeLink} placeholder in place, without appending a duplicate", () => {
    const email = compose({
      emailTemplateWaterloo: "Hi {name},\n\n{accessNote}\n\nForm: {intakeLink}\n\nSee you soon,\nPhoenix",
    });
    expect(email.body).toContain(`Form: ${INTAKE_LINK}`);
    expect(email.body.split(INTAKE_LINK).length - 1).toBe(1);
  });

  it("fills {when} so the template can put the date in the body, not just the subject", () => {
    const email = compose({ emailTemplateWaterloo: "Hi {name},\n\nYou're booked for {when}.\n\nSee you soon,\nPhoenix" });
    expect(email.body).toContain("You're booked for Tue 5 Aug · 3:00 pm.");
  });

  it("falls back to a placeholder link string when none is passed (browser preview)", () => {
    const email = composeBookingEmail({ name: "Sam", welcomeSent: false }, "bethnal", "Wed · 10:00 am", false, settings);
    expect(email.body).toContain("(your personal intake link)");
  });

  it("omits payment details when sendPayment is false", () => {
    const email = compose({}, false, false);
    expect(email.body).not.toContain(settings.paymentDetails);
    expect(email.body).toContain(INTAKE_LINK);
  });

  it("sends a returning client a short confirmation with the time and how to get there, no intake", () => {
    const email = compose({}, true);
    expect(email.body).toContain("confirming your next session");
    expect(email.body).toContain("Tue 5 Aug · 3:00 pm");
    expect(email.body).toContain(settings.waterlooAddress);
    expect(email.body).toContain("https://maps.app.goo.gl/waterloo");
    expect(email.body).not.toContain(INTAKE_LINK);
    expect(email.body).not.toContain(settings.paymentDetails);
  });
});

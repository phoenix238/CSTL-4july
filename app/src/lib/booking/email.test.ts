import { describe, it, expect } from "vitest";
import { composeBookingEmail, fillPreviewLinks, type EmailSettings } from "./email";

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
const PORTAL_LINK = "https://cstl.example/me/tok-abc";
const PAYMENT_REF = "MO7";

const compose = (over: Partial<EmailSettings> = {}, welcomeSent = false, sendPayment = true) =>
  composeBookingEmail(
    { name: "Maya Okonkwo", welcomeSent },
    "waterloo",
    "Tue 5 Aug · 3:00 pm",
    sendPayment,
    { ...settings, ...over },
    { intakeLink: INTAKE_LINK, portalLink: PORTAL_LINK, paymentRef: PAYMENT_REF },
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

  it("uses the one shared letter for both clinics, filling in {clinic} and {price}", () => {
    const shared: EmailSettings = {
      ...settings,
      emailTemplate: "Hi {name},\n\nBooked for {when} at {clinic} — {price}.\n\nSee you soon,\nPhoenix",
    };
    const w = composeBookingEmail({ name: "Maya", welcomeSent: false }, "waterloo", "Tue 5 Aug", true, shared);
    const b = composeBookingEmail({ name: "Maya", welcomeSent: false }, "bethnal", "Tue 5 Aug", true, shared);
    expect(w.body).toContain("at Waterloo — £80.");
    expect(b.body).toContain("at Bethnal Green — £30–60 sliding scale.");
    // …and each still gets its own address, so one letter doesn't mean one clinic.
    expect(w.body).toContain(settings.waterlooAddress);
    expect(b.body).toContain(settings.bethnalAddress);
  });

  it("falls back to the old per-clinic letter until the shared one is saved", () => {
    // Existing wording has to keep working untouched — an empty shared template
    // must not mean an empty email.
    const email = compose({ emailTemplate: "" });
    expect(email.body).toContain("Welcome to Waterloo.");
  });

  it("falls back to the old directions/arrival-note pair until the merged field is saved", () => {
    const email = compose({
      waterlooFindIt: "",
      waterlooDirections: "Blue door, buzzer 4.",
      waterlooArrivalNote: "Parking on the street after 6pm.",
    });
    expect(email.body).toContain("Blue door, buzzer 4.");
    expect(email.body).toContain("Parking on the street after 6pm.");
  });

  it("prefers the merged how-to-find-it field once it's set", () => {
    const email = compose({
      waterlooFindIt: "Green door, second floor.",
      waterlooDirections: "OLD directions",
      waterlooArrivalNote: "OLD note",
    });
    expect(email.body).toContain("Green door, second floor.");
    expect(email.body).not.toContain("OLD");
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

  // — The first email is the only one a new client should need —

  it("gives a new client their booking page, described by what it's for", () => {
    const email = compose();
    expect(email.body).toContain(PORTAL_LINK);
    expect(email.body).toContain("Book your next session from there");
    expect(email.includes.join(" ")).toContain("booking page");
  });

  it("carries the bank details and their own payment reference", () => {
    const email = compose({
      bankAccountName: "P Tanner",
      bankSortCode: "12-34-56",
      bankAccountNumber: "12345678",
      bankPaymentNote: "Cash is fine too.",
    });
    expect(email.body).toContain("Account name: P Tanner");
    expect(email.body).toContain("Sort code: 12-34-56");
    expect(email.body).toContain(`Reference: ${PAYMENT_REF}`);
    expect(email.body).toContain("Cash is fine too.");
  });

  it("puts everything a new client needs above one sign-off", () => {
    // The whole point of folding the welcome, the booking-page email and the
    // intake email into one message: all of it in a single letter, signed once.
    const body = compose({ bankAccountName: "P Tanner" }).body;
    for (const part of [settings.waterlooAddress, settings.paymentDetails, PORTAL_LINK, INTAKE_LINK]) {
      expect(body.indexOf(part)).toBeGreaterThan(-1);
      expect(body.indexOf(part)).toBeLessThan(body.indexOf("See you soon,"));
    }
    expect(body.split("See you soon,").length - 1).toBe(1);
  });

  it("doesn't repeat the booking page when the template already places it", () => {
    const email = compose({
      emailTemplate: "Hi {name},\n\nYour page: {portalLink}\n\nSee you soon,\nPhoenix",
    });
    expect(email.body.split(PORTAL_LINK).length - 1).toBe(1);
  });

  it("sends a returning client no booking page, payment details or reference — just the confirmation", () => {
    // A rebooking that repeats the whole welcome is a rebooking people skim,
    // and the address is the part they actually needed.
    const email = compose({ bankAccountName: "P Tanner" }, true);
    expect(email.body).not.toContain(PORTAL_LINK);
    expect(email.body).not.toContain(PAYMENT_REF);
    expect(email.body).not.toContain("Account name");
  });

  it("leaves the payment block out entirely when there's nothing to say", () => {
    const email = composeBookingEmail(
      { name: "Maya", welcomeSent: false },
      "waterloo",
      "Tue 5 Aug",
      true,
      { ...settings, paymentDetails: "" },
      { intakeLink: INTAKE_LINK },
    );
    expect(email.includes.join(" ")).not.toContain("Payment details");
    expect(email.body).not.toContain("For bank transfers");
  });

  it("still sends the reference when the payment wording is blank — it's the part that has to travel", () => {
    const email = compose({ paymentDetails: "", bankAccountNumber: "12345678" });
    expect(email.body).toContain(`Reference: ${PAYMENT_REF}`);
  });
});

describe("fillPreviewLinks", () => {
  // The booking panel previews the email before the client's tokens exist, and
  // sends whatever is in that box — so an unsubstituted preview was emailing
  // clients the literal words "(your personal intake link)".
  it("swaps the preview placeholders for the real links", () => {
    const preview = composeBookingEmail({ name: "Sam", welcomeSent: false }, "bethnal", "Wed · 10:00 am", true, settings);
    const sent = fillPreviewLinks(preview.body, {
      intakeLink: INTAKE_LINK,
      portalLink: PORTAL_LINK,
      paymentRef: PAYMENT_REF,
    });
    expect(sent).toContain(INTAKE_LINK);
    expect(sent).toContain(PORTAL_LINK);
    expect(sent).not.toContain("(your personal");
    expect(sent).not.toContain("(your payment reference)");
  });
});

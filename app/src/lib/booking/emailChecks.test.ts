import { describe, it, expect } from "vitest";
import { checkEmail } from "./emailChecks";
import { composeBookingEmail, type EmailSettings } from "./email";

const baseSettings: EmailSettings = {
  emailTemplate: "Hi {name},\n\nYou're booked for {when} at {clinic} — {price}.\n\n{accessNote}",
  emailSignOff: "with gratitude\nPhoenix",
  accessNote: "There are stairs — please let me know about access needs.",
  paymentDetails: "You can pay on the day by card, or by bank transfer using the details below.",
  waterlooAddress: "1 Waterloo Rd, London",
  bethnalAddress: "2 Bethnal Green Rd, London",
  waterlooLocationUrl: "https://maps.app.goo.gl/waterloo",
  bethnalLocationUrl: "https://maps.app.goo.gl/bethnal",
  waterlooFindIt: "Blue door, buzzer 4.",
  bethnalFindIt: "Green door, second floor.",
};

const links = {
  intakeLink: "https://cstl.example/intake/tok-123",
  portalLink: "https://cstl.example/me/tok-abc",
  paymentRef: "MO7",
};

const compose = (over: Partial<EmailSettings> = {}) =>
  composeBookingEmail({ name: "Maya", welcomeSent: false }, "bethnal", "Tue 5 Aug · 3:00 pm", true, { ...baseSettings, ...over }, links);

describe("checkEmail", () => {
  it("finds nothing wrong with a clean composed email", () => {
    const email = compose();
    expect(checkEmail(email.blocks, { ...baseSettings })).toEqual([]);
  });

  it("catches the original bug: a map link pasted into the access note duplicates the automatic one", () => {
    const email = compose({
      accessNote:
        "My treatment space has no step-free access at either location — there are stairs.\n\nhttps://maps.app.goo.gl/bethnal",
    });
    const issues = checkEmail(email.blocks, {
      ...baseSettings,
      accessNote:
        "My treatment space has no step-free access at either location — there are stairs.\n\nhttps://maps.app.goo.gl/bethnal",
    });
    const dup = issues.find((i) => i.message.includes("appears"));
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe("problem");
    expect(dup?.message).toContain("https://maps.app.goo.gl/bethnal");
  });

  it("flags a map pin with no address above it", () => {
    const email = compose({ bethnalAddress: "" });
    const issues = checkEmail(email.blocks, { ...baseSettings, bethnalAddress: "" });
    expect(issues.some((i) => i.message.includes("Bethnal Green has a map link but no address"))).toBe(true);
  });

  it("suggests setting a map pin when none is set, without calling it a problem", () => {
    const email = compose({ bethnalLocationUrl: "" });
    const issues = checkEmail(email.blocks, { ...baseSettings, bethnalLocationUrl: "" });
    const missing = issues.find((i) => i.message.includes("no map pin set"));
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("suggestion");
  });

  it("suggests a how-to-find-it note when none is set", () => {
    const email = compose({ bethnalFindIt: "" });
    const issues = checkEmail(email.blocks, { ...baseSettings, bethnalFindIt: "" });
    expect(issues.some((i) => i.message.includes('no "how to find it" note set'))).toBe(true);
  });

  it("catches a bank account number repeated outside the structured block", () => {
    // paymentBlock() already strips a repeated line from paymentDetails itself
    // (see its own tests), so this checks the digits leaking somewhere that
    // dedup doesn't reach — the letter.
    const over = {
      emailTemplate: "Hi {name},\n\nQuote reference 12345678 when you pay.\n\n{accessNote}",
      bankAccountNumber: "12345678",
    };
    const email = compose(over);
    const issues = checkEmail(email.blocks, { ...baseSettings, ...over });
    expect(issues.some((i) => i.message.includes("account number"))).toBe(true);
  });

  it("catches an unfilled placeholder", () => {
    const email = compose({ emailTemplate: "Hi {name},\n\nSee you {whenn}.\n\n{accessNote}" });
    const issues = checkEmail(email.blocks, baseSettings);
    expect(issues.some((i) => i.message.includes("{whenn}"))).toBe(true);
  });

  it("flags a preview stand-in saved into the template by default", () => {
    const email = compose({ emailTemplate: "Hi {name},\n\nYour form: (your personal intake link)\n\n{accessNote}" });
    const issues = checkEmail(email.blocks, baseSettings);
    expect(issues.some((i) => i.message.includes("your personal intake link"))).toBe(true);
  });

  it("allows preview stand-ins when checking a live browser preview", () => {
    const preview = composeBookingEmail({ name: "Maya", welcomeSent: false }, "bethnal", "Tue 5 Aug", true, baseSettings);
    const issues = checkEmail(preview.blocks, baseSettings, { allowPreviewStandins: true });
    expect(issues.some((i) => i.message.includes("placeholder text"))).toBe(false);
  });

  it("does not flag the sign-off as duplicated in an ordinary email", () => {
    const email = compose();
    expect(email.body.split("with gratitude").length - 1).toBe(1);
    expect(checkEmail(email.blocks, baseSettings).some((i) => i.message.includes("sign-off"))).toBe(false);
  });
});

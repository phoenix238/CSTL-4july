import { getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { formatPence } from "@/lib/account";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";

/**
 * Telling both sides what just happened.
 *
 * Every self-service action a client takes in the portal produces two emails:
 * one to Phoenix (this is his only signal — nobody is watching a dashboard) and
 * one to the client (so they close the tab with a record, rather than a screen
 * they'll have forgotten by evening).
 *
 * Both sends are non-fatal and deliberately so. By the time these run the
 * calendar has already been changed; a Gmail hiccup must never roll that back or
 * show the client an error for something that genuinely succeeded.
 */

export type PortalAction = "booked" | "rescheduled" | "cancelled";

interface NotifyInput {
  action: PortalAction;
  clientName: string;
  clientEmail: string;
  clinic: Clinic;
  /** the session this is about, formatted for humans */
  whenLabel: string;
  /** for a reschedule: the slot they moved off */
  previousWhenLabel?: string;
  /** goodwill contribution suggested on a short-notice cancellation, in pence */
  goodwillPence?: number;
  /** their bank-transfer reference, so the goodwill note can say how to send it */
  paymentRef?: string;
  /** where they can pick a new time */
  portalLink?: string;
}

const VERB: Record<PortalAction, string> = {
  booked: "booked a session",
  rescheduled: "moved their session",
  cancelled: "cancelled their session",
};

/** Email Phoenix. Silent no-op when portal notifications are switched off. */
export async function notifyPhoenix(input: NotifyInput): Promise<void> {
  const settings = await getSettings();
  if (!settings.portalNotifyEmail) return;
  const to = process.env.ALLOWED_EMAIL;
  if (!to) return;

  const clinic = CLINIC_LABEL[input.clinic];
  const lines = [`${input.clientName} just ${VERB[input.action]} from their client page.`, ""];

  if (input.action === "rescheduled" && input.previousWhenLabel) {
    lines.push(`From: ${input.previousWhenLabel}`, `To:   ${input.whenLabel} · ${clinic}`);
  } else {
    lines.push(`${input.whenLabel} · ${clinic}`);
  }

  if (input.goodwillPence) {
    lines.push(
      "",
      `Short notice, so they were invited to contribute ${formatPence(input.goodwillPence)} towards the room — entirely optional, and not counted as owing.`,
      "Mark it given or waived from their profile.",
    );
  }
  lines.push("", `Contact: ${input.clientEmail || "no email on record"}`);

  try {
    await sendEmail(to, `${input.clientName} — ${VERB[input.action]}`, lines.join("\n"));
  } catch (err) {
    console.error("Couldn't send the portal notification email to Phoenix", err);
  }
}

/** Confirm to the client, so they have it in writing. */
export async function confirmToClient(input: NotifyInput): Promise<void> {
  if (!input.clientEmail) return;
  const clinic = CLINIC_LABEL[input.clinic];
  const first = input.clientName.split(" ")[0] || "there";

  let subject: string;
  const lines: string[] = [`Hi ${first},`, ""];

  if (input.action === "cancelled") {
    subject = "Your session has been cancelled";
    lines.push(`Your session on ${input.whenLabel} at ${clinic} has been cancelled. That's absolutely fine.`);
    if (input.goodwillPence) {
      lines.push(
        "",
        `Because it was short notice the room was already paid for, so if you're able to, a ${formatPence(input.goodwillPence)} contribution helps cover it.`,
        "This is a donation-based clinic though — if that's too much right now, please don't pay it. That's completely okay, and nothing is owed either way.",
      );
      if (input.paymentRef) lines.push("", `If you'd like to, the reference is ${input.paymentRef}.`);
    }
    if (input.portalLink) {
      lines.push("", "Whenever you're ready to book again, your page is here:", input.portalLink);
    }
  } else if (input.action === "rescheduled") {
    subject = "Your session has been moved";
    lines.push(
      `Your session has been moved to ${input.whenLabel} at ${clinic}.`,
      "",
      "Your calendar invite has been updated — the new time should appear automatically.",
    );
    if (input.previousWhenLabel) lines.push("", `(Previously ${input.previousWhenLabel}.)`);
  } else {
    subject = "Your session is booked";
    lines.push(
      `You're booked in for ${input.whenLabel} at ${clinic}.`,
      "",
      "Your calendar invite is on its way separately.",
    );
  }

  if (input.portalLink && input.action !== "cancelled") {
    lines.push("", "You can change or cancel this any time from your page:", input.portalLink);
  }
  lines.push("", "Warm wishes,", "Phoenix");

  try {
    await sendEmail(input.clientEmail, subject, lines.join("\n"));
  } catch (err) {
    console.error("Couldn't send the portal confirmation email to the client", err);
  }
}

/** Both sides, in parallel — neither can fail the action that triggered it. */
export async function notifyPortalAction(input: NotifyInput): Promise<void> {
  await Promise.all([notifyPhoenix(input), confirmToClient(input)]);
}

export interface ReceiptLine {
  whenLabel: string;
  clinicLabel: string;
  amountPence: number | null;
}

/**
 * Email the client a receipt for the sessions they've paid for.
 *
 * Sent straight away rather than queued for Phoenix to write by hand — the app
 * already holds everything a receipt needs. Phoenix is told it went out, so a
 * request never lands in silence and he can follow up if the figures look off.
 *
 * Sessions whose amount was never recorded (an unfilled sliding scale) are listed
 * without a figure rather than shown as £0 — an honest gap beats a wrong number
 * on something a client may hand to an insurer or an employer.
 */
export async function sendReceipt({
  clientName,
  clientEmail,
  lines: sessions,
  totalPence,
  unpricedCount,
}: {
  clientName: string;
  clientEmail: string;
  lines: ReceiptLine[];
  totalPence: number;
  unpricedCount: number;
}): Promise<{ sent: boolean }> {
  const first = clientName.split(" ")[0] || "there";
  const body: string[] = [
    `Hi ${first},`,
    "",
    "Here's your receipt for craniosacral therapy with Phoenix Tanner.",
    "",
    ...sessions.map(
      (s) =>
        `  ${s.whenLabel} · ${s.clinicLabel}${s.amountPence != null ? ` — ${formatPence(s.amountPence)}` : ""}`,
    ),
    "",
    `Total paid: ${formatPence(totalPence)}`,
  ];
  if (unpricedCount) {
    body.push(
      "",
      `(${unpricedCount} sliding-scale ${unpricedCount === 1 ? "session is" : "sessions are"} listed without an amount — just reply and I'll add what you paid.)`,
    );
  }
  body.push("", "Any questions, just reply to this email.", "", "Warm wishes,", "Phoenix");

  try {
    await sendEmail(clientEmail, "Your receipt — Phoenix Tanner CSTL", body.join("\n"));
  } catch (err) {
    console.error("Couldn't send the receipt to the client", err);
    return { sent: false };
  }

  const to = process.env.ALLOWED_EMAIL;
  if (to) {
    try {
      await sendEmail(
        to,
        `${clientName} — receipt requested`,
        `${clientName} asked for a receipt from their client page, and one has been emailed to ${clientEmail}.\n\n${sessions.length} paid ${sessions.length === 1 ? "session" : "sessions"} · ${formatPence(totalPence)} total.`,
      );
    } catch (err) {
      console.error("Couldn't tell Phoenix a receipt was requested", err);
    }
  }
  return { sent: true };
}

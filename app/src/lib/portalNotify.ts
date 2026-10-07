import { getSettings } from "@/lib/db";
import { sendEmail } from "@/lib/google/gmail";
import { formatPence } from "@/lib/account";
import { CLINIC_LABEL, type Clinic } from "@/lib/booking/rules";
import { resolveSignOff } from "@/lib/booking/email";
import { applyCopy, applyCopyOptional, resolveClientCopy } from "@/lib/clientCopy";
import { practitionerIdentity } from "@/lib/practitioner";
import { buildReceiptPdf } from "@/lib/receiptPdf";
import { fmtDate } from "@/lib/time";

/**
 * Telling both sides what just happened.
 *
 * Every self-service action a client takes in the portal produces one email:
 * the client's own confirmation, so they close the tab with a record rather
 * than a screen they'll have forgotten by evening. Phoenix is blind-copied on
 * that same email — his only signal, since nobody is watching a dashboard —
 * rather than getting a second, separately-worded summary beside it. He only
 * gets a standalone note (`notifyPhoenix`) when the client's copy fails to
 * send, since that's the one case he needs to know about directly.
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
  /**
   * The client's own copy of this never sent. Turns the note from "here's what
   * happened" into "here's what happened and they don't know it in writing".
   */
  emailFailed?: boolean;
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

  if (input.emailFailed) {
    lines.push(
      "",
      "Their own confirmation email did NOT go out — they have nothing in writing, so please get in touch directly.",
      "Check Settings › Behind the scenes › Google for the state of the connection.",
    );
  }

  const subject = input.emailFailed
    ? `${input.clientName} — ${VERB[input.action]}, but not emailed`
    : `${input.clientName} — ${VERB[input.action]}`;

  try {
    await sendEmail(to, subject, lines.join("\n"));
  } catch (err) {
    console.error("Couldn't send the portal notification email to Phoenix", err);
  }
}

/**
 * Confirm to the client, so they have it in writing.
 *
 * `bcc` blind-copies Phoenix on this same email — one message about one
 * action, in place of that email plus a separately-worded "they just
 * rescheduled/cancelled" summary landing beside it. Returns whether the
 * client's copy actually sent, so the caller can fall back to a direct
 * notification when it didn't (their only record of what happened).
 */
export async function confirmToClient(input: NotifyInput, bcc?: string): Promise<{ sent: boolean }> {
  if (!input.clientEmail) return { sent: false };
  const settings = await getSettings();
  const clinic = CLINIC_LABEL[input.clinic];
  const first = input.clientName.split(" ")[0] || "there";

  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
  const vars = {
    name: first,
    when: input.whenLabel,
    clinic,
    previousWhen: input.previousWhenLabel ?? "",
    link: input.portalLink ?? "",
  };

  // The wording is the practitioner's (Settings › Messages); the order is fixed.
  let subject: string;
  const parts: string[] = [];
  if (input.action === "cancelled") {
    subject = copy.cancelEmailSubject;
    parts.push(applyCopyOptional(copy.cancelEmailBody, vars));
    if (input.goodwillPence) {
      parts.push(
        applyCopyOptional(copy.cancelGoodwillText, {
          amount: formatPence(input.goodwillPence),
          paymentRef: input.paymentRef ?? "",
        }),
      );
    }
    if (input.portalLink) parts.push(applyCopyOptional(copy.cancelRebookLine, vars));
  } else if (input.action === "rescheduled") {
    subject = copy.movedEmailSubject;
    parts.push(applyCopyOptional(copy.movedEmailBody, vars));
    if (input.portalLink) parts.push(applyCopyOptional(copy.changeAnyTimeLine, vars));
  } else {
    // Not reached by any route today — a portal booking sends the full booking
    // confirmation instead (see api/portal/[token]/book). Kept so the type stays total.
    subject = "Your session is booked";
    parts.push(`Hi ${first},\n\nYou're booked in for ${input.whenLabel} at ${clinic}.`);
    if (input.portalLink) parts.push(applyCopyOptional(copy.changeAnyTimeLine, vars));
  }
  parts.push(resolveSignOff(settings));
  const lines = parts.filter(Boolean).join("\n\n").split("\n");

  const links = input.portalLink ? [{ url: input.portalLink, label: "Click here for your booking page" }] : undefined;

  try {
    await sendEmail(input.clientEmail, subject, lines.join("\n"), undefined, undefined, { bcc, links });
    return { sent: true };
  } catch (err) {
    console.error("Couldn't send the portal confirmation email to the client", err);
    return { sent: false };
  }
}

export interface ReceiptLine {
  whenLabel: string;
  clinic: Clinic;
  clinicLabel: string;
  amountPence: number | null;
  /** Free-text payment note ("Cash", "Bank transfer 12 Aug · ref RP14", …) — shown on the PDF as a short method label. */
  paymentNote?: string;
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
  clientRef,
  receiptNumber,
  lines: sessions,
  totalPence,
  unpricedCount,
}: {
  clientName: string;
  clientEmail: string;
  /** The client's own payment reference — the same on every receipt they're sent. */
  clientRef?: string;
  /** A fresh number for this specific receipt document, e.g. "RCT-42" — unlike clientRef, never repeats. */
  receiptNumber?: string;
  lines: ReceiptLine[];
  totalPence: number;
  unpricedCount: number;
}): Promise<{ sent: boolean }> {
  const settings = await getSettings();
  const signOff = resolveSignOff(settings);
  const first = clientName.split(" ")[0] || "there";
  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));
  const body: string[] = [
    applyCopy(copy.receiptEmailIntro, { name: first }),
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
  body.push("", copy.receiptEmailClosing, "", ...signOff.split("\n"));

  try {
    const pdfBytes = await buildReceiptPdf({
      clientName,
      clientRef,
      receiptNumber,
      lines: sessions,
      totalPence,
      unpricedCount,
      signOff,
      membershipId: settings.cstaMembershipId,
      addressByClinic: { waterloo: settings.waterlooAddress, bethnal: settings.bethnalAddress },
    });
    const filename = receiptNumber ? `Receipt ${receiptNumber}.pdf` : `Receipt - ${fmtDate(new Date())}.pdf`;
    await sendEmail(clientEmail, copy.receiptEmailSubject, body.join("\n"), undefined, [
      { filename, mimeType: "application/pdf", base64: Buffer.from(pdfBytes).toString("base64") },
    ]);
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

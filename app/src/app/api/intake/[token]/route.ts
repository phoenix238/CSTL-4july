import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma, getSettings } from "@/lib/db";
import { updateClientDetails } from "@/lib/clients";
import { ensureClientFolderAndDoc } from "@/lib/google/drive";
import {
  refreshCaseHistoryDoc,
  resolveCaseHistory,
  seedFromIntake,
  type IntakeItem,
  type IntakeSnapshot,
} from "@/lib/caseHistory";
import { shareCalendarInvite } from "@/lib/google/calendar";
import { composeBookingEmail } from "@/lib/booking/email";
import { intakeUrl } from "@/lib/intake";
import { sendEmail } from "@/lib/google/gmail";
import { isValidEmail } from "@/lib/validate";
import { fmtDayLong, fmtTime } from "@/lib/time";
import type { Clinic } from "@/lib/booking/rules";
import { COLUMN_KEYS, resolveIntakeQuestions, type IntakeQuestion } from "@/lib/intakeQuestions";

// Standard keys that read as short client-detail fields (vs. clinical paragraphs).
const DETAIL_KEYS = new Set(["dob", "phone", "occupation", "doctor", "emergency", "referred"]);
const HEALTH_KEYS = new Set(["meds", "conditions"]);

// NOT guarded — the client fills this in without logging in. The token is the auth.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token) return NextResponse.json({ error: "Missing link" }, { status: 400 });

    const client = await prisma.client.findFirst({ where: { intakeToken: token } });
    if (!client) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

    const { name, email, answers, consent } = (await req.json()) as {
      name?: string;
      email?: string;
      answers?: Record<string, string>;
      consent?: boolean;
    };
    const a = answers ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const finalName = str(name) || client.name;

    // The intake form is where a WhatsApp/Instagram client (booked without an
    // email) gives us their address — so we can then invite + confirm them.
    const submittedEmail = str(email);
    if (submittedEmail && !isValidEmail(submittedEmail)) {
      return NextResponse.json({ error: "Please add a valid email address" }, { status: 400 });
    }
    const finalEmail = submittedEmail || client.email;
    const emailChanged = !!finalEmail && finalEmail.toLowerCase() !== (client.email || "").toLowerCase();

    const settings = await getSettings();
    const questions = resolveIntakeQuestions(settings.intakeQuestions).filter((q) => q.enabled);

    // Standard answers update the record; everything shows in the Doc too.
    const columnUpdate: Record<string, string | boolean> = { name: finalName, intakeDone: true };
    if (submittedEmail) columnUpdate.email = submittedEmail;
    if (typeof consent === "boolean") columnUpdate.consentGiven = consent;
    for (const q of questions) {
      if (COLUMN_KEYS.has(q.key) && a[q.key] !== undefined) columnUpdate[q.key] = str(a[q.key]);
    }
    await updateClientDetails(client.id, columnUpdate);

    // Now that we (may) have their email, close the loop on any upcoming session
    // they were booked into without one — invite them to the calendar event and
    // send the welcome/confirmation email. Both are non-fatal: the intake itself
    // has already saved, so a Google/Gmail hiccup shouldn't fail the submission.
    if (emailChanged) {
      try {
        await shareCalendarInvite(client.id);
      } catch (err) {
        console.error("shareCalendarInvite failed during intake submit", err);
      }
      try {
        const booking = await prisma.booking.findFirst({
          where: { clientId: client.id, status: "confirmed", startsAt: { gte: new Date() } },
          orderBy: { startsAt: "asc" },
        });
        if (booking && !booking.emailSent) {
          const clinic = booking.clinic as Clinic;
          const whenLabel = `${fmtDayLong(booking.startsAt)} · ${fmtTime(booking.startsAt)}`;
          // Force the full welcome (welcomeSent:false) so a WhatsApp client who
          // never got an email now receives the access note, address and payment.
          const welcome = composeBookingEmail({ name: finalName, welcomeSent: false }, clinic, whenLabel, true, settings, intakeUrl(settings, token));
          await sendEmail(finalEmail, welcome.subject, welcome.body);
          await prisma.booking.update({ where: { id: booking.id }, data: { emailSent: true } });
          if (!client.welcomeSent) {
            await prisma.client.update({ where: { id: client.id }, data: { welcomeSent: true } });
          }
        }
      } catch (err) {
        console.error("welcome email after intake failed", err);
      }
    }

    // Keep the form exactly as it was answered — every question label, in the
    // order it was asked. Section 1 of the case history is this, verbatim, so it
    // has to survive the question set being edited in Settings afterwards.
    const groupOf = (q: IntakeQuestion): IntakeItem["group"] =>
      q.key === "caseHistory" ? "caseHistory"
      : HEALTH_KEYS.has(q.key) ? "health"
      : DETAIL_KEYS.has(q.key) ? "details"
      : "custom";

    const snapshot: IntakeSnapshot = {
      items: [
        { label: "Full name", value: finalName, group: "details" },
        ...(finalEmail ? [{ label: "Email", value: finalEmail, group: "details" as const }] : []),
        ...questions.map((q) => ({ label: q.label, value: str(a[q.key]), group: groupOf(q) })),
      ],
      consent: typeof consent === "boolean" ? consent : null,
    };
    const submittedAt = new Date();

    // Parts of the intake inform the case history: answers already given seed
    // the matching clinical sections rather than being asked for twice.
    const history = seedFromIntake(resolveCaseHistory(client.caseHistory), snapshot, submittedAt);

    await prisma.client.update({
      where: { id: client.id },
      data: {
        intakeAnswers: snapshot as unknown as Prisma.InputJsonValue,
        intakeSubmittedAt: submittedAt,
        caseHistory: history as Prisma.InputJsonValue,
      },
    });

    // Written after the record is saved, so the Doc renders the intake in. The
    // refresh is unconditional: the Doc may be one that was already sitting in
    // the client's folder, which ensureClientFolderAndDoc adopts as-is rather
    // than writing over — anything it holds is kept as the original record.
    const { docId } = await ensureClientFolderAndDoc(client.id);
    await refreshCaseHistoryDoc(client.id, docId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

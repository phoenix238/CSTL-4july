import { NextResponse } from "next/server";
import { prisma, getSettings } from "@/lib/db";
import { updateClientDetails } from "@/lib/clients";
import { ensureClientFolderAndDoc, appendFormattedSections, type DocSection } from "@/lib/google/drive";
import { shareCalendarInvite } from "@/lib/google/calendar";
import { composeBookingEmail } from "@/lib/booking/email";
import { sendEmail } from "@/lib/google/gmail";
import { isValidEmail } from "@/lib/validate";
import { fmtDate, fmtDayLong, fmtTime } from "@/lib/time";
import type { Clinic } from "@/lib/booking/rules";
import { COLUMN_KEYS, CONSENT_PARAGRAPHS, resolveIntakeQuestions, type IntakeQuestion } from "@/lib/intakeQuestions";

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
          const welcome = composeBookingEmail({ name: finalName, welcomeSent: false }, clinic, whenLabel, true, settings);
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

    const { docId } = await ensureClientFolderAndDoc(client.id);

    const detailQs = questions.filter((q) => DETAIL_KEYS.has(q.key));
    const healthQs = questions.filter((q) => HEALTH_KEYS.has(q.key));
    const caseHistoryQ = questions.find((q) => q.key === "caseHistory");
    const customQs = questions.filter((q) => q.custom);
    const line = (q: IntakeQuestion): { kind: "field"; label: string; value: string } => ({
      kind: "field",
      label: q.label,
      value: str(a[q.key]),
    });

    const sections: DocSection[] = [
      {
        heading: "1. Client details",
        lines: [{ kind: "field", label: "Full name", value: finalName }, ...detailQs.map(line)],
      },
    ];
    if (healthQs.length) {
      sections.push({
        heading: "2. Health information",
        lines: healthQs.map((q) => ({ kind: "paragraph", label: q.label, value: str(a[q.key]) })),
      });
    }
    if (customQs.length) {
      sections.push({
        heading: "3. Additional questions",
        lines: customQs.map((q) =>
          q.type === "long"
            ? { kind: "paragraph" as const, label: q.label, value: str(a[q.key]) }
            : line(q),
        ),
      });
    }
    if (caseHistoryQ) {
      sections.push({
        heading: "4. What brings them to therapy",
        lines: [{ kind: "paragraph", value: str(a[caseHistoryQ.key]) }],
      });
    }
    sections.push({
      heading: "5. Consent",
      lines: [
        { kind: "field", label: "Consent given", value: consent === true ? "Yes" : consent === false ? "No" : "Not answered" },
        { kind: "paragraph", value: CONSENT_PARAGRAPHS.join("\n\n") },
      ],
    });

    await appendFormattedSections(docId, `INTAKE / CASE HISTORY — submitted ${fmtDate(new Date())}`, sections);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

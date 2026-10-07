import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { sweepFirstSessionEmails } from "@/lib/reminders/firstSession";
import { sweepSessionReminders } from "@/lib/reminders/sessionReminders";

/**
 * Run today's client emails now — the first-session emails and the session
 * reminders the daily job would send — instead of waiting for tomorrow's
 * 6am run. Body: { dryRun?: boolean } — a dry run lists who's due without
 * emailing anyone or marking anything sent.
 *
 * Safe to press twice: each email is stamped as sent the moment it goes, so a
 * second run (or the morning's own run) never repeats it.
 */
export const POST = guarded(async (req: Request) => {
  const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const firstSession = await sweepFirstSessionEmails({ dryRun: !!dryRun });
  const reminders = await sweepSessionReminders({ dryRun: !!dryRun });
  return NextResponse.json({
    dryRun: !!dryRun,
    firstSession: { due: firstSession.due, sent: firstSession.sent },
    reminders: { due: reminders.due, sent: reminders.sent },
  });
});

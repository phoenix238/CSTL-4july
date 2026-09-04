import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { prisma, getSettings } from "@/lib/db";
import { resolveWeeklyHours } from "@/lib/booking/availability";
import { resolveClientCopy } from "@/lib/clientCopy";
import { syncAvailabilityAfterChange } from "@/lib/google/availabilityHooks";

/** The editable settings the UI needs (email preview etc.) — no Google secrets. */
export const GET = guarded(async () => {
  const s = await getSettings();
  return NextResponse.json({
    accessNote: s.accessNote,
    emailTemplate: s.emailTemplate,
    emailTemplateReturning: s.emailTemplateReturning,
    emailSignOff: s.emailSignOff,
    // Legacy per-clinic letters — still sent so the composer can fall back to
    // them for a clinic until the shared letter is saved.
    emailTemplateWaterloo: s.emailTemplateWaterloo,
    emailTemplateBethnal: s.emailTemplateBethnal,
    paymentDetails: s.paymentDetails,
    waterlooAddress: s.waterlooAddress,
    bethnalAddress: s.bethnalAddress,
    waterlooFindIt: s.waterlooFindIt,
    bethnalFindIt: s.bethnalFindIt,
    waterlooPhoto: s.waterlooPhoto,
    bethnalPhoto: s.bethnalPhoto,
    waterlooArrivalNote: s.waterlooArrivalNote,
    bethnalArrivalNote: s.bethnalArrivalNote,
    // The email preview composes the real thing in the browser — without these
    // it would show a generated Maps search link where the sent email uses the
    // pin, and omit the directions entirely.
    waterlooLocationUrl: s.waterlooLocationUrl,
    bethnalLocationUrl: s.bethnalLocationUrl,
    waterlooDirections: s.waterlooDirections,
    bethnalDirections: s.bethnalDirections,
    weeklyHours: resolveWeeklyHours(s.weeklyHours),
    bookingSlotMinutes: s.bookingSlotMinutes,
    bookingMinNoticeMins: s.bookingMinNoticeMins,
    bookingHorizonDays: s.bookingHorizonDays,
    bookingBufferMinutes: s.bookingBufferMinutes,
    bethnalBufferMinutes: s.bethnalBufferMinutes,
    chalkFarmBufferMinutes: s.chalkFarmBufferMinutes,
    chalkFarmEdgeBufferMinutes: s.chalkFarmEdgeBufferMinutes,
    chalkFarmWeeklyCapHours: s.chalkFarmWeeklyCapHours,
    crossClinicGapMinutes: s.crossClinicGapMinutes,
    bookingNotifyEmail: s.bookingNotifyEmail,
    portalEnabled: s.portalEnabled,
    portalSelfBook: s.portalSelfBook,
    portalNotifyEmail: s.portalNotifyEmail,
    portalReceipts: s.portalReceipts,
    portalNoticeHours: s.portalNoticeHours,
    lateCancelGoodwillPence: s.lateCancelGoodwillPence,
    ownReminderMode: s.ownReminderMode,
    ownReminderMinutesBefore: s.ownReminderMinutesBefore,
    ownReminderMorningHour: s.ownReminderMorningHour,
    venueReminders: s.venueReminders,
    bankAccountName: s.bankAccountName,
    bankSortCode: s.bankSortCode,
    bankAccountNumber: s.bankAccountNumber,
    bankPaymentNote: s.bankPaymentNote,
    clientCopy: resolveClientCopy(s.clientCopy),
    // Which calendars are wired up — for the calendar page's event composer.
    calendars: { personal: true, room: !!s.roomCalendarId, chalkFarm: !!s.chalkFarmCalendarId },
    // Availability ⇄ Google Calendar two-way sync state — for the Settings card.
    availabilitySync: {
      connected: !!s.availabilityCalendarId,
      defaultClinic: s.availabilityDefaultClinic,
      lastSyncAt: s.availabilityLastSyncAt?.toISOString() ?? null,
    },
  });
});

/**
 * The settings the UI is allowed to write. Everything else on AppSettings —
 * `googleRefreshToken` above all — is set by the app itself and must not be
 * reachable from a request body. Previously the whole JSON body went straight
 * into the update, so any column was writable and a mistyped field name wrote
 * silently rather than erroring.
 */
const EDITABLE_SETTINGS = [
  "accessNote", "emailTemplateWaterloo", "emailTemplateBethnal", "paymentDetails",
  "emailTemplate", "emailTemplateReturning", "emailSignOff",
  "waterlooFindIt", "bethnalFindIt", "waterlooPhoto", "bethnalPhoto",
  "waterlooAddress", "bethnalAddress", "waterlooArrivalNote", "bethnalArrivalNote",
  "waterlooLocationUrl", "bethnalLocationUrl", "waterlooDirections", "bethnalDirections",
  "clinicContactLine", "intakeFormUrl", "intakeQuestions", "clientCopy",
  "mapsReviewUrlWaterloo", "mapsReviewUrlBethnal",
  "reviewEmailSubject", "reviewEmailBody",
  "reviewEmailSubjectWaterloo", "reviewEmailSubjectBethnal",
  "reviewEmailBodyWaterloo", "reviewEmailBodyBethnal",
  "weeklyHours", "bookingSlotMinutes", "bookingMinNoticeMins", "bookingHorizonDays",
  "bookingBufferMinutes", "bethnalBufferMinutes", "chalkFarmBufferMinutes",
  "chalkFarmEdgeBufferMinutes", "chalkFarmWeeklyCapHours", "crossClinicGapMinutes",
  "bookingNotifyEmail",
  "portalEnabled", "portalNotifyEmail", "portalNoticeHours", "lateCancelGoodwillPence",
  "portalReceipts", "portalSelfBook",
  "ownReminderMode", "ownReminderMinutesBefore", "ownReminderMorningHour", "venueReminders",
  "bankAccountName", "bankSortCode", "bankAccountNumber", "bankPaymentNote",
  "starlingEnabled", "starlingAutoMark", "starlingNotifyEmail", "starlingLookbackDays",
  "personalCalendarId", "roomCalendarId", "roomFallbackCalendarId", "roomFallbackLabel", "chalkFarmCalendarId",
  "availabilityCalendarId", "availabilityDefaultClinic",
  "clientsFolderId", "reflectionsDocId", "marketingSheetId", "appUrl",
] as const;

export const PATCH = guarded(async (req: Request) => {
  const body = (await req.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const key of EDITABLE_SETTINGS) {
    if (key in body) data[key] = body[key];
  }
  const rejected = Object.keys(body).filter((k) => !(k in data));
  if (rejected.length) {
    return NextResponse.json({ error: `Not a settable field: ${rejected.join(", ")}` }, { status: 400 });
  }
  const settings = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  // Saving the weekly hours changes what's offered — push the new picture onto
  // the availability calendar (no-op when it isn't connected; never fatal).
  if ("weeklyHours" in data) await syncAvailabilityAfterChange();
  return NextResponse.json(settings);
});

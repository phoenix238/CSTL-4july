import { prisma, getSettings } from "@/lib/db";
import { SettingsView } from "@/components/SettingsView";
import { resolveIntakeQuestions } from "@/lib/intakeQuestions";
import { resolveWeeklyHours } from "@/lib/booking/availability";
import { resolveClientCopy } from "@/lib/clientCopy";

export default async function SettingsPage() {
  const settings = await getSettings();
  const overrides = await prisma.availabilityOverride.findMany({ orderBy: { date: "asc" } });
  // For assigning a payment the matcher couldn't place.
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, paymentRef: true },
  });

  return (
    <SettingsView
      overrides={overrides}
      clients={clients}
      settings={{
        aiModel: settings.aiModel,
        accessNote: settings.accessNote,
        emailTemplate: settings.emailTemplate,
        emailTemplateReturning: settings.emailTemplateReturning,
        emailSignOff: settings.emailSignOff,
        paymentDetails: settings.paymentDetails,
        waterlooAddress: settings.waterlooAddress,
        bethnalAddress: settings.bethnalAddress,
        clinicContactLine: settings.clinicContactLine,
        waterlooFindIt: settings.waterlooFindIt,
        bethnalFindIt: settings.bethnalFindIt,
        waterlooPhoto: settings.waterlooPhoto,
        bethnalPhoto: settings.bethnalPhoto,
        waterlooLocationUrl: settings.waterlooLocationUrl,
        bethnalLocationUrl: settings.bethnalLocationUrl,
        // Superseded by waterlooFindIt/bethnalFindIt above — kept here only so
        // Settings can show you what's still saved in them if the new field is
        // empty, since that's the wording still going out until you copy it over.
        waterlooDirections: settings.waterlooDirections,
        bethnalDirections: settings.bethnalDirections,
        waterlooArrivalNote: settings.waterlooArrivalNote,
        bethnalArrivalNote: settings.bethnalArrivalNote,

        appUrl: settings.appUrl,
        personalCalendarId: settings.personalCalendarId,
        roomCalendarId: settings.roomCalendarId,
        chalkFarmCalendarId: settings.chalkFarmCalendarId,
        googleConnected: !!settings.googleRefreshToken,
        googleLastError: settings.googleLastError,
        intakeQuestions: resolveIntakeQuestions(settings.intakeQuestions),
        mapsReviewUrlWaterloo: settings.mapsReviewUrlWaterloo,
        mapsReviewUrlBethnal: settings.mapsReviewUrlBethnal,
        reviewEmailSubject: settings.reviewEmailSubject,
        reviewEmailBody: settings.reviewEmailBody,
        // Legacy per-clinic wording — the fallback until the shared pair above is saved.
        reviewEmailSubjectWaterloo: settings.reviewEmailSubjectWaterloo,
        reviewEmailSubjectBethnal: settings.reviewEmailSubjectBethnal,
        reviewEmailBodyWaterloo: settings.reviewEmailBodyWaterloo,
        reviewEmailBodyBethnal: settings.reviewEmailBodyBethnal,
        weeklyHours: resolveWeeklyHours(settings.weeklyHours),
        bookingSlotMinutes: settings.bookingSlotMinutes,
        bookingMinNoticeMins: settings.bookingMinNoticeMins,
        bookingHorizonDays: settings.bookingHorizonDays,
        bookingBufferMinutes: settings.bookingBufferMinutes,
        bethnalBufferMinutes: settings.bethnalBufferMinutes,
        chalkFarmBufferMinutes: settings.chalkFarmBufferMinutes,
        chalkFarmEdgeBufferMinutes: settings.chalkFarmEdgeBufferMinutes,
        chalkFarmWeeklyCapHours: settings.chalkFarmWeeklyCapHours,
        crossClinicGapMinutes: settings.crossClinicGapMinutes,
        bookingNotifyEmail: settings.bookingNotifyEmail,
        clientCopy: resolveClientCopy(settings.clientCopy),
        portalEnabled: settings.portalEnabled,
        portalSelfBook: settings.portalSelfBook,
        portalNotifyEmail: settings.portalNotifyEmail,
        portalReceipts: settings.portalReceipts,
        portalNoticeHours: settings.portalNoticeHours,
        lateCancelGoodwillPence: settings.lateCancelGoodwillPence,
        bankAccountName: settings.bankAccountName,
        bankSortCode: settings.bankSortCode,
        bankAccountNumber: settings.bankAccountNumber,
        bankPaymentNote: settings.bankPaymentNote,
        starlingEnabled: settings.starlingEnabled,
        starlingAutoMark: settings.starlingAutoMark,
        starlingNotifyEmail: settings.starlingNotifyEmail,
        starlingLastSyncAt: settings.starlingLastSyncAt?.toISOString() ?? null,
      }}
    />
  );
}

import { prisma, getSettings } from "@/lib/db";
import { SettingsView } from "@/components/SettingsView";
import { resolveIntakeQuestions } from "@/lib/intakeQuestions";
import { resolveWeeklyHours } from "@/lib/booking/availability";
import { resolveClientCopy } from "@/lib/clientCopy";
import { resolveSpaces } from "@/lib/spaces";

export default async function SettingsPage() {
  const settings = await getSettings();
  const overrides = await prisma.availabilityOverride.findMany({ orderBy: { date: "asc" } });
  // For assigning a payment the matcher couldn't place.
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, paymentRef: true },
  });
  // Your spaces, with their entrance photos — the editor shows and saves them.
  // (Everywhere else gets them photo-less, from the dashboard's SpacesProvider.)
  const spaces = resolveSpaces(settings);

  return (
    <SettingsView
      overrides={overrides}
      clients={clients}
      spaces={spaces}
      settings={{
        aiModel: settings.aiModel,
        practitionerName: settings.practitionerName,
        practitionerFullName: settings.practitionerFullName,
        practiceName: settings.practiceName,
        accessNote: settings.accessNote,
        emailTemplate: settings.emailTemplate,
        emailTemplateReturning: settings.emailTemplateReturning,
        emailSignOff: settings.emailSignOff,
        paymentDetails: settings.paymentDetails,
        clinicContactLine: settings.clinicContactLine,
        appUrl: settings.appUrl,
        personalCalendarId: settings.personalCalendarId,
        googleConnected: !!settings.googleRefreshToken,
        googleLastError: settings.googleLastError,
        intakeQuestions: resolveIntakeQuestions(settings.intakeQuestions),
        reviewEmailSubject: settings.reviewEmailSubject,
        reviewEmailBody: settings.reviewEmailBody,
        // Legacy wording — the fallback until the shared pair above is saved.
        reviewEmailSubjectWaterloo: settings.reviewEmailSubjectWaterloo,
        reviewEmailBodyWaterloo: settings.reviewEmailBodyWaterloo,
        weeklyHours: resolveWeeklyHours(settings.weeklyHours),
        bookingSlotMinutes: settings.bookingSlotMinutes,
        bookingMinNoticeMins: settings.bookingMinNoticeMins,
        bookingHorizonDays: settings.bookingHorizonDays,
        crossClinicGapMinutes: settings.crossClinicGapMinutes,
        bookingNotifyEmail: settings.bookingNotifyEmail,
        clientCopy: resolveClientCopy(settings.clientCopy),
        portalEnabled: settings.portalEnabled,
        portalSelfBook: settings.portalSelfBook,
        portalNotifyEmail: settings.portalNotifyEmail,
        portalReceipts: settings.portalReceipts,
        remindNewClientsByDefault: settings.remindNewClientsByDefault,
        portalNoticeHours: settings.portalNoticeHours,
        lateCancelGoodwillPence: settings.lateCancelGoodwillPence,
        ownReminderMode: settings.ownReminderMode,
        ownReminderMinutesBefore: settings.ownReminderMinutesBefore,
        ownReminderMorningHour: settings.ownReminderMorningHour,
        venueReminders: settings.venueReminders,
        bankAccountName: settings.bankAccountName,
        bankSortCode: settings.bankSortCode,
        bankAccountNumber: settings.bankAccountNumber,
        bankPaymentNote: settings.bankPaymentNote,
        cstaMembershipId: settings.cstaMembershipId,
        starlingEnabled: settings.starlingEnabled,
        starlingAutoMark: settings.starlingAutoMark,
        starlingNotifyEmail: settings.starlingNotifyEmail,
        starlingLastSyncAt: settings.starlingLastSyncAt?.toISOString() ?? null,
      }}
    />
  );
}

import { getSettings } from "@/lib/db";
import { SettingsView } from "@/components/SettingsView";
import { resolveIntakeQuestions } from "@/lib/intakeQuestions";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <SettingsView
      settings={{
        accessNote: settings.accessNote,
        emailTemplateWaterloo: settings.emailTemplateWaterloo,
        emailTemplateBethnal: settings.emailTemplateBethnal,
        paymentDetails: settings.paymentDetails,
        waterlooAddress: settings.waterlooAddress,
        bethnalAddress: settings.bethnalAddress,
        waterlooArrivalNote: settings.waterlooArrivalNote,
        bethnalArrivalNote: settings.bethnalArrivalNote,
        appUrl: settings.appUrl,
        personalCalendarId: settings.personalCalendarId,
        roomCalendarId: settings.roomCalendarId,
        chalkFarmCalendarId: settings.chalkFarmCalendarId,
        googleConnected: !!settings.googleRefreshToken,
        intakeQuestions: resolveIntakeQuestions(settings.intakeQuestions),
        mapsReviewUrlWaterloo: settings.mapsReviewUrlWaterloo,
        mapsReviewUrlBethnal: settings.mapsReviewUrlBethnal,
        reviewEmailSubjectWaterloo: settings.reviewEmailSubjectWaterloo,
        reviewEmailSubjectBethnal: settings.reviewEmailSubjectBethnal,
        reviewEmailBodyWaterloo: settings.reviewEmailBodyWaterloo,
        reviewEmailBodyBethnal: settings.reviewEmailBodyBethnal,
      }}
    />
  );
}

import { getSettings } from "@/lib/db";
import { SettingsView } from "@/components/SettingsView";

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <SettingsView
      settings={{
        accessNote: settings.accessNote,
        emailTemplateWaterloo: settings.emailTemplateWaterloo,
        emailTemplateBethnal: settings.emailTemplateBethnal,
        paymentDetails: settings.paymentDetails,
        intakeFormUrl: settings.intakeFormUrl,
        personalCalendarId: settings.personalCalendarId,
        roomCalendarId: settings.roomCalendarId,
        chalkFarmCalendarId: settings.chalkFarmCalendarId,
        googleConnected: !!settings.googleRefreshToken,
      }}
    />
  );
}

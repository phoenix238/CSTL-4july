import { getSettings } from "@/lib/db";
import { BookingFlow } from "@/components/BookingFlow";
import { ToastProvider } from "@/components/ui";
import { resolveClientCopy } from "@/lib/clientCopy";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy);

  return (
    <ToastProvider>
      <BookingFlow
        waterlooAddress={settings.waterlooAddress}
        bethnalAddress={settings.bethnalAddress}
        waterlooNote={settings.waterlooArrivalNote}
        bethnalNote={settings.bethnalArrivalNote}
        copy={copy}
      />
    </ToastProvider>
  );
}

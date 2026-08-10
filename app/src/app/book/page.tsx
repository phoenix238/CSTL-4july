import { getSettings } from "@/lib/db";
import { BookingFlow } from "@/components/BookingFlow";
import { ToastProvider } from "@/components/ui";
import { resolveClientCopy } from "@/lib/clientCopy";
import { resolveFindIt } from "@/lib/booking/email";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy);

  return (
    <ToastProvider>
      <BookingFlow
        waterlooAddress={settings.waterlooAddress}
        bethnalAddress={settings.bethnalAddress}
        waterlooNote={resolveFindIt("waterloo", settings)}
        bethnalNote={resolveFindIt("bethnal", settings)}
        copy={copy}
      />
    </ToastProvider>
  );
}

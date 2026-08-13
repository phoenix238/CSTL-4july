import { getSettings } from "@/lib/db";
import { BookingFlow } from "@/components/BookingFlow";
import { ToastProvider } from "@/components/ui";
import { resolveClientCopy } from "@/lib/clientCopy";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy);

  // The notes are deliberately blank. How-to-find-it runs to a dozen lines of
  // pre-arrival detail, which pushed the times themselves below the fold on a
  // phone. It belongs in the confirmation email — which still reads the same
  // settings field through resolveFindIt — not in front of someone who hasn't
  // picked a time yet.
  return (
    <ToastProvider>
      <BookingFlow
        waterlooAddress={settings.waterlooAddress}
        bethnalAddress={settings.bethnalAddress}
        waterlooNote=""
        bethnalNote=""
        copy={copy}
      />
    </ToastProvider>
  );
}

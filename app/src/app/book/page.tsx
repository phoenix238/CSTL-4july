import { getSettings } from "@/lib/db";
import { BookingFlow } from "@/components/BookingFlow";
import { ToastProvider } from "@/components/ui";
import { resolveClientCopy } from "@/lib/clientCopy";
import { parseSessionType } from "@/lib/booking/rules";

export const dynamic = "force-dynamic";

export default async function BookPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const settings = await getSettings();
  // /book?type=clean opens with the 90-minute Clean Language session chosen —
  // for the website's Clean Language page. Anything else starts on the
  // standard 60-minute session.
  const initialSessionType = parseSessionType((await searchParams).type);
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
        initialSessionType={initialSessionType}
      />
    </ToastProvider>
  );
}

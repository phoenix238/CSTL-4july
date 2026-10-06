import { preload } from "react-dom";
import { getSettings } from "@/lib/db";
import { BookingFlow } from "@/components/BookingFlow";
import { EmbedBridge } from "@/components/EmbedBridge";
import { ToastProvider } from "@/components/ui";
import { resolveClientCopy } from "@/lib/clientCopy";

export const dynamic = "force-dynamic";

export default async function BookPage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  // /book?embed=1 is the website's iframe: the site already has its own heading
  // above the frame, so the page drops its own and its outer padding.
  const embedded = (await searchParams).embed === "1";
  // Start fetching the default clinic's times as the HTML arrives, rather than
  // after the page's JavaScript has loaded and run — the picker's own request
  // (same URL) picks this up.
  preload("/api/public/slots?clinic=bethnal", { as: "fetch", crossOrigin: "anonymous" });
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy);

  // The notes are deliberately blank. How-to-find-it runs to a dozen lines of
  // pre-arrival detail, which pushed the times themselves below the fold on a
  // phone. It belongs in the confirmation email — which still reads the same
  // settings field through resolveFindIt — not in front of someone who hasn't
  // picked a time yet.
  return (
    <ToastProvider>
      {embedded && <EmbedBridge />}
      <BookingFlow
        waterlooAddress={settings.waterlooAddress}
        bethnalAddress={settings.bethnalAddress}
        waterlooNote=""
        bethnalNote=""
        copy={copy}
        embedded={embedded}
      />
    </ToastProvider>
  );
}

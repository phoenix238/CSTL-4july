import { preload } from "react-dom";
import { getSettings, getSpaces } from "@/lib/db";
import { activeSpaces } from "@/lib/spaces";
import { BookingFlow } from "@/components/BookingFlow";
import { EmbedBridge } from "@/components/EmbedBridge";
import { ToastProvider } from "@/components/ui";
import { resolveClientCopy } from "@/lib/clientCopy";
import { practitionerIdentity } from "@/lib/practitioner";

export const dynamic = "force-dynamic";

export default async function BookPage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  // /book?embed=1 is the website's iframe: the site already has its own heading
  // above the frame, so the page drops its own and its outer padding.
  const embedded = (await searchParams).embed === "1";
  // Start fetching the default clinic's times as the HTML arrives, rather than
  // after the page's JavaScript has loaded and run — the picker's own request
  // (same URL) picks this up.
  // The booking page is the one screen that shows each space's entrance photo,
  // so it gets the full spaces (photos included) — only the bookable ones.
  const spaces = activeSpaces(await getSpaces());
  if (spaces[0]) {
    preload(`/api/public/slots?clinic=${encodeURIComponent(spaces[0].id)}`, { as: "fetch", crossOrigin: "anonymous" });
  }
  const settings = await getSettings();
  const copy = resolveClientCopy(settings.clientCopy, practitionerIdentity(settings));

  return (
    <ToastProvider>
      {embedded && <EmbedBridge />}
      <BookingFlow
        spaces={spaces}
        copy={copy}
        embedded={embedded}
      />
    </ToastProvider>
  );
}

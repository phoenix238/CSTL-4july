import { getSettings } from "@/lib/db";
import { BookingFlow } from "@/components/BookingFlow";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BookPage() {
  const settings = await getSettings();

  return (
    <ToastProvider>
      <BookingFlow waterlooAddress={settings.waterlooAddress} bethnalAddress={settings.bethnalAddress} />
    </ToastProvider>
  );
}

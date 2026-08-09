import { getSettings } from "@/lib/db";
import { ToastProvider } from "@/components/ui";
import { ClientPortal } from "@/components/portal/ClientPortal";
import { buildPortalView, loadPortalClient } from "@/lib/portalData";

export const dynamic = "force-dynamic";

/** Deliberately kept out of search results — this is one person's private page. */
export const metadata = {
  title: "Your sessions — Phoenix Tanner CSTL",
  robots: { index: false, follow: false },
};

function DeadLinkCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
      <div className="font-serif text-2xl font-medium">This link isn&apos;t working</div>
      <p className="text-[14px] text-muted">{children}</p>
    </div>
  );
}

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();

  if (!settings.portalEnabled) {
    return <DeadLinkCard>Client pages are switched off at the moment — please message Phoenix directly.</DeadLinkCard>;
  }

  const client = await loadPortalClient(token);
  if (!client) {
    return <DeadLinkCard>Please ask Phoenix for a fresh link and it&apos;ll take you straight back here.</DeadLinkCard>;
  }

  const view = await buildPortalView(client.id);

  return (
    <ToastProvider>
      <ClientPortal token={token} view={view} />
    </ToastProvider>
  );
}

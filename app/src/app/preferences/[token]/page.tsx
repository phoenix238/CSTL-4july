import { prisma } from "@/lib/db";
import { PreferencesForm } from "@/components/PreferencesForm";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = token
    ? await prisma.client.findFirst({
        where: { intakeToken: token },
        select: { name: true, marketing: true },
      })
    : null;

  if (!client) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="font-serif text-2xl font-medium">This link has expired</div>
        <p className="text-[14px] text-muted">Please ask Phoenix for a fresh link. Thank you!</p>
      </div>
    );
  }

  return (
    <ToastProvider>
      <PreferencesForm token={token} clientName={client.name} initialMarketing={client.marketing} />
    </ToastProvider>
  );
}

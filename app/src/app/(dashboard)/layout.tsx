import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma, getSettings } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/signin");

  const [enquiryCount, settings] = await Promise.all([
    prisma.enquiry.count({ where: { status: { in: ["waiting", "offered"] } } }),
    getSettings(),
  ]);

  return (
    <ToastProvider>
      <Shell enquiryBadge={enquiryCount} googleConnected={!!settings.googleRefreshToken}>
        {children}
      </Shell>
    </ToastProvider>
  );
}

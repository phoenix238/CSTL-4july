import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The top-shell data (enquiry badge + Google-connected indicator) rides on
 * every screen but rarely changes tap to tap. Cache it for 30s, shared across
 * requests, so navigating between pages doesn't re-hit the database each time.
 * Auth stays per-request (below). The `shell` tag lets the enquiry write
 * routes bust the badge immediately rather than waiting out the 30s.
 */
const getShellData = unstable_cache(
  async () => {
    const [enquiryBadge, settings] = await Promise.all([
      prisma.enquiry.count({ where: { status: { in: ["waiting", "offered"] } } }),
      prisma.appSettings.findUnique({ where: { id: 1 }, select: { googleRefreshToken: true } }),
    ]);
    return { enquiryBadge, googleConnected: !!settings?.googleRefreshToken };
  },
  ["shell-data"],
  { revalidate: 30, tags: ["shell"] },
);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/signin");

  const { enquiryBadge, googleConnected } = await getShellData();

  return (
    <ToastProvider>
      <Shell enquiryBadge={enquiryBadge} googleConnected={googleConnected}>
        {children}
      </Shell>
    </ToastProvider>
  );
}

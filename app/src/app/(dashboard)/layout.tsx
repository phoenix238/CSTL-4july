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
      // Only enquiries needing a reply — someone looking for a time. Online
      // bookings ("booked_online") are already done, and have their own strip,
      // so they no longer nag the nav badge.
      prisma.enquiry.count({
        where: { status: { in: ["waiting", "offered"] } },
      }),
      prisma.appSettings.findUnique({
        where: { id: 1 },
        select: {
          googleRefreshToken: true,
          googleLastError: true,
          notificationsViewedAt: true,
        },
      }),
    ]);
    // A red dot on Home, not a count — "something new happened", cleared the
    // moment Home is actually opened (see /api/notifications/viewed).
    const homeAlert =
      (await prisma.enquiry.count({
        where: {
          status: "booked_online",
          createdAt: { gt: settings?.notificationsViewedAt ?? new Date(0) },
        },
      })) > 0;
    // "Connected" now means the last thing we asked Google to do actually
    // worked — not merely that a refresh token is on file. The old check was
    // the reason the sidebar could show a green tick while every email failed.
    return {
      enquiryBadge,
      homeAlert,
      googleConnected: !!settings?.googleRefreshToken,
      googleError: settings?.googleLastError ?? "",
    };
  },
  ["shell-data"],
  { revalidate: 30, tags: ["shell"] },
);

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/signin");

  const { enquiryBadge, homeAlert, googleConnected, googleError } =
    await getShellData();

  return (
    <ToastProvider>
      <Shell
        enquiryBadge={enquiryBadge}
        homeAlert={homeAlert}
        googleConnected={googleConnected}
        googleError={googleError}
      >
        {children}
      </Shell>
    </ToastProvider>
  );
}

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { guarded } from "@/lib/api";
import { prisma } from "@/lib/db";

/**
 * Mark Home's notifications as seen — clears the red dot on the Home nav
 * link. Called once the Home page has actually rendered in the browser
 * (never during a Link prefetch, which doesn't run client-side effects), so
 * the dot survives until Phoenix genuinely looks at it.
 */
export const POST = guarded(async () => {
  await prisma.appSettings.update({
    where: { id: 1 },
    data: { notificationsViewedAt: new Date() },
  });
  revalidateTag("shell");
  return NextResponse.json({ ok: true });
});

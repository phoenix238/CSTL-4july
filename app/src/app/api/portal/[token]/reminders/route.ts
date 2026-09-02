import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { portalRoute } from "@/lib/portalRoute";
import { normaliseLeadDays } from "@/lib/reminders/leadTimes";

/**
 * Let the client set how many reminder emails they get and how far ahead —
 * their own saved reminder settings. Body: { leadDays: number[] } (7 = a week
 * before, 1 = the day before, 0 = the morning of; an empty list turns reminders
 * off). Whatever they send is cleaned to the allowed values, so the stored
 * preference can never hold something the sweep won't understand.
 */
export const POST = portalRoute(async (req, client) => {
  const { leadDays } = (await req.json()) as { leadDays?: unknown };
  const cleaned = normaliseLeadDays(leadDays);
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: { reminderLeadDays: cleaned },
    select: { reminderLeadDays: true },
  });
  return NextResponse.json({ leadDays: updated.reminderLeadDays });
});

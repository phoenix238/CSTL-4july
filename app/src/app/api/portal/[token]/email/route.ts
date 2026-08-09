import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { portalRoute, PortalRuleError } from "@/lib/portalRoute";
import { isValidEmail } from "@/lib/validate";

/** Let a client with no email on file add one, so a receipt has somewhere to go. Body: { email } */
export const POST = portalRoute(async (req, client) => {
  const { email } = (await req.json()) as { email?: string };
  const trimmed = (email ?? "").trim();
  if (!isValidEmail(trimmed)) {
    throw new PortalRuleError("That doesn't look like a valid email address.");
  }

  await prisma.client.update({ where: { id: client.id }, data: { email: trimmed } });
  return NextResponse.json({ email: trimmed });
});

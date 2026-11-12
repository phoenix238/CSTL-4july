import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { findExistingClient } from "@/lib/clients";

/** Exact dedupe check ("one client, one record") — used by the enquiry name field. */
export const GET = guarded(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const name = params.get("name") ?? "";
  const email = params.get("email") || undefined;
  const phone = params.get("phone") || undefined;
  if (!name.trim() && !email && !phone) return NextResponse.json({ match: null });
  const existing = await findExistingClient(name, email, phone);
  return NextResponse.json({
    match: existing
      ? {
          id: existing.id,
          name: existing.name,
          clinic: existing.clinic,
          email: existing.email,
          phone: existing.phone,
          welcomeSent: existing.welcomeSent,
        }
      : null,
  });
});

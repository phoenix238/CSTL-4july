"use server";

import { signIn } from "@/lib/auth";

/**
 * Re-run Google sign-in (the provider is configured with prompt:"consent", so
 * this always re-shows the consent screen and returns a fresh refresh token
 * carrying every current scope). Fixes "insufficient permissions" when the
 * stored token predates a newly-added scope such as gmail.send.
 */
export async function reconnectGoogle() {
  await signIn("google", { redirectTo: "/settings" });
}

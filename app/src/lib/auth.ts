import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";

// Everything the control tower touches: calendars, Drive folders + Docs,
// sending Gmail, and the marketing spreadsheet.
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/gmail.send",
  // gmail.send alone can't call users.getProfile — Google requires readonly,
  // modify, or metadata access for that method even though sending mail
  // never touches it. Requested only so the health check can ask "who am I
  // sending as" without gaining any ability to read message content.
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // Vercel sits behind a proxy; the deployment URL is the trusted host
  session: { strategy: "jwt" },
  providers: [
    Google({
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    // Single-user app: only Phoenix's Google account may sign in.
    async signIn({ profile }) {
      const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
      if (!allowed) return true; // not yet configured — allow first sign-in
      return profile?.email?.toLowerCase() === allowed;
    },
    async jwt({ token, account }) {
      if (!account) return token;
      if (account.refresh_token) {
        // Persist the refresh token so server routes can mint access tokens
        // any time, independent of the browser session.
        //
        // The granted scopes are stored alongside it. Google returns only what
        // was actually ticked on the consent screen, which is not necessarily
        // what we asked for — and a connection missing gmail.send looks
        // identical to a healthy one from the outside. Recorded here so
        // "Reconnect Google" can be answered with what changed, and the last
        // error is cleared because this *is* a fresh grant.
        const data = {
          googleRefreshToken: account.refresh_token,
          googleScopes: account.scope ?? "",
          googleConnectedAt: new Date(),
          googleLastError: "",
          googleLastCheckedAt: new Date(),
        };
        await prisma.appSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
      } else {
        // Signed in, but Google returned no refresh token — the previous one is
        // still in place and still whatever it was. Silently doing nothing here
        // is what made "Reconnect Google" look like it worked while changing
        // nothing at all, so say so where Settings can show it.
        console.warn("Google sign-in returned no refresh token — the stored connection is unchanged");
        await prisma.appSettings.updateMany({
          where: { id: 1, googleRefreshToken: { not: "" } },
          data: {
            googleLastError:
              "Google signed you in but didn't issue a new connection, so nothing changed. Revoke this app at myaccount.google.com/permissions, then reconnect.",
            googleLastCheckedAt: new Date(),
          },
        });
      }
      return token;
    },
  },
  pages: { signIn: "/signin" },
});

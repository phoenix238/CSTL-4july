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
      if (account?.refresh_token) {
        // Persist the refresh token so server routes can mint access tokens
        // any time, independent of the browser session.
        await prisma.appSettings.upsert({
          where: { id: 1 },
          update: { googleRefreshToken: account.refresh_token },
          create: { id: 1, googleRefreshToken: account.refresh_token },
        });
      }
      return token;
    },
  },
  pages: { signIn: "/signin" },
});

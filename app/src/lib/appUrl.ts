/** The app's public base URL, for building intake / share links in emails. */
export function appBaseUrl(settings: { appUrl?: string | null }): string {
  const raw = settings.appUrl?.trim() || process.env.NEXT_PUBLIC_APP_URL || "https://cstl-4july.vercel.app";
  return raw.replace(/\/+$/, "");
}

import type { Metadata, Viewport } from "next";
import { Newsreader, Work_Sans } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-worksans" });

export const metadata: Metadata = {
  title: "CSTL",
  description: "Phoenix Tanner — CSTL booking & documentation",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CSTL", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#b46a4a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${workSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}

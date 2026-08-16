"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FlowerOfLife } from "./FlowerOfLife";
import { ClientSearch } from "./ClientSearch";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Session", href: "/session" },
  { label: "Reflect", href: "/reflect" },
  { label: "Clients", href: "/clients" },
  { label: "Enquiries", href: "/enquiries" },
  { label: "Calendar", href: "/calendar" },
  { label: "Import", href: "/import" },
];

function NavLinks({
  enquiryBadge,
  homeAlert,
  onNavigate,
}: {
  enquiryBadge: number;
  /** something new (an online booking) is waiting on Home, unseen */
  homeAlert: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const item = (
    label: string,
    href: string,
    opts?: { badge?: number; dot?: boolean },
  ) => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        className={`flex items-center justify-between rounded-[10px] px-3 py-2.5 text-[13.5px] select-none ${
          active
            ? "bg-clay-tint font-semibold text-clay-text"
            : "text-ink-soft hover:bg-hoverbg"
        }`}
      >
        <span className="flex items-center gap-1.5">
          {label}
          {opts?.dot ? (
            <span
              aria-label="New"
              className="h-[7px] w-[7px] flex-none rounded-full bg-[oklch(0.62_0.15_30)]"
            />
          ) : null}
        </span>
        {opts?.badge ? (
          <span className="rounded-full bg-clay px-[7px] py-px text-[11px] font-semibold text-cream">
            {opts.badge}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {NAV.map((n) =>
        item(
          n.label,
          n.href,
          n.href === "/enquiries"
            ? { badge: enquiryBadge }
            : n.href === "/"
              ? { dot: homeAlert }
              : undefined,
        ),
      )}
    </>
  );
}

function SidebarHeader() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 pb-5">
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-clay">
        <FlowerOfLife />
      </div>
      <div>
        <div className="font-serif text-[15px] leading-[1.15] font-medium">
          Phoenix Tanner
        </div>
        <div className="mt-0.5 text-[9.5px] font-semibold tracking-[0.1em] text-muted">
          CSTL · CRANIOSACRAL
        </div>
      </div>
    </div>
  );
}

/**
 * Three states, not two. A connection can be linked and still broken — that's
 * the case the old green/red pair had no way to show, so a token on file read
 * as "Google connected" no matter how many emails Google was refusing.
 */
function GoogleStatus({
  connected,
  error,
}: {
  connected: boolean;
  error?: string;
}) {
  const state = !connected ? "off" : error ? "failing" : "ok";
  const dot =
    state === "ok"
      ? "bg-sage"
      : state === "failing"
        ? "bg-[oklch(0.75_0.14_75)]"
        : "bg-[oklch(0.62_0.15_30)]";
  return (
    <Link
      href="/settings"
      className="flex items-start gap-2 border-t border-line px-3 pt-3 pb-0.5"
    >
      <span className={`mt-1 h-[7px] w-[7px] flex-none rounded-full ${dot}`} />
      <div className="text-[11px] leading-[1.45] text-muted">
        {state === "ok" && (
          <>
            Google connected
            <br />
            Drive · Calendar · Gmail
          </>
        )}
        {state === "failing" && (
          <>
            Google is refusing us
            <br />
            tap to see why
          </>
        )}
        {state === "off" && (
          <>
            Google not connected
            <br />
            finish setup in Settings
          </>
        )}
      </div>
    </Link>
  );
}

export function Shell({
  enquiryBadge,
  homeAlert,
  googleConnected,
  googleError,
  children,
}: {
  enquiryBadge: number;
  /** something new (an online booking) is waiting on Home, unseen */
  homeAlert: boolean;
  googleConnected: boolean;
  /** the last thing Google refused, "" when the last call worked */
  googleError?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const settingsLink = (onNavigate?: () => void) => (
    <Link
      href="/settings"
      onClick={onNavigate}
      className={`block rounded-[10px] px-3 py-2.5 text-[13.5px] select-none ${
        pathname.startsWith("/settings")
          ? "bg-clay-tint font-semibold text-clay-text"
          : "text-ink-soft hover:bg-hoverbg"
      }`}
    >
      Settings
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[212px] flex-none flex-col gap-0.5 border-r border-line px-3.5 pt-[22px] pb-[18px] lg:flex">
        <SidebarHeader />
        <ClientSearch />
        <NavLinks enquiryBadge={enquiryBadge} homeAlert={homeAlert} />
        <div className="mt-auto flex flex-col gap-2.5">
          {settingsLink()}
          <GoogleStatus connected={googleConnected} error={googleError} />
        </div>
      </aside>

      {/* mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-line bg-linen/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-clay">
            <FlowerOfLife size={18} />
          </div>
          <span className="font-serif text-[15px] font-medium">
            Phoenix Tanner
          </span>
        </div>
        <button
          aria-label="Menu"
          onClick={() => setOpen(!open)}
          className="relative cursor-pointer rounded-full border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink-soft"
        >
          {open ? "Close" : "Menu"}
          {!open && homeAlert && (
            <span
              aria-label="New"
              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[oklch(0.62_0.15_30)] ring-2 ring-linen"
            />
          )}
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute top-[52px] right-3 left-3 flex flex-col gap-0.5 rounded-2xl border border-line bg-card p-3 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <ClientSearch onNavigate={() => setOpen(false)} />
            <NavLinks
              enquiryBadge={enquiryBadge}
              homeAlert={homeAlert}
              onNavigate={() => setOpen(false)}
            />
            {settingsLink(() => setOpen(false))}
            <GoogleStatus connected={googleConnected} error={googleError} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 pt-[52px] lg:pt-0">{children}</main>
    </div>
  );
}

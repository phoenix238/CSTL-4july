"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ---------- shared hooks ---------- */

/** Call `onEscape` when the Escape key is pressed (while `active`). For modals/popovers. */
export function useEscapeKey(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, active]);
}

/**
 * True on phone-width screens. Calendars use it to default to a 3-day grid,
 * where seven columns would be too narrow to read a name in or tap accurately.
 * Starts false so the server and first client render agree, then corrects on mount.
 */
export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsPhone(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isPhone;
}

/* ---------- sheet ---------- */

/** Matches the leave animations in globals.css (.ct-sheet-leaving / .ct-veil-leaving). */
const SHEET_LEAVE_MS = 200;

/**
 * A panel that pops in over the page, centred in front of whatever's behind
 * it — same treatment at every viewport width, so it never reads as docked to
 * an edge or only covering part of the screen.
 *
 * It stays mounted for the length of its leave animation after `open` goes
 * false, which is the whole reason this isn't just `{open && <div/>}`: unmounting
 * on the spot would make it vanish rather than close.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, SHEET_LEAVE_MS);
    return () => clearTimeout(t);
  }, [open, mounted]);

  // Hold the page still underneath. Without this the body scrolls behind the
  // sheet on a phone, which reads as the sheet itself drifting.
  useEffect(() => {
    if (!mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mounted]);

  // Move focus to the panel rather than to the first field: on a phone, focusing
  // an input throws the keyboard up mid-animation and the sheet lands behind it.
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);

  useEscapeKey(onClose, open);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-[oklch(0.3_0.02_60_/_0.28)] ${leaving ? "ct-veil-leaving" : "ct-veil"}`}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative max-h-[88svh] w-full max-w-[440px] overflow-y-auto rounded-2xl border border-line bg-card shadow-pop outline-none ${
          leaving ? "ct-sheet-leaving" : "ct-sheet"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- shared atoms, matching the design's card/chip/button styles ---------- */

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-card shadow-card ${className}`}>{children}</div>;
}

export function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-0.5 text-[11px] font-semibold tracking-[0.1em] text-muted ${className}`}>{children}</div>
  );
}

export function Chip({
  color,
  bg,
  children,
}: {
  color: string;
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="rounded-full px-2.5 py-[3px] text-[11.5px] font-medium whitespace-nowrap"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

export function clinicChip(clinic: string) {
  return clinic === "waterloo"
    ? { label: "Waterloo · R5 Phoenix", color: "oklch(0.42 0.1 42)", bg: "oklch(0.94 0.03 48)" }
    : { label: "Bethnal Green", color: "oklch(0.42 0.08 148)", bg: "oklch(0.94 0.03 148)" };
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`cursor-pointer rounded-full bg-clay px-5 py-2.5 text-[13.5px] font-semibold text-cream hover:bg-clay-deep disabled:cursor-default disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function TintButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`cursor-pointer rounded-full bg-clay-tint px-3.5 py-1.5 text-[13px] font-semibold text-clay-text disabled:cursor-default disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`cursor-pointer rounded-full border border-[oklch(0.85_0.02_75)] bg-transparent px-4 py-2 text-[13px] font-semibold text-[oklch(0.38_0.02_60)] hover:bg-hoverbg disabled:cursor-default disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function CopyButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold text-clay-text/70 hover:text-clay-text hover:underline ${className}`}
    >
      Copy
    </button>
  );
}

export const inputClass =
  "w-full box-border rounded-lg border border-inputline bg-inputbg px-2.5 py-2 text-[13px] text-ink outline-none focus:border-[oklch(0.58_0.115_42_/_0.5)]";

/* ---------- toast ---------- */

const ToastContext = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setToast(msg);
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-[oklch(0.97_0.01_85)] shadow-[0_8px_24px_oklch(0.3_0.02_60_/_0.25)]">
          {toast}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** fetch wrapper that surfaces API error messages */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

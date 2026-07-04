"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

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

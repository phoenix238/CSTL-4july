"use client";

import {
  SESSION_TYPE_LABEL,
  SESSION_TYPE_MINUTES,
  sessionPrice,
  type Clinic,
  type SessionType,
} from "@/lib/booking/rules";

/**
 * What each kind of session is, in a sentence — shown where a client is
 * choosing, so they know exactly what they're booking before they pick a time.
 */
export const SESSION_TYPE_BLURB: Record<SessionType, string> = {
  cst: "Gentle, hands-on craniosacral work to help your nervous system settle and your body find its own balance.",
  clean:
    "Around 25 minutes of Clean Language first, giving voice to what your body is holding, then the hands-on craniosacral work.",
};

/**
 * Choose between the standard 60-minute craniosacral session and the 90-minute
 * Clean Language + craniosacral session. The standard session is always the one
 * selected to begin with; the longer session is there to be chosen on purpose.
 * Price follows the clinic already picked, so the card says what they'll pay.
 */
export function SessionTypePicker({
  value,
  onChange,
  clinic,
}: {
  value: SessionType;
  onChange: (type: SessionType) => void;
  clinic: Clinic;
}) {
  return (
    <div role="radiogroup" aria-label="Choose your session" className="grid gap-2.5 sm:grid-cols-2">
      {(["cst", "clean"] as const).map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(type)}
            className={`flex cursor-pointer flex-col gap-1.5 rounded-[14px] border px-4 py-3.5 text-left transition-colors select-none ${
              active
                ? "border-clay bg-clay-tint shadow-[inset_0_0_0_1px_var(--color-clay)]"
                : "border-line bg-card hover:bg-hoverbg"
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="font-serif text-[17px] leading-tight font-medium text-ink">
                {SESSION_TYPE_LABEL[type]}
              </span>
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  active ? "bg-clay text-cream" : "bg-hoverbg text-ink-soft"
                }`}
              >
                {SESSION_TYPE_MINUTES[type]} min
              </span>
            </span>
            <span className="text-[12.5px] leading-relaxed text-muted">{SESSION_TYPE_BLURB[type]}</span>
            <span className={`text-[13px] font-semibold ${active ? "text-clay-text" : "text-ink-soft"}`}>
              {sessionPrice(clinic, type)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

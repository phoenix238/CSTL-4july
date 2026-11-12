"use client";

import { DepositCheckout, type DepositCheckoutSession } from "./DepositCheckout";
import { WaterlooContact } from "./WaterlooContact";
import { useState } from "react";
import { api, Card, PrimaryButton, Sheet, inputClass, useToast } from "./ui";
import { BookSlotPicker } from "./BookSlotPicker";
import { BookingConfirmation } from "./BookingConfirmation";
import { EmbedBridge, scrollEmbedToTop } from "./EmbedBridge";
import { CLINIC_BOOKING_LABEL, CLINIC_PRICE, type Clinic } from "@/lib/booking/rules";
import { fmtDayLong, fmtTime } from "@/lib/time";
import type { ClientCopy } from "@/lib/clientCopy";

/**
 * Told when a booking is genuinely confirmed, so the parent page's GA4 can
 * record where the booking actually came from — this app carries no GA tag
 * of its own (see the comment on the pre-warm iframe in the site's
 * index.html for why). Posted to an explicit origin allowlist, never '*':
 * only one of these matches the actual parent at a time, and postMessage
 * silently skips delivery to the ones that don't, so it's safe to try all
 * three the site is ever embedded from.
 */
const REMEMBERED_BOOKING_DETAILS = "cstl-booking-details";

function readRememberedEmail(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(REMEMBERED_BOOKING_DETAILS) ?? "null");
    if (typeof value?.email !== "string") return null;
    if ("name" in value) localStorage.setItem(REMEMBERED_BOOKING_DETAILS, JSON.stringify({ email: value.email }));
    return value.email;
  } catch {
    return null;
  }
}

const SITE_ORIGINS = [
  "https://craniosacraltherapylondon.com",
  "https://phoenix238.github.io",
  "http://localhost:8090",
];

function notifyParentOfBooking(clinic: Clinic) {
  if (window.parent === window) return; // not embedded — nothing to tell
  for (const origin of SITE_ORIGINS) {
    window.parent.postMessage({ type: "cstl:booking_confirmed", clinic }, origin);
  }
}

function MapsLink({ address }: { address: string }) {
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center gap-1 font-semibold text-clay-text underline decoration-clay/40 underline-offset-2 hover:text-clay"
    >
      <span aria-hidden="true">📍</span>
      Open in Google Maps
    </a>
  );
}

export function BookingFlow({
  waterlooAddress,
  bethnalAddress,
  waterlooNote,
  bethnalNote,
  copy,
  embedded = false,
}: {
  waterlooAddress: string;
  bethnalAddress: string;
  waterlooNote: string;
  bethnalNote: string;
  copy: ClientCopy;
  /** shown inside the website's iframe — no page heading, minimal padding */
  embedded?: boolean;
}) {
  const toast = useToast();
  const [clinic, setClinic] = useState<Clinic>("bethnal");
  const [selected, setSelected] = useState<string | null>(null);
  // Separate from `selected` on purpose. Closing the box leaves the time they
  // picked highlighted in the list behind it, and the box needs to keep
  // rendering that time all the way through its closing animation.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState(""); // honeypot — real visitors never see or fill this
  const [submitting, setSubmitting] = useState(false);
  const [checkout, setCheckout] = useState<DepositCheckoutSession | null>(null);
  // Set when the email they typed already has a record. We stop and ask rather
  // than booking, so the same person doesn't end up as two clients (and so we
  // never book into someone else's record off a mistyped address).
  const [recognised, setRecognised] = useState<{ prompt: string; intakeDone: boolean } | null>(null);
  const [rememberDetails, setRememberDetails] = useState(false);
  const [hasRememberedDetails, setHasRememberedDetails] = useState(false);
  const [returningOnly, setReturningOnly] = useState(false);
  const [emailReview, setEmailReview] = useState<"editing" | "sent" | "booked" | null>(null);
  const [linkSending, setLinkSending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  async function sendMyLink() {
    setLinkSending(true);
    try {
      await api("/api/portal/send-link", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setLinkSent(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send that just now");
    } finally {
      setLinkSending(false);
    }
  }
  const [confirmed, setConfirmed] = useState<{
    whenLabel: string;
    email: string;
    intakeUrl: string;
    emailSent: boolean;
    returning: boolean;
    intakeDone: boolean;
  } | null>(null);

  const address = clinic === "waterloo" ? waterlooAddress : bethnalAddress;
  const note = clinic === "waterloo" ? waterlooNote : bethnalNote;

  interface BookResponse {
    whenLabel: string;
    emailSent: boolean;
    intakeUrl: string;
    returning: boolean;
    intakeDone: boolean;
    /** the email is already on a record — confirm it's them before booking */
    needsConfirm?: boolean;
    needsEmailReview?: boolean;
    checkout?: DepositCheckoutSession;
    prompt?: string;
  }

  async function submit(confirmReturning = false) {
    if (!selected) {
      toast("Pick a time first");
      return;
    }
    if (!returningOnly && !name.trim()) {
      toast("Please add your name");
      return;
    }
    if (!email.trim()) {
      toast("Please add your email");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<BookResponse>("/api/public/book", {
        method: "POST",
        body: JSON.stringify({ clinic, startISO: selected, name, email, phone, company, confirmReturning, returningOnly }),
      });
      if (result.needsEmailReview) {
        setEmailReview("editing");
        return;
      }
      if (result.needsConfirm) {
        setRecognised({ prompt: result.prompt ?? "Is this you?", intakeDone: result.intakeDone });
        return;
      }
      if (rememberDetails) {
        try {
          localStorage.setItem(REMEMBERED_BOOKING_DETAILS, JSON.stringify({ email: email.trim() }));
        } catch {
          // Private browsers can disallow storage. Booking still succeeds.
        }
      }
      if (result.checkout) {
        setCheckout(result.checkout);
        return;
      }
      notifyParentOfBooking(clinic);
      scrollEmbedToTop();
      setConfirmed({
        whenLabel: result.whenLabel,
        email,
        intakeUrl: result.intakeUrl,
        emailSent: result.emailSent,
        returning: result.returning,
        intakeDone: result.intakeDone,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't book that — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestEmailUpdate() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const result = await api<{ booked: boolean }>("/api/public/returning-client", {
        method: "POST",
        body: JSON.stringify({ name, email, phone, company, clinic, startISO: selected }),
      });
      if (result.booked) notifyParentOfBooking(clinic);
      setEmailReview(result.booked ? "booked" : "sent");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn’t send your request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) {
    return (
      <BookingConfirmation
        whenLabel={confirmed.whenLabel}
        emailSent={confirmed.emailSent}
        email={confirmed.email}
        intakeUrl={confirmed.intakeUrl}
        returning={confirmed.returning}
        intakeDone={confirmed.intakeDone}
        copy={copy}
      />
    );
  }

  // Backing out mid-way shouldn't strand them: the box closes, the time stays
  // highlighted in the list behind it, and tapping any time re-opens it with
  // whatever they'd already typed still in the fields.
  async function closeSheet() {
    if (submitting) return;
    if (checkout) {
      setSubmitting(true);
      try {
        const { released } = await api<{ released: boolean }>("/api/public/deposit/abandon", {
          method: "POST", body: JSON.stringify({ id: checkout.id }),
        });
        if (!released) {
          toast("Please check your payment and booking before closing checkout.");
          return;
        }
      } catch {
        toast("We couldn’t close checkout safely. Please check your payment and booking.");
        return;
      } finally {
        setSubmitting(false);
      }
    }
    setSheetOpen(false);
    setCheckout(null);
    setRecognised(null);
    setEmailReview(null);
    setReturningOnly(false);
    setLinkSent(false);
  }

  return (
    <div className={embedded ? "px-1 py-1" : "mx-auto max-w-[820px] px-5 py-10"}>
      {!embedded && (
        <header className="mb-6 text-center">
          <h1 className="font-serif text-[28px] leading-[1.1]">{copy.bookPageTitle}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-line text-muted">{copy.bookPageIntro}</p>
        </header>
      )}

      <Card className="flex flex-col gap-4 px-5 py-6">
        <div className="flex rounded-full border border-line bg-[oklch(0.955_0.012_82)] p-[3px]">
          {(["bethnal", "waterloo"] as const).map((c) => (
            <button
              key={c}
              onClick={() => {
                setClinic(c);
                setSelected(null);
                setSheetOpen(false);
              }}
              className={`flex-1 cursor-pointer rounded-full px-3.5 py-2 text-[13px] font-semibold select-none ${
                clinic === c ? "bg-clay text-cream" : "text-[oklch(0.45_0.02_60)]"
              }`}
            >
              {CLINIC_BOOKING_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 text-[12.5px] text-muted">
          <div>{CLINIC_PRICE[clinic]} · 60 minutes</div>
          {address && (
            <div className="flex flex-col gap-1 text-[12px] leading-relaxed text-[oklch(0.45_0.02_60)]">
              <span>{address}</span>
              <MapsLink address={address} />
            </div>
          )}
          {note && <p className="text-[12px] leading-relaxed whitespace-pre-line text-[oklch(0.45_0.02_60)]">{note}</p>}
        </div>

        {clinic === "waterloo" ? <WaterlooContact /> : <BookSlotPicker
          clinic={clinic}
          selected={selected}
          onSelect={(iso) => {
            const remembered = readRememberedEmail();
            if (remembered) {
              setEmail((current) => current || remembered);
              setRememberDetails(true);
              setHasRememberedDetails(true);
            }
            setSelected(iso);
            setRecognised(null);
            setSheetOpen(true);
            // In the website's frame, bring the whole box on screen first so the
            // form doesn't open squeezed into a sliver of it.
            scrollEmbedToTop();
          }}
          boxed={false}
          layout="responsive"
        />}
      </Card>

      <Sheet open={sheetOpen} onClose={closeSheet} label="Your details">
        {selected && (
          <div className="flex flex-col gap-4 px-5 py-5 pb-[calc(20px+env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-serif text-[19px] leading-tight font-medium">
                  {recognised ? recognised.prompt : "Your details"}
                </div>
                <div className="mt-1 text-[12.5px] text-muted">
                  {CLINIC_BOOKING_LABEL[clinic]} · {fmtDayLong(new Date(selected))} at {fmtTime(new Date(selected))}
                </div>
              </div>
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close"
                className="-mt-1 -mr-1 shrink-0 cursor-pointer rounded-full px-2 py-1 text-[17px] leading-none text-muted hover:bg-hoverbg hover:text-ink"
              >
                ×
              </button>
            </div>

            {/* Recognised them: one tap to book into the record they already have,
                one to back out if the address isn't theirs. Nothing is booked
                either way until they answer, so a wrong guess here costs nothing. */}
            {checkout ? (
              <DepositCheckout session={checkout} onBooked={(result) => {
                notifyParentOfBooking("bethnal");
                scrollEmbedToTop();
                setConfirmed({ ...result, email, returning: false, intakeDone: false });
              }} />
            ) : emailReview === "booked" ? (
              <div role="status" className="flex flex-col gap-2">
                <p className="font-semibold text-sage-text">Your appointment is booked.</p>
                <p className="text-sm text-ink-soft">Phoenix will check and update your contact details. If he needs anything else, he’ll email you. No deposit is due.</p>
              </div>
            ) : emailReview === "sent" ? (
              <p role="status" className="text-sm text-sage-text">
                Request sent. I’ll check your details and get back to you. Your appointment hasn’t been booked yet.
              </p>
            ) : emailReview === "editing" ? (
              <form className="flex flex-col gap-3" onSubmit={(event) => {
                event.preventDefault();
                void requestEmailUpdate();
              }}>
                <p className="text-sm text-ink-soft">
                  This email doesn’t match the details I have. Enter the phone number you used last time and I’ll check your record and add your new email.
                </p>
                <label className="flex flex-col gap-1.5 text-sm">
                  Current email
                  <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  Full name
                  <input className={inputClass} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  Phone number you used last time
                  <input className={inputClass} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} required />
                </label>
                <PrimaryButton type="submit" disabled={submitting}>{submitting ? "Checking…" : "Check my number and book"}</PrimaryButton>
                <button type="button" className="text-sm text-clay-text underline" onClick={() => setEmailReview(null)} disabled={submitting}>Try my previous email</button>
              </form>
            ) : recognised ? (
              <div key="recognised" className="ct-swap flex flex-col gap-3">
                <p className="text-[13.5px] leading-relaxed text-muted">
                  {recognised.intakeDone
                    ? "If so, I'll add this session to your existing record — no intake form to fill in this time."
                    : "If so, I'll add this session to your existing record rather than starting a new one."}
                </p>
                <p className="text-[13px] leading-relaxed text-muted">
                  Booking as <span className="font-semibold text-ink-soft">{name.trim()}</span> · {email.trim()}
                </p>
                <div className="flex flex-col gap-2.5">
                  <PrimaryButton onClick={() => submit(true)} disabled={submitting} className="py-3">
                    {submitting ? "Booking…" : "Yes, that's me — book it"}
                  </PrimaryButton>
                  <button
                    onClick={() => {
                      // Clear the address rather than send them back to a form
                      // still holding the one we just told them belongs to
                      // someone else.
                      setEmail("");
                      setRecognised(null);
                    }}
                    className="cursor-pointer rounded-full border border-line bg-card px-4 py-2.5 text-[13px] font-semibold text-clay-text hover:bg-hoverbg"
                  >
                    No — let me use a different email
                  </button>
                </div>
                {linkSent ? (
                  <p className="text-center text-[13px] font-medium text-sage-text">
                    Sent — check your email for your booking page link.
                  </p>
                ) : (
                  <button
                    onClick={sendMyLink}
                    disabled={linkSending}
                    className="cursor-pointer text-center text-[12.5px] font-semibold text-clay-text underline hover:text-clay disabled:cursor-default disabled:opacity-60"
                  >
                    {linkSending ? "Sending…" : "Or just email me my page link"}
                  </button>
                )}
                <p className="text-[12px] leading-relaxed text-muted">
                  If you&apos;re booking for someone else, please use their own email address so their notes stay
                  theirs.
                </p>
              </div>
            ) : (
              <form
                key="details"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(returningOnly);
                }}
                className="ct-swap flex flex-col gap-3"
              >
                {!returningOnly && (
                  <button type="button" onClick={() => setReturningOnly(true)}
                    className="rounded-xl border border-line bg-card px-4 py-3 text-left text-sm font-semibold text-clay-text hover:bg-hoverbg">
                    Seen Phoenix before? <span className="underline underline-offset-2">Click here</span>
                  </button>
                )}
                {!returningOnly && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12.5px] font-semibold text-ink-soft">Full name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-semibold text-ink-soft">{returningOnly ? "Email you booked with last time" : "Email"}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    className={inputClass}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={rememberDetails} onChange={(event) => {
                      setRememberDetails(event.target.checked);
                      if (!event.target.checked) {
                        try { localStorage.removeItem(REMEMBERED_BOOKING_DETAILS); } catch { /* Storage unavailable. */ }
                        setHasRememberedDetails(false);
                      }
                    }} />
                    Remember my email on this device
                  </label>
                  {hasRememberedDetails && (
                    <button type="button" className="text-clay-text underline" onClick={() => {
                      const remembered = readRememberedEmail();
                      try { localStorage.removeItem(REMEMBERED_BOOKING_DETAILS); } catch { /* Storage unavailable. */ }
                      if (email === remembered) setEmail("");
                      setHasRememberedDetails(false);
                      setRememberDetails(false);
                    }}>Forget saved email</button>
                  )}
                </div>
                {!returningOnly && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12.5px] font-semibold text-ink-soft">Phone (optional)</span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                      inputMode="tel"
                      className={inputClass}
                    />
                  </label>
                )}
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute left-[-9999px] h-0 w-0 opacity-0"
                />
                <PrimaryButton type="submit" disabled={submitting} className="mt-1 py-3">
                  {submitting ? "Checking…" : returningOnly ? "Confirm booking" : "Continue to booking"}
                </PrimaryButton>
              </form>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

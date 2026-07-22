import { Card, PrimaryButton } from "./ui";

/**
 * The "You're booked" screen shown after any client-facing booking — the public
 * /book page and the offer-pick page both land here, so the confirmation and its
 * intake invite read in one consistent voice rather than drifting apart.
 */
export function BookingConfirmation({
  whenLabel,
  emailSent,
  email,
  intakeUrl,
}: {
  whenLabel: string;
  emailSent: boolean;
  /** the address the confirmation was sent to — omitted from the copy if empty */
  email?: string;
  intakeUrl: string;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
        ✓
      </div>
      <div className="font-serif text-2xl font-medium">You&apos;re booked</div>
      <p className="text-[14px] leading-relaxed text-muted">
        {whenLabel}.{" "}
        {emailSent
          ? `A confirmation email is on its way${email ? ` to ${email}` : ""}, with your calendar invite, the address, and everything else you need.`
          : "Your slot is confirmed — we're just having trouble getting the confirmation email out, so we'll be in touch with the details another way. Feel free to fill out the intake form below in the meantime."}
      </p>

      <Card className="mt-2 flex w-full flex-col gap-2.5 px-5 py-5 text-left">
        <div className="text-[13px] font-semibold">Before your session: the intake form</div>
        <p className="text-[12.5px] leading-relaxed text-muted">
          A short form covering your health history and what you&apos;d like from the session. It takes about 3
          minutes and helps Phoenix prepare properly before you arrive — worth doing ahead of time rather than on the
          day. We&apos;ve also emailed you this link.
        </p>
        <a href={intakeUrl} target="_blank" rel="noopener noreferrer" className="self-start">
          <PrimaryButton className="px-5 py-2.5">Fill out the intake form</PrimaryButton>
        </a>
      </Card>
    </div>
  );
}

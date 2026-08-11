import { Card, PrimaryButton } from "./ui";
import { applyCopy, type ClientCopy } from "@/lib/clientCopy";

export type ConfirmationCopy = Pick<
  ClientCopy,
  | "confirmTitle"
  | "confirmBodySent"
  | "confirmBodyPending"
  | "confirmIntakeCardTitle"
  | "confirmIntakeCardBody"
  | "confirmReturningNote"
>;

/**
 * The "You're booked" screen shown after any client-facing booking — the public
 * /book page and the offer-pick page both land here, so the confirmation and its
 * intake invite read in one consistent voice rather than drifting apart. All the
 * wording comes from Settings (clientCopy).
 */
export function BookingConfirmation({
  whenLabel,
  emailSent,
  email,
  intakeUrl,
  returning = false,
  intakeDone = false,
  copy,
}: {
  whenLabel: string;
  emailSent: boolean;
  /** the address the confirmation was sent to — omitted from the copy if empty */
  email?: string;
  intakeUrl: string;
  /** booked into an existing client record rather than a new one */
  returning?: boolean;
  /** they've already filled the intake form in at some point */
  intakeDone?: boolean;
  copy: ConfirmationCopy;
}) {
  const emailLine = email ? ` to ${email}` : "";
  // A returning client who has already filled the form in is not asked for it
  // again. Asking is what made a rebooking feel like a first booking, and it's
  // the same reason their email is a confirmation rather than a whole welcome.
  const showIntake = !(returning && intakeDone);
  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-sage-tint text-2xl text-sage-text">
        ✓
      </div>
      <div className="font-serif text-2xl font-medium">{copy.confirmTitle}</div>
      <p className="text-[14px] leading-relaxed text-muted">
        {whenLabel}.{" "}
        {emailSent ? applyCopy(copy.confirmBodySent, { emailLine }) : copy.confirmBodyPending}
      </p>

      {showIntake ? (
        <Card className="mt-2 flex w-full flex-col gap-2.5 px-5 py-5 text-left">
          <div className="text-[13px] font-semibold">{copy.confirmIntakeCardTitle}</div>
          <p className="text-[12.5px] leading-relaxed text-muted">{copy.confirmIntakeCardBody}</p>
          <a href={intakeUrl} target="_blank" rel="noopener noreferrer" className="self-start">
            <PrimaryButton className="px-5 py-2.5">Fill out the intake form</PrimaryButton>
          </a>
        </Card>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted">{copy.confirmReturningNote}</p>
      )}
    </div>
  );
}

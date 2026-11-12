export type DepositCancellation = "refund_requested" | "late_review" | "refund_review";

export function depositCancellationText(outcome: DepositCancellation) {
  switch (outcome) {
    case "refund_requested":
      return "We’ve asked Stripe to return your full £15 deposit to your original payment method.";
    case "late_review":
      return "This cancellation was less than 24 hours before your appointment. Phoenix will review your £15 deposit.";
    case "refund_review":
      return "Phoenix will follow up about returning your £15 deposit.";
  }
}

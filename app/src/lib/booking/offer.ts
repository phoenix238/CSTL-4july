import { fmtDayLong, fmtTime } from "@/lib/time";
import { CLINIC_LABEL, type Clinic } from "./rules";

/**
 * The message offering a client a few times to choose from. Pure — used both
 * for the email (server) and the WhatsApp text (client) so they read the same.
 */
export function composeOfferMessage(clientName: string, clinic: Clinic, times: Date[]): string {
  const first = clientName?.trim() ? clientName.trim().split(/\s+/)[0] : "there";
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  const lines = sorted.map((t) => `  • ${fmtDayLong(t)} at ${fmtTime(t)}`);
  return (
    `Hi ${first},\n\n` +
    `Lovely to hear from you. I've got a few times that could work at ${CLINIC_LABEL[clinic]} — ` +
    `let me know which suits and I'll confirm it:\n\n` +
    `${lines.join("\n")}\n\n` +
    `Warm wishes,\nPhoenix`
  );
}

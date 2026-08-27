import { projectAvailabilityToCalendar } from "./availabilitySync";

/**
 * Push the app's current availability onto the Google calendar after an in-app
 * change (an override added/edited/removed, or the weekly hours saved).
 *
 * Deliberately never throws: the DB change has already committed and is the
 * source of truth, so a Google hiccup must not fail the user's save — the next
 * sync (calendar open or the daily cron) reconciles the calendar either way. It
 * IS awaited, though: on serverless, work left running after the response is
 * killed, so fire-and-forget wouldn't actually push anything. No-ops when the
 * availability calendar isn't connected.
 */
export async function syncAvailabilityAfterChange(): Promise<void> {
  try {
    await projectAvailabilityToCalendar();
  } catch (err) {
    console.error("Availability → Google projection failed (change still saved)", err);
  }
}

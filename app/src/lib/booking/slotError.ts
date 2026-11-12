/** A competing booking or checkout has taken the requested time. */
export class SlotTakenError extends Error {
  constructor() {
    super("That time isn't available anymore — please pick another.");
    this.name = "SlotTakenError";
  }
}

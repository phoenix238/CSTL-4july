import { PHOENIX_CONTACT_EMAIL } from "@/lib/booking/contact";

export function WaterlooContact() {
  return (
    <div className="rounded-lg bg-clay-tint px-3.5 py-3 text-sm text-clay-text">
      <h2 className="font-semibold">Contact Phoenix</h2>
      <p>To arrange a Waterloo appointment, email{" "}
        <a className="underline" href={`mailto:${PHOENIX_CONTACT_EMAIL}`}>{PHOENIX_CONTACT_EMAIL}</a>.
      </p>
    </div>
  );
}

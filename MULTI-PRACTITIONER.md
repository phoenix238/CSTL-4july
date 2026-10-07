# Onboarding a second practitioner (Emily Yung)

## Where things stand

The control tower is built for **one practitioner**. Specifically:

- **Sign-in** — only `ALLOWED_EMAIL` can sign in (`app/src/lib/auth.ts`).
- **Settings** — one shared row (`AppSettings`, id = 1): one Google connection, one set of calendars, one Drive folder, one bank account.
- **Clients, bookings, notes, payments** — none of these records says which practitioner it belongs to.
- **Clinics** — hard-wired: Waterloo (R5 room calendar) and Bethnal Green (Chalk Farm shared block), with Phoenix's prices (`app/src/lib/booking/rules.ts`).

## Two ways to give Emily her own system

| | **A. Her own copy (recommended now)** | **B. One shared system, many practitioners** |
|---|---|---|
| What it is | Same code. Emily gets her own Vercel project, her own database and her own Google sign-in. | One app. A `Practitioner` table, and every client/booking/note/payment row tagged with whose it is. |
| "We each log into our own system" | Yes. Two separate URLs, each locked to one Google account. | Yes. One URL; who you are decides what you see. |
| Risk to client health records | **None.** Her clients and Phoenix's never share a database. | **High.** One query that forgets the practitioner filter shows one practitioner's case notes to the other. There are hundreds of queries. |
| Work to get there | About 40 minutes of setup (follow `SETUP.md`), plus clearing out the Phoenix-specific wording. Most of that clearing-out is done in this change. | Weeks: schema migration on live data, scoping every query, per-practitioner Google tokens, per-practitioner public URLs (`/book/emily`), crons that loop over practitioners. |
| Code updates | Every project tracks this repo, so one push updates both. | One deploy. |
| Shared things (one clinic calendar, a combined dashboard) | Not possible. | Possible. |

**Recommendation: A now. Move to B only if you need something shared between practitioners** (a combined diary, one booking page for both, shared rooms). B is a project of its own, not an upgrade to tack on.

## What Emily needs to change before she goes live

Done in this change (Settings › The messages clients receive):

- **Her name, everywhere.** "Your details" holds first name, full name and practice name. Every email can say `{yourName}`, `{yourFullName}` or `{practiceName}`, and the inbox "From" name follows her full name.
- **Every client email is editable**, each labelled with when it goes out, who gets it, and whether it sends itself or waits for a button. That covers 11 emails: the 5 that were editable before, plus 6 new ones:
  - session reminder
  - session moved
  - session cancelled
  - payment reminder
  - receipt
  - booking-page link
- **A "Send me a test" button** sits inside each email.
- **A sign-off ending in her name** is recognised, so emails never sign off twice.
- **The intake consent text** names her as the person holding the client's data. It used to say "permission for Phoenix", which named the wrong data controller for her clients.

Still hard-wired to Phoenix (next pass, roughly in priority order):

1. **Clinics and prices.** Waterloo/Bethnal Green, "R5 - Phoenix" and the Chalk Farm block are coded in (`booking/rules.ts`, `google/chalkFarm.ts`). Emily's own locations need these turned into settings.
2. **Client-page and error wording.** About 15 short lines like "please message Phoenix directly", on the portal, booking errors, the sign-in page, the receipt PDF header and the calendar invite description. Each needs to switch to `{yourName}`.
3. **The AI enquiry reader prompt.** It describes "Phoenix Tanner, a craniosacral therapist with two London clinics" (`app/src/lib/claude.ts:83`).
4. **The Gmail add-on** (`gmail-addon/`). It points at one app URL.

## Scorecard (jury of two practitioner personas, 0–10)

| | Before | After |
|---|---|---|
| Emily Yung (new, non-technical) | 3.5 | see PR |
| Phoenix Tanner (owner, daily user) | 6.5 | see PR |

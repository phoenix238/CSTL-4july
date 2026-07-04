# CSTL Control Tower

Phoenix Tanner's booking & documentation control tower — the real, working build of the
design in `../project/CSTL Control Tower.dc.html`.

**To get it running, follow [`SETUP.md`](./SETUP.md)** — a click-by-click guide
(≈30–40 min, one time only). After that it lives at your own Vercel URL, on laptop and
phone, and updates itself whenever this repo changes.

## What it does

- **Today** — who's coming in, intake status, one-tap "Go to client", needs-attention rail.
- **Enquiries** — paste a WhatsApp/email message; Claude reads out the name, phone and
  clinic preference (one-tap override), shows a 7-day grid fed by your real Google
  Calendar, and books with the exact event logic:
  - *Waterloo*: "(Client) — Waterloo" on your personal calendar + "R5 - Phoenix" on the
    room calendar (both 1 h, reminders on).
  - *Bethnal Green*: 2 h "Phoenix" block on the Chalk Farm calendar with the 1 h
    "(Client) — Bethnal Green" session centred inside it.
  - New clients get the welcome email (editable before sending) with intake-form link,
    access note and optional payment details; returning clients just get the invite.
    "Copy text & register — no email" books without emailing.
  - Rebooking an existing client frees their old slot (old events are deleted).
- **Clients** — search, one record per person, full profile, editable details, session
  notes with real voice dictation + Claude bullet summaries, saved to their Google Doc.
- **Every client** gets `Drive › CSTL › Clients › (name)` with a Doc; the marketing
  spreadsheet (`Drive › CSTL › Clients › Docs`) tracks email + consent.
- **Calendar** — the week at a glance, personal + room/block events side by side.
- **Import** — drop old files; Claude extracts client records, duplicates are merged,
  originals stored in each client's folder, legacy notes appended to their Doc.
- **Settings** — clinic rules, access note, per-location email templates, Google wiring.

## Tech

Next.js 15 (App Router) · TypeScript · Tailwind 4 · Auth.js (Google) · Prisma + Postgres
(index only — Google Docs remain the source of truth for notes) · googleapis ·
Anthropic Claude · deployed on Vercel.

```bash
# local development (after SETUP.md, with app/.env filled in)
cd app
npm install
npx prisma db push   # first time only
npm run dev          # http://localhost:3000

npm test             # booking-rule unit tests
npm run typecheck
npm run build
```

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
- **Clients** — search, one record per person, full profile, editable details, the case
  history sheet, and session notes with real voice dictation + Claude bullet summaries,
  saved to their Google Doc.
- **Link an existing Doc** — a client whose case history already lives in a Google Doc
  (or whose link got broken) can be pointed straight at it from their profile: search
  your Docs by name or paste the link, and it becomes their record — nothing copied or
  moved — with the option to pull what's already in it into the profile.
- **Every client** gets `Drive › CSTL › Clients › (name)` with a Doc; the marketing
  spreadsheet (`Drive › CSTL › Clients › Docs`) tracks email + consent.
- **Case history** — every client Doc carries the same headers, in the same order, off
  Phoenix's own sheet: *at a glance*, **1. the intake form as they submitted it**, then
  reasons for coming / symptoms · history · accidents and injuries (old/new) · surgery,
  illness, hospital, trauma, stress (old/new) · family (mother, father, husband, wife,
  children, siblings) · drugs (present, past, smoking, alcohol) · diet · birth ·
  dentistry · body language · additional information, then **13. session log** — newest
  first — and **14. consent & data**. Take it or add to it from the client's profile;
  saving rewrites their Doc from it.
- **The intake form fills the case history in advance** — that's the point of it. Each
  question is mapped to the box it feeds, so what a client sends back is already in the
  sheet, tagged with where it came from, and doesn't have to be asked again in the room.
  The mapping is shown in Settings and survives re-wording a question.
- **Every session** records four things — how they'd been between sessions, the note
  itself, your reflections, and thoughts for next time — and lands at the top of the
  Doc's session log.
- **Reformatting old Docs** — new Docs are created on the layout; the **Case history**
  screen brings existing ones onto it, one client at a time or all of them, sorting each
  Doc's current text into the sections and keeping the whole of it underneath as
  *Original record*. Nothing is deleted, and Doc links don't change.
- **Personal** — Phoenix's own writing, in one place: reflections on a session tagged
  with the client, or just thinking, tagged with nobody. Dictate or type, search back
  through them, filter by client, edit or delete. Everything is also appended to the
  "Phoenix session reflections" Doc in Drive, linked from the tab.
- **Calendar** — the week at a glance, personal + room/block events side by side.
- **Import** — drop old files; Claude extracts client records, duplicates are merged,
  originals stored in each client's folder, legacy notes written into their Doc under
  *Original record*, ready for the Case history pass to sort into sections.
- **Settings** — clinic rules, access note, per-location email templates, Google wiring.
- **Gmail add-on** (`../gmail-addon`) — a button inside Gmail (desktop + mobile) that turns
  an open client email into an enquiry here, one tap, with the reply landing back in the
  same Gmail thread. See `gmail-addon/README.md` for setup.

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

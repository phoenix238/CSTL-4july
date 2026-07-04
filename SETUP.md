# CSTL Control Tower — one-time setup

Follow this top to bottom, ticking each box. Nothing here needs coding — it's all
clicking through websites and copy-pasting values. Budget **30–40 minutes**.

You'll collect **6 values** along the way. Keep a note open and paste each one in as
you get it:

| # | Value | Where it goes (step 6) |
|---|-------|------------------------|
| 1 | `DATABASE_URL` | Vercel env vars |
| 2 | `AUTH_SECRET` | Vercel env vars |
| 3 | `AUTH_GOOGLE_ID` | Vercel env vars |
| 4 | `AUTH_GOOGLE_SECRET` | Vercel env vars |
| 5 | `ALLOWED_EMAIL` | Vercel env vars |
| 6 | `OPENROUTER_API_KEY` | Vercel env vars |

---

## 1. Create the free database (5 min)

The app keeps a fast index of clients & bookings here (your notes still live in
Google Docs — this is just the address book).

1. Go to **https://neon.tech** → "Sign up" → sign up with Google (use your normal account).
2. It asks to create a project: name it `cstl` and pick region **Europe (London / eu-west-2)** if offered, otherwise the closest European one. Click **Create**.
3. On the project dashboard find **"Connection string"**. Choose **"Pooled connection"** if there's a toggle.
4. Copy the whole string (starts with `postgresql://…`). That's **value 1: `DATABASE_URL`** ✅

## 2. Create the Google connection (15 min — the fiddly one)

This lets the app create your calendar events, Drive folders, Docs, the marketing
sheet, and send emails **as you**. It's your own private "app registration" — nobody
else can use it.

### 2a. The project

1. Go to **https://console.cloud.google.com** and sign in with the Google account that has your calendars/Drive/Gmail.
2. Top bar → project picker → **"New project"**. Name: `CSTL Control Tower` → **Create** → make sure it's selected (top bar shows the name).

### 2b. Turn on the five APIs

1. Left menu (☰) → **"APIs & Services" → "Library"**.
2. Search and click **Enable** for each of these, one at a time:
   - **Google Calendar API**
   - **Google Drive API**
   - **Google Docs API**
   - **Gmail API**
   - **Google Sheets API**

### 2c. The consent screen

1. ☰ → **"APIs & Services" → "OAuth consent screen"**.
2. If asked, choose **"External"** → Create.
3. App name: `CSTL Control Tower`. Support email: your email. Developer contact: your email. **Save and continue** through the remaining pages (no changes needed).
4. Back on the overview: under **"Test users"** (in the "Audience" section) click **+ Add users** and add **your own email**. Save.
   - *Staying in "Testing" mode is fine — you're the only user. Google will just show one extra "unverified app" warning at first sign-in; click "Advanced → Go to CSTL Control Tower" once and it remembers.*

### 2d. The keys

1. ☰ → **"APIs & Services" → "Credentials"** → **+ Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `cstl-web`.
3. Under **"Authorised redirect URIs"** click **+ Add URI** and add **both** of these (you'll add your final Vercel URL here again in step 7):
   - `http://localhost:3000/api/auth/callback/google`
   - `https://TEMPORARY.vercel.app/api/auth/callback/google` (placeholder — updated in step 7)
4. Click **Create**. A box pops up with:
   - **Client ID** → **value 3: `AUTH_GOOGLE_ID`** ✅
   - **Client secret** → **value 4: `AUTH_GOOGLE_SECRET`** ✅

## 3. Two small values (1 min)

- **value 2: `AUTH_SECRET`** — any long random password. Easiest: go to https://generate-secret.vercel.app/32 and copy what it shows. ✅
- **value 5: `ALLOWED_EMAIL`** — your own Gmail address (the one from step 2). Only this account will be able to sign in. ✅

## 4. OpenRouter API key (3 min)

Powers the "reads the enquiry message" and "summarise my note" features (routed to Claude Haiku).

1. Go to **https://openrouter.ai** → sign up / sign in.
2. Add credit under **Settings → Credits** (a few pounds covers a long time — usage is pennies per month).
3. **Settings → API Keys → Create key**, name it `cstl`. Copy it — **value 6: `OPENROUTER_API_KEY`** ✅

## 5. Put the code on GitHub (if it isn't already)

This repo is the app. If you're reading this on GitHub, done — go to step 6.

## 6. Deploy on Vercel (5 min)

1. Go to **https://vercel.com** → **Sign up → Continue with GitHub**.
2. **Add New… → Project** → find this repository → **Import**.
3. **Root Directory**: click **Edit** and pick the **`app`** folder. (Important!)
4. Open **Environment Variables** and add all six, exactly as named:
   `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAIL`, `ANTHROPIC_API_KEY`.
5. Click **Deploy**. Two minutes later you get your URL, e.g. `https://cstl-control-tower.vercel.app`.

## 7. Close the loop (2 min)

1. Copy your real Vercel URL.
2. Back in Google Cloud → **Credentials → your `cstl-web` client** → replace the placeholder redirect URI with:
   `https://YOUR-REAL-URL.vercel.app/api/auth/callback/google` → Save.
3. In Vercel → your project → **Settings → Environment Variables**, add one more:
   `AUTH_URL` = `https://YOUR-REAL-URL.vercel.app` — then **Deployments → ⋯ → Redeploy** so it takes effect.

## 8. First sign-in & calendar wiring (5 min)

1. Open your URL → **Sign in with Google** → approve everything it asks (Calendar, Drive, Gmail, Sheets — this is your own app from step 2).
2. Go to **Settings** in the app → GOOGLE section → **Edit**:
   - **R5 room calendar ID** — in Google Calendar (web), find the room calendar in the left list → ⋮ → *Settings and sharing* → scroll to **"Integrate calendar" → Calendar ID** (looks like `abc123@group.calendar.google.com`). Paste it.
   - **Chalk Farm calendar ID** — same trick for the Chalk Farm calendar.
   - If either calendar doesn't exist yet: in Google Calendar → left panel → **"+ Other calendars" → Create new calendar**, name it, then grab its ID as above.
3. That's it. The `Drive › CSTL › Clients` folder and the marketing sheet create themselves the first time they're needed.

## 9. Two-minute test drive

1. **Enquiries** → paste a fake message: *"Hi Phoenix! I'm Testy McTest, tension headaches, I'm near Victoria Park so Bethnal Green suits. Could do Tuesday after 5? 07700 900000"* → **Read message** → it should suggest Bethnal Green and show the grid with your real calendar busy times.
2. Pick a slot → check the two events it promises → **Create events & send email** (no email address in the message, so it copies the text instead).
3. Check Google Calendar: a 2-hour "Phoenix" block on Chalk Farm + "Testy McTest — Bethnal Green" in the middle, both with reminders. ✅
4. Check Drive: `CSTL › Clients › Testy McTest` folder with a Doc. ✅
5. Open the client → **+ Add note** → **Dictate**, say a few sentences → **Summarise** → **Save to Doc** → the bullets + raw note appear in the Doc. ✅
6. Delete the test client's events from Google Calendar and the folder from Drive when you're done playing.

## On your phone

Open your Vercel URL in Safari/Chrome → Share → **"Add to Home Screen"**. It gets its
own icon and opens full-screen like an app.

## Everyday updates

You never repeat any of this. When new code is pushed to GitHub, Vercel redeploys the
live site automatically within a couple of minutes.

# CSTL Gmail add-on — one-time setup

Adds a button inside Gmail — desktop, Android and iOS — that turns an open client email
into an enquiry on your booking platform, one tap. Follow this top to bottom.
Budget **10 minutes**. Nothing here needs coding, just copy/paste.

You'll need your booking platform's live URL (the Vercel one from the main
`SETUP.md`, e.g. `https://cstl-control-tower.vercel.app`) and you'll invent one new
secret value.

## 1. Add the secret to the platform (2 min)

1. Make up a long random password — anything works, e.g. run
   `openssl rand -hex 32` in a terminal, or just mash the keyboard for 40 characters.
2. In Vercel: your project → **Settings → Environment Variables** → add
   `GMAIL_ADDON_SECRET` = (the value you just made up) → **Save**.
3. Redeploy the project (Vercel → Deployments → ⋯ on the latest one → **Redeploy**)
   so the new variable takes effect.

Keep that value handy — you'll paste it again in step 3.

## 2. Create the Apps Script project (3 min)

1. Go to **https://script.google.com** → **New project**.
2. Rename it (top left) to `CSTL Gmail Add-on`.
3. Delete the placeholder code in `Code.gs` and paste in the contents of this
   folder's `Code.gs`.
4. Add the manifest: ⚙️ **Project Settings** (left sidebar) → tick
   **"Show 'appsscript.json' manifest file in editor"**.
5. Back in the editor (`<>` icon), open `appsscript.json` and replace its
   contents with this folder's `appsscript.json`.
6. **Save** (Ctrl/Cmd+S).

## 3. Set the two Script Properties (2 min)

1. ⚙️ **Project Settings** → scroll to **Script Properties** → **Add script property**.
2. Add `APP_URL` = your platform's URL (no trailing slash), e.g.
   `https://cstl-control-tower.vercel.app`.
3. Add another: `ADDON_SECRET` = the same value you put in `GMAIL_ADDON_SECRET` in step 1.

## 4. Install it on your own account (3 min)

1. **Deploy → Test deployments** (top right) → **Install add-on**.
2. Confirm the permissions prompt (it's your own script, on your own account —
   this is expected). Google may show an "unverified app" warning since this is a
   private, unpublished add-on — click **Advanced → Go to CSTL Gmail Add-on** once.
3. Open **Gmail** — desktop web first. Open any email. Look for the add-on icons in
   the **right-hand sidebar**; you should see the CSTL icon. Click it, then tap
   **"Start CSTL enquiry"**.
4. It should open your booking platform in a new tab, already showing that email's
   content parsed out — name, requested time, real availability.
5. On your **phone** (Gmail app, Android or iOS), open the same email — the same
   add-on icon appears in the details view. It opens the platform in your mobile
   browser the same way.

That's it — no publishing, no Google review, since it's a private add-on installed
only on your own account. It stays installed until you remove it from
**script.google.com → Deploy → Test deployments → Uninstall**.

## How replies stay in the thread

When you send the confirmation (or an "offer some times") email from the platform
for an enquiry that started this way, it replies inside the original Gmail thread —
so if the same client emails again later, opening their new message and pressing
the button again finds their existing record (matched by email) and lets you offer
times or book their next session straight in, same as any other enquiry.

## Troubleshooting

- **No CSTL icon in Gmail** — reload Gmail fully (not just the tab); add-ons need a
  fresh page load to register after install.
- **"Set APP_URL and ADDON_SECRET..." notification** — a Script Property is missing
  or misspelled; re-check step 3.
- **"Couldn't reach the booking platform (401)"** — `ADDON_SECRET` here doesn't match
  `GMAIL_ADDON_SECRET` on Vercel, or the redeploy in step 1.3 hasn't happened yet.

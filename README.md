# NAQC Parts/Purchases Request — auto-routing e-signature app

Fill out a purchase order in the browser → requester signs → it emails the **Manager**,
who signs → it emails the **Coordinator**, who signs → (only if **Fixed Asset** or total
**$1,000+**) it emails the **Vice President**. When the last person signs, a fully-signed
PDF is emailed to everyone. **No Microsoft / SMTP needed** — email goes out through Resend
over normal HTTPS.

---

## What you need (all free)

1. **Node.js 18 or newer** — https://nodejs.org (the "LTS" download).
2. **A Resend account** for sending email — https://resend.com (free: ~3,000 emails/month).

---

## 1) Get your Resend key

1. Sign up at https://resend.com.
2. Go to **API Keys → Create API Key**, copy the key (starts with `re_...`).
3. (Optional but recommended) Under **Domains**, verify your own domain so emails come from
   `purchasing@yourcompany.com`. Until you do, you can send from `onboarding@resend.dev`
   for testing.

## 2) Configure the app

Open `server.js` and edit the `CONFIG` block near the top, **or** set these as environment
variables on your host (preferred — keeps the key out of the code):

| Setting | What to put |
|---|---|
| `RESEND_API_KEY` | your `re_...` key |
| `FROM_EMAIL` | `NAQC Purchasing <onboarding@resend.dev>` (or your verified domain) |
| `BASE_URL` | where the app runs, e.g. `https://your-app.onrender.com` |
| `COORD_STEVE` / `COORD_HUNG` / `COORD_CHARLES` | each coordinator's email |

The coordinator dropdown and their emails live in `CONFIG.COORDINATORS` — edit names/emails there.

## 3) Run it locally (to test)

```bash
npm install
npm start
```

Open http://localhost:3000. If you haven't set a Resend key yet, the app still runs and
**prints the emails to the console** instead of sending — handy for testing the flow.

---

## Deploy it for free so links work from any phone/computer

Emailed signing links must be reachable from the internet, so the app needs to be hosted.
Good free options:

### Render (simplest)
1. Push this folder to a GitHub repo.
2. On https://render.com → **New → Web Service** → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Under **Environment**, add the variables from the table above (including `BASE_URL` =
   the URL Render gives you, like `https://naqc-po.onrender.com`).
5. Deploy.

> **Important about saved data:** this app stores orders in `data/db.json` on disk.
> Free hosts often have *ephemeral* disks that reset on restart/redeploy, which would lose
> in-progress orders. For real use, either (a) attach a **persistent disk** on your host and
> point the app's `data/` folder at it, or (b) run it on an always-on office machine.
> For low volume and testing, the default file storage is fine.

### Other free hosts
Railway, Fly.io, and Cloudflare all work the same way (Node app, set env vars, `npm start`).
Fly.io and Railway support persistent volumes if you want durable storage.

---

## How the routing works (and how to change it)

The signing order is built in `buildFlow()` in `server.js`:

```
Requestor (signs on the form) → Manager → Coordinator → VP (only if Fixed Asset or total ≥ $1,000)
```

- Change the **$1,000 threshold**: `CONFIG.VP_THRESHOLD`.
- Add/remove a step: edit the `steps` array in `buildFlow()`.
- Each signer gets a unique private link (`/sign/<token>`). A link only works when it's that
  person's turn, and only once.

## Notes / nice-to-haves not included yet

- **File attachments** (quotes, incident photos) aren't uploaded yet — easy to add later.
- Signatures are drawn images stamped onto the PDF. This is fine for internal approvals; if you
  ever need legally-binding signatures with a tamper-proof audit trail, a dedicated e-sign
  service (DocuSign etc.) is the safer route.
- If your office network blocks the app, remember Resend sends over HTTPS so outbound email
  isn't affected by SMTP port blocking.

## Files

- `server.js` — the whole backend: form intake, PDF generation, Resend email, routing.
- `public/index.html` — the purchase-order form + requester signature pad.
- `data/db.json` — stored orders (created automatically).

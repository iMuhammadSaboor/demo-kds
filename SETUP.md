# Connecting Demo KDS to Square — Path A (sandbox)

This walks you through wiring the KDS to Square's **sandbox** (test environment). You'll be able to fire a fake order against Square's API and watch it pop onto the KDS. No real merchant account, no money changes hands, no risk.

Allow about **45 minutes** the first time. Once it works, the same flow runs against a real Square production account with a single env-var swap.

---

## The architecture you're setting up

```
 ┌──────────────────┐
 │  Square sandbox  │         1. You place a test order via the Orders
 │  API             │            API (API Explorer or curl)
 └────────┬─────────┘
          │ 2. Square POSTs a signed webhook event to your public URL
          ▼
 ┌──────────────────┐
 │  Public tunnel   │         3. ngrok (local dev) or your deployed host
 │  https://...     │            forwards the POST to the KDS server
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐
 │  server.mjs      │         4. Server HMAC-verifies the signature,
 │  (this repo)     │            calls Square API to fetch the full order,
 │                  │            writes to data/orders.json, broadcasts
 └────────┬─────────┘            to KDS via Server-Sent Events
          │
          ▼
 ┌──────────────────┐
 │  /kds.html       │         5. Tile appears with a chime
 └──────────────────┘
```

---

## What you need before you start

- [ ] Node 20+ installed
- [ ] This project folder
- [ ] A free **Square developer account** (we create this in step 1)
- [ ] **ngrok** installed (for local dev) — free tier is fine, OR a public host already running

---

## Step 1 · Create a Square developer account

1. Go to https://developer.squareup.com
2. Click **Sign up** (or log in if you have one).
3. Confirm the verification email.
4. In the developer dashboard, click **+ Create application**.
5. Name it **`Demo KDS`** (or whatever you like — this is just your developer record, not a public name). Accept the terms. Click **Save**.

---

## Step 2 · Grab your sandbox credentials

1. Click into your new application.
2. In the left sidebar, find the **Credentials** page.
3. Toggle the top-right switch from **Production** to **Sandbox**. *(Do this every time — easy to forget and accidentally use prod.)*
4. Copy the **Sandbox Access Token** — a long string starting with `EAAA...`.

Keep this tab open; you'll come back for the webhook signature key.

---

## Step 3 · Install ngrok (local dev only)

Square needs a public HTTPS URL to POST webhooks to. Your laptop's `localhost:4000` isn't reachable from the internet. ngrok creates a secure tunnel.

**Install:**

1. Go to https://ngrok.com/download
2. Download and unzip. Move `ngrok.exe` somewhere permanent (e.g. `C:\Users\<you>\ngrok\ngrok.exe`).
3. Create a free ngrok account at https://dashboard.ngrok.com/signup
4. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
5. Run once:
   ```powershell
   ngrok config add-authtoken <paste-your-token-here>
   ```

*Skip this step if you're deploying to a real host (Render, Fly, etc.) — you already have a public URL.*

---

## Step 4 · Create your `.env` and start the KDS server

1. Copy `.env.example` → `.env`:
   ```powershell
   copy .env.example .env
   ```
2. Open `.env` and paste the Sandbox Access Token:
   ```
   SQUARE_TOKEN=EAAAEFxYourLongTokenHere...
   ```
   Leave `SQUARE_SIG_KEY` and `SQUARE_WEBHOOK_URL` blank for now.
3. Start the server:
   ```powershell
   npm start
   ```
   You should see:
   ```
   ╔══════════════════════════════════════════════════════╗
   ║  DEMO KDS — backend                                  ║
   ║  http://localhost:4000                              ║
   ╚══════════════════════════════════════════════════════╝
   ⚠ Square NOT configured (no .env or missing vars).
   ```
   That warning is expected — we've got the token but not the webhook URL yet.

**Leave this terminal running.** Open a second terminal for the next step.

---

## Step 5 · Start ngrok

In the **second** terminal:

```powershell
ngrok http 4000
```

You'll see:

```
Forwarding    https://abcd-1234.ngrok-free.app -> http://localhost:4000
```

**Copy that `https://...ngrok-free.app` URL.** This is your public webhook host.

Test it: open `https://abcd-1234.ngrok-free.app/api/health` in a browser. You should see JSON like `{"ok": true, "square": {...}}`.

---

## Step 6 · Add a webhook subscription in Square

1. Back in the Square developer dashboard → your app → **Webhooks** in the sidebar → **Subscriptions** tab.
2. Confirm you're in **Sandbox** mode.
3. Click **Add subscription**.
4. Fill in:
   - **Name**: `Demo KDS orders`
   - **URL**: `https://abcd-1234.ngrok-free.app/square/webhook`
   - **API Version**: latest
   - **Events**: check `order.created` and `order.updated`
5. Click **Save**.
6. Click into your new subscription, then click **Show** on the **Signature Key** field. **Copy it.**

---

## Step 7 · Finish the `.env` and restart

1. Open `.env` and fill in:
   ```
   SQUARE_TOKEN=EAAAEFxYourLongTokenHere...
   SQUARE_SIG_KEY=<paste-signature-key-from-step-6>
   SQUARE_WEBHOOK_URL=https://abcd-1234.ngrok-free.app/square/webhook
   KDS_ADMIN_PASSWORD=<choose-a-strong-password>
   ```
   **The `SQUARE_WEBHOOK_URL` must match *exactly* what's in the Square dashboard** — the signature verification hashes this URL with the request body, so a single typo breaks auth.

   **`KDS_ADMIN_PASSWORD`** locks `/settings.html` and the destructive `DELETE /api/orders` behind HTTP Basic Auth. Username defaults to `admin`; override with `KDS_ADMIN_USER` if you want. Leave blank to disable auth (only safe on a trusted local network).

2. Restart the server (Ctrl+C, then `npm start`).

3. You should now see:
   ```
   ✓ Square sandbox wired up → https://abcd-1234.ngrok-free.app/square/webhook
   ```

---

## Step 8 · Fire a test order from Square

1. In the Square dev dashboard → your app → **API Explorer** → pick **Orders API** → **CreateOrder**.
2. Confirm the dropdown says **Sandbox**.
3. Paste this minimal request body:
   ```json
   {
     "order": {
       "location_id": "<YOUR_SANDBOX_LOCATION_ID>",
       "line_items": [
         {
           "name": "Flat White",
           "quantity": "1",
           "modifiers": [{ "name": "oat" }]
         },
         {
           "name": "Smashed Avo",
           "quantity": "1"
         }
       ]
     }
   }
   ```
   Find your **Sandbox Location ID** via `GET /v2/locations` in the API Explorer, or in the Seller Dashboard → Locations.
4. Click **Execute**.
5. In your server terminal:
   ```
   [square] event: order.created  (event_id=...)
   [square] ✓ queued SQ-XXXXXX · 2 items · counter
   ```
6. Open `http://localhost:4000/kds.html` — the tile should be there, with the chime.

If you see the order on the KDS, the pipeline works end-to-end.

---

## Troubleshooting

### Server starts but "Square NOT configured"
→ Your `.env` file isn't being loaded. Make sure you run `npm start` (which uses `node --env-file=.env`), not `node server.mjs` directly. Check the file is literally named `.env` (no `.txt` extension — Windows Explorer hides `.txt`).

### Webhook POSTs from Square but KDS doesn't show the order
→ Check the server terminal. Most common causes:
- `✘ signature mismatch — rejecting` — your `SQUARE_WEBHOOK_URL` in `.env` doesn't exactly match what's in the Square dashboard. Copy-paste it *literally*.
- `Square API 401` — your `SQUARE_TOKEN` is wrong or expired. Re-copy from the Credentials page.
- Nothing in terminal — Square isn't reaching your tunnel. Check ngrok is still running and the URL hasn't changed.

### ngrok URL changed after I restarted it
→ Free tier gives a new random URL each restart unless you claim a static domain (still free — https://dashboard.ngrok.com/domains). With a static domain the URL persists across restarts.

### I want to test WITHOUT setting up Square yet
→ Use the included test-order firer:
```powershell
npm run fire-test
```
This POSTs a fake-but-valid Square-shaped event to your local server. The server accepts it (signature check is relaxed when `SQUARE_*` env vars are blank) and the KDS pops the tile.

### Verify the server is healthy
```powershell
npm run health
```
Returns JSON showing whether Square is configured, how many orders are queued, and how many KDS tabs are connected.

---

## Going from sandbox → production

When you're ready to flip to a real merchant:

1. **Flip `SQUARE_ENV=production`** in your env. The server will point to `connect.squareup.com` instead of `connect.squareupsandbox.com`.
2. **OAuth flow** — for a multi-tenant product you don't use a personal access token; you build an OAuth page where the merchant authorizes your app. Square's OAuth docs: https://developer.squareup.com/docs/oauth-api/overview. For a single-merchant install, a Personal Access Token is fine.
3. **Host on a real server** — Render/Fly/Railway free tiers all work. Pin a domain.
4. **Re-register the webhook** at your production domain via the production-mode dashboard.
5. **Submit for Square's app review** — before your app can talk to real merchants other than your own, Square does a ~1-week review of your privacy policy and legitimacy. Not hard, just a wait.

Until then, sandbox Path A is exactly what you need to prove the thing works.

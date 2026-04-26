# Demo KDS

[![CI](https://github.com/iMuhammadSaboor/demo-kds/actions/workflows/ci.yml/badge.svg)](https://github.com/iMuhammadSaboor/demo-kds/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-blue)](#)
[![Deps](https://img.shields.io/badge/runtime%20deps-zero-brightgreen)](#)

A portfolio Kitchen Display System prototype — tablet-optimised live order display for a busy cafe, wired to Square's real order webhooks.

Zero runtime dependencies beyond Node.js 20+. One static server, one webhook server, vanilla HTML/CSS/JS on the client. No framework, no build step.

Built by **Muhammad Saboor** as a portfolio demo — final-year Data Science student at VU Footscray, graduating October 2026.

---

## What's in this folder

```
demo-kds/
├── package.json              # ES module, a handful of npm scripts
├── server.mjs                # webhook handler + HMAC verify + SSE broadcast (port 4000)
├── serve.mjs                 # zero-dep static server (fallback, no webhook)
├── client-api.js             # dual-mode wrapper (server SSE OR localStorage)
├── styles.css                # shared design system (Space Grotesk + Inter)
├── menu.json                 # 5 categories, ~30 items, prep times + stations
│
├── index.html                # landing / pitch page
├── kds.html                  # THE KDS — tablet-optimised order display
├── counter.html              # counter-side order entry terminal
├── history.html              # bumped orders + prep-time analytics
├── settings.html             # prep-time targets, station routing, toggles
│
├── scripts/
│   ├── fire-test-order.mjs       # post a synthetic order to the local API
│   └── seed-square-catalog.mjs   # bulk-upload menu to Square sandbox
│
├── data/orders.json          # persisted order log (gitignored)
├── screenshots/              # captures of every page
├── SETUP.md                  # Square sandbox setup + webhook registration
├── STATUS.md                 # what works vs what's next
└── README.md                 # (this file)
```

## Run it

```bash
node --env-file=.env server.mjs
# open http://localhost:4000
```

Node 20+ required (uses ESM, built-in `fetch`, and `--env-file`). The runtime is zero-dep — `npm install` only fetches the dev test runner.

Copy `.env.example` → `.env` and fill in the Square sandbox values before starting. See [SETUP.md](./SETUP.md) for the full wiring.

## Tests

```bash
npm install        # one-time, fetches vitest
npm test           # 21 tests · ~700ms
```

The test suite covers two layers:

- **Unit tests** (`tests/hmac.test.mjs`) — 9 tests on the Square HMAC-SHA256 webhook signature verifier (`lib/hmac.mjs`). Covers valid signatures, body tampering, URL tampering, missing headers, wrong keys.
- **Integration tests** (`tests/api.test.mjs`) — 12 tests against a real `server.mjs` instance booted on a temp port + temp data dir. Covers the counter→KDS REST flow, bump/recall, the admin auth gate on `DELETE /api/orders` and `/settings.html`, and the Square webhook signature gate (good sig accepted, bad sig rejected, missing sig rejected).

CI runs the full suite on every push against Node 20 and 22 (see `.github/workflows/ci.yml`).

## Routes

| URL                          | Page                                        |
|------------------------------|---------------------------------------------|
| `/`                          | Landing + pitch                             |
| `/kds.html`                  | Kitchen Display — open fullscreen on tablet |
| `/kds.html?seed=1`           | Same, auto-seeded with demo orders          |
| `/counter.html`              | Counter terminal — build tickets, send to KDS |
| `/history.html`              | Analytics: KPIs, charts, bumped log         |
| `/history.html?seed=1`       | Same, auto-seeded with 24h of demo data     |
| `/settings.html`             | Prep-time targets, station routing, toggles |
| `/menu.json`                 | Raw menu data                               |
| `/api/health`                | JSON health check — Square wiring status    |
| `/api/events`                | Server-Sent Events stream for live updates  |
| `/square/webhook`            | Square order webhook receiver (HMAC verified) |

## Live demo flow (try this in 30 seconds)

1. Start the server: `node --env-file=.env server.mjs`
2. Open `/counter.html` in one browser tab
3. Open `/kds.html` in another tab
4. On the counter: tap **Flat White** → pick **oat**, **extra shot** → **Add to ticket**
5. Tap **Smashed Avo** → **Send to Kitchen**
6. KDS tab: the order pops in with a chime, with a fresh (green) timer

Then fire a real Square sandbox order against the Square Orders API — it hits the webhook, the server HMAC-verifies it, persists the ticket, and broadcasts to the KDS via SSE. Same tile UI, different source.

## Architecture

```
Square sandbox                    Demo KDS server              Browsers (KDS / Counter / History)
─────────────────                 ─────────────────             ──────────────────────────────────
POST /v2/orders   ─────────►  /square/webhook  ─────────►  SSE stream: /api/events
                              (HMAC-SHA256 verify)           → render tile live
                              persist data/orders.json
                              broadcast via SSE
```

- **Zero deps.** Webhook signature verified with Node's built-in `crypto.createHmac`. No `express`, no `ws`, no Square SDK.
- **HMAC-SHA256 verification** per Square's spec — hashes the full request URL + raw body against the subscription's signature key; rejects on mismatch.
- **Atomic JSON writes** for the order log so a crash mid-write doesn't corrupt the file.
- **SSE with 20s keep-alive** so proxies don't drop the long-lived connection.
- **Dual-mode client.** `client-api.js` auto-detects: if the server is reachable, use SSE; otherwise fall back to `localStorage` + cross-tab storage events (so the demo works even with `serve.mjs` alone).

## What's real vs what's mock

**Real (works right now):**

- **Counter → KDS** flow is a working state machine. Tickets you build on the counter render on the KDS with live timers, bump animations, and sound alerts.
- **Square sandbox orders** flow end-to-end: `POST /v2/orders` on sandbox → webhook → HMAC verify → tile appears on `/kds.html` within ~1 second.
- **Per-ticket prep targets** drive the green → amber → red colour coding. A 12-min brekkie tile doesn't go red at 4 min; a 3-min flat white does.
- **Keyboard shortcuts**: `1`–`9` bump, `R` recall last, `F` fullscreen, `S` seed demo.
- **History analytics** (KPIs, hourly chart, channel donut, prep-time buckets, top items, bumped log) computed live from the persisted order log.
- **Settings persist** per browser via `localStorage`.
- **Sound alert** software-generated via Web Audio API — no mp3, no CORS.

**Mock (needs wiring for production):**

- **Uber Eats / DoorDash** feeds — same webhook pattern as Square, each needs a merchant-partner application (1–3 weeks per platform).
- **Online ordering** — if a cafe ships one, it POSTs into this queue the same way the counter does.
- **Persistence** — currently file-based `data/orders.json`. Swap for Postgres or SQLite for multi-node deploys.

## Design

- **Display font:** Space Grotesk — geometric, technical, reads well on a kitchen tablet from 1.5m away.
- **Body font:** Inter — default for modern UIs.
- **Mono:** JetBrains Mono — for timers, order numbers, prices.
- **Palette:**
  - `--ink`   `#0f0b08` — near-black espresso (KDS background)
  - `--bean`  `#221713` — roasted bean (tile background)
  - `--cream` `#f5efe4` — paper (marketing pages)
  - `--crema` `#c89560` — coffee-crema orange (primary accent)
  - `--fresh` `#5eb862` · `--soon` `#f5c542` · `--late` `#e8472c` (KDS signal colours)

Everything uses CSS custom properties in `styles.css`. Change one token, everything updates.

## Production path

1. **Deploy.** Any Node 20+ host. Render.com, Fly.io, Railway, or a $5 VPS.
2. **Point Square webhook** at `https://<your-host>/square/webhook` in the Square developer dashboard. Signature key per subscription.
3. **Env vars**: `SQUARE_ENV` (sandbox/production), `SQUARE_TOKEN`, `SQUARE_SIG_KEY`, `SQUARE_WEBHOOK_URL`, `PORT`, `KDS_ADMIN_PASSWORD` (locks `/settings.html` + queue clear).
4. **Persist orders** — swap `data/orders.json` for a DB if you need multi-node or survive-redeploy. Upstash Redis free tier is plenty for one cafe.
5. **Hardware** — one Android tablet + wall mount + silicone case.
6. **Delivery platforms** — register merchant integrations one at a time.

See [SETUP.md](./SETUP.md) for the full Square sandbox setup.

## Contact

**Muhammad Saboor** · [bmuhammadsaboor@gmail.com](mailto:bmuhammadsaboor@gmail.com)

## License

Private. Portfolio piece. Do not redistribute.

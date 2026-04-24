# STATUS — Demo KDS

Last updated: 2026-04-24 · Path A (Square sandbox webhooks) proven end-to-end.

## Deliverables

| # | File | Status | Notes |
|---|---|---|---|
| 1 | `package.json` | ✅ | ES module, npm scripts for `start`, `serve`, `fire-test`, `health`, `seed-square-catalog` |
| 2 | `server.mjs` | ✅ | Webhook handler + HMAC-SHA256 verify + SSE broadcast + atomic JSON persistence |
| 3 | `serve.mjs` | ✅ | Zero-dep Node static server, port 4000, ~70 lines (fallback mode) |
| 4 | `client-api.js` | ✅ | Dual-mode wrapper: SSE if server reachable, otherwise localStorage + storage events |
| 5 | `styles.css` | ✅ | Shared design tokens, Space Grotesk + Inter + JetBrains Mono |
| 6 | `menu.json` | ✅ | 5 categories, 30 items, prep times + station routing |
| 7 | `index.html` | ✅ | Hero + mini-KDS preview + pain/fix + how-it-works + story + tech spec + CTA |
| 8 | `kds.html` | ✅ | Tile grid, per-ticket timers, age-based colour, bump + recall, sound, keyboard hotkeys, `?seed=1` |
| 9 | `counter.html` | ✅ | Menu-grid order builder, mod sheet, live ticket, fires into KDS via SSE |
| 10 | `history.html` | ✅ | 4 KPIs, 4 Chart.js charts, top-items bar, bumped log, 24h demo seed |
| 11 | `settings.html` | ✅ | Display toggles, per-category prep-time targets, station routing |
| 12 | `scripts/fire-test-order.mjs` | ✅ | Post synthetic order via local API (no Square needed) |
| 13 | `scripts/seed-square-catalog.mjs` | ✅ | Bulk-upload menu.json into Square sandbox catalog |
| 14 | `screenshots/` | ✅ | Captures of every page |
| 15 | `README.md` | ✅ | Run instructions, routes, real-vs-mock audit, production path |
| 16 | `SETUP.md` | ✅ | Square sandbox wiring guide (rewrite of the original SQUARE_SETUP.md) |
| 17 | `STATUS.md` | ✅ | (this file) |

## What works end-to-end right now

- **Square sandbox → KDS live:** `POST /v2/orders` against `connect.squareupsandbox.com` → Square fires signed webhook → server HMAC-verifies → fetches full order → persists → broadcasts via SSE → tile appears on `/kds.html` in ~1 second. Proven with multiple real sandbox orders.
- **Counter → KDS:** Open `/counter.html` in one tab, `/kds.html` in another — tap items, send ticket, hear the chime, watch the tile pop in.
- **Cross-device sync:** With `server.mjs` running, multiple browsers on different devices see the same queue via SSE. `serve.mjs` fallback uses localStorage + storage events (same-browser only).
- **Age-based colour coding** honours per-ticket targets. A 12-min brekkie is "soon" at 6 min, "late" at 12. A 3-min flat white is "soon" at 1.5, "late" at 3. Red tiles pulse.
- **Keyboard hotkeys:** `1`–`9` bump by position, `R` recall last bump, `F` fullscreen, `S` seed demo.
- **`kds.html?seed=1`** auto-seeds 5 demo orders with mixed channels.
- **`history.html?seed=1`** auto-seeds 24 hours of realistic history (~70 bumped orders).
- **Settings persist** across reloads via `localStorage`.
- **Sound alert** generated live via Web Audio API (no mp3 dependency).

## Known rough edges (deliberately not fixed in this pass)

- **File-based persistence.** `data/orders.json` is fine for one node. Multi-node deploys need Postgres/SQLite/Redis.
- **No auth.** Anyone who hits `http://host:4000/settings.html` can change prep targets. Add basic auth before exposing externally.
- **No test suite.** Working prototype, not production code.
- **Sound may be blocked** on first load until the user clicks the sound chip once (browser autoplay policy). Toast tells them what to do.
- **Chart.js via CDN** — pin to a local copy for venues with flaky wifi.
- **Demo seed data** uses placeholder customer names.

## Next TODO

1. **Deploy** to Render/Fly/Railway free tier for a public URL.
2. **UptimeRobot ping** every 5 min on `/api/health` to keep free-tier from sleeping.
3. **Square production creds** — OAuth flow (multi-tenant) or PAT (single-tenant).
4. **Uber Eats Partner API** — webhook for delivery orders. 1–3 weeks to be approved.
5. **DoorDash Drive API** — same pattern.
6. **Online order page** — if you ship one, POST into the KDS queue the same way the counter does.
7. **Basic auth / IP allowlist** on `/settings.html`.
8. **Tablet hardware** — Samsung Galaxy Tab A9+ 11" + silicone case + VESA wall mount. ~A$460 all in.

## Tech debt to acknowledge

- All pages inline their own page-specific `<style>` block. Fine at this size; extract to CSS modules if it grows.
- Data model mixes `station` onto both items and categories. Settings page can override the category default — items don't respect the override yet; they store their own station at order-create time.
- `history.html` pulls from full persisted log each render — fine at ~100 orders, wants virtualisation at 10k.
- No i18n yet.

## One-line ship summary

Six HTML pages, one zero-dep Node webhook server, one JSON menu — counter fires tickets, KDS renders them with live timers and sound alerts, Square sandbox webhooks land on the same queue, history logs every bump with prep-time analytics.

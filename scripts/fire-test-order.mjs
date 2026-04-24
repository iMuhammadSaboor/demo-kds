#!/usr/bin/env node
// ===========================================================
// scripts/fire-test-order.mjs
//
// Fire a fake Square-shaped webhook POST at your local server.
// Lets you verify the whole pipeline works BEFORE you wire
// real Square / ngrok / webhook subscriptions.
//
// Usage:
//   node scripts/fire-test-order.mjs
//   node scripts/fire-test-order.mjs --customer "Emma" --source "Uber Eats"
//   node scripts/fire-test-order.mjs --host http://localhost:4000
//
// You don't need SQUARE_* env vars set for this to work — the
// server recognises missing creds and accepts the payload in
// dev-mode, reading the full order inline from the event.
// ===========================================================

import crypto from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const HOST     = args.host || "http://localhost:4000";
const CUSTOMER = args.customer || pick(["Emma", "Luca", "Priya", "Jake", "Maya", "Ben", "Ari", "Sofia"]);
const SOURCE   = args.source || "Square Point of Sale";

// Mix of realistic cafe menu items
const DECK = [
  { name: "Flat White",     quantity: "1", modifiers: [{ name: "oat" }] },
  { name: "Latte",          quantity: "1", modifiers: [{ name: "extra shot" }] },
  { name: "Cappuccino",     quantity: "2", modifiers: [] },
  { name: "Long Black",     quantity: "1", modifiers: [{ name: "large" }] },
  { name: "Chai Latte",     quantity: "1", modifiers: [{ name: "oat" }] },
  { name: "Smashed Avo",    quantity: "1", modifiers: [{ name: "+ poached egg" }] },
  { name: "Eggs Benedict",  quantity: "1", modifiers: [{ name: "smoked salmon" }] },
  { name: "Bacon & Egg Roll", quantity: "1", modifiers: [{ name: "bbq" }] },
  { name: "Chicken Burger", quantity: "1", modifiers: [{ name: "no onion" }] },
  { name: "Banana Bread",   quantity: "1", modifiers: [] },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const lineItems = [];
lineItems.push(pick(DECK));
if (Math.random() < 0.6) lineItems.push(pick(DECK));
if (Math.random() < 0.3) lineItems.push(pick(DECK));

const orderId = "TEST_" + crypto.randomBytes(8).toString("hex").toUpperCase();
const now = new Date().toISOString();

// Shape matches Square's real webhook payload as closely as possible.
const event = {
  merchant_id: "TEST_MERCHANT",
  type: "order.created",
  event_id: crypto.randomUUID(),
  created_at: now,
  data: {
    type: "order",
    id: orderId,
    // The server will pull from here in dev-mode (no token set).
    // In production, the server fetches from Square's API instead.
    object: {
      order_created: {
        order_id: orderId,
        order: {
          id: orderId,
          created_at: now,
          source: { name: SOURCE },
          line_items: lineItems,
          fulfillments: [{
            pickup_details: {
              recipient: { display_name: CUSTOMER },
              note: args.note || "",
            },
          }],
        },
      },
    },
  },
};

const body = JSON.stringify(event);

console.log("─────────────────────────────────────────");
console.log(`Firing fake Square webhook → ${HOST}/square/webhook`);
console.log(`  customer:   ${CUSTOMER}`);
console.log(`  source:     ${SOURCE}`);
console.log(`  line items: ${lineItems.map(l => `${l.quantity}× ${l.name}`).join(", ")}`);
console.log("─────────────────────────────────────────");

try {
  const r = await fetch(`${HOST}/square/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const text = await r.text();
  console.log(`  ← ${r.status} ${r.statusText}   ${text}`);
  if (r.ok) {
    console.log("  ✓ Check the KDS tab — the order should have popped.");
  }
} catch (e) {
  console.error(`  ✘ Could not reach ${HOST}. Is the server running?`);
  console.error(`    Start it with:  node --env-file=.env server.mjs`);
  console.error(`    Error: ${e.message}`);
  process.exit(1);
}

/* =========================================================
   seed-square-catalog.mjs

   Reads menu.json and uploads every category + item + variation
   to the Square catalog (sandbox or production, whichever SQUARE_ENV
   is set to in .env). Idempotent: safe to re-run — Square's batch
   upsert will update existing objects keyed by the client-supplied ID.

   Usage:
     npm run seed-square-catalog
       (or)
     node --env-file=.env scripts/seed-square-catalog.mjs
   ========================================================= */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.SQUARE_TOKEN;
const ENV   = process.env.SQUARE_ENV || "sandbox";
const BASE  = ENV === "production"
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";

if (!TOKEN) {
  console.error("✘ SQUARE_TOKEN not set. Did you start with `node --env-file=.env ...`?");
  process.exit(1);
}

const menuPath = resolve(__dirname, "..", "menu.json");
const menu = JSON.parse(await readFile(menuPath, "utf8"));

/* Build Square catalog objects from menu.json ---------------------- */

const objects = [];

for (const cat of menu.categories) {
  for (const item of cat.items) {
    const itemId = `#item_${cat.id}_${item.id}`;
    const varId  = `#var_${cat.id}_${item.id}`;
    objects.push({
      type: "ITEM",
      id: itemId,
      item_data: {
        name: item.name,
        description: `Category: ${cat.name}`,
        variations: [{
          type: "ITEM_VARIATION",
          id: varId,
          item_variation_data: {
            item_id: itemId,
            name: "Regular",
            pricing_type: "FIXED_PRICING",
            price_money: {
              amount: Math.round(item.price * 100),
              currency: "AUD",
            },
          },
        }],
      },
    });
  }
}

console.log(`Uploading ${objects.length} items to Square → ${BASE} (env: ${ENV})`);
console.log();

/* Fire one object at a time via /v2/catalog/object ---------------- */

let ok = 0;
let fail = 0;

for (const object of objects) {
  const body = {
    idempotency_key: randomUUID(),
    object,
  };

  const res = await fetch(`${BASE}/v2/catalog/object`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Square-Version": "2024-10-17",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  const name = object.item_data.name;

  if (!res.ok || json.errors) {
    fail++;
    console.log(`  ✘ ${name.padEnd(24)} — ${json.errors?.[0]?.detail || res.status}`);
  } else {
    ok++;
    console.log(`  ✓ ${name.padEnd(24)} → ${json.catalog_object.id}`);
  }
}

console.log();
console.log(`Done. ${ok} uploaded, ${fail} failed.`);
console.log(`Refresh app.squareupsandbox.com → Items & orders → Items to see them.`);

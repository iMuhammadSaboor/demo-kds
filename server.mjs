// ===========================================================
// server.mjs — Demo KDS backend
//   • Static file server for the HTML pages
//   • REST API backing the KDS queue  (/api/*)
//   • Server-Sent Events stream       (/api/stream)
//   • Square webhook receiver         (/square/webhook)
//
// Zero npm deps. Requires Node 20+ (uses built-in fetch and
// --env-file flag for loading .env).
//
// Start:
//   node --env-file=.env server.mjs
// Or without .env (webhook disabled, local mode still works):
//   node server.mjs
// ===========================================================

import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 4000;
const DATA_DIR = join(ROOT, "data");
const DATA_FILE = join(DATA_DIR, "orders.json");

const SQ_ENV    = process.env.SQUARE_ENV || "sandbox";
const SQ_BASE   = SQ_ENV === "production"
  ? "https://connect.squareup.com/v2"
  : "https://connect.squareupsandbox.com/v2";
const SQ_TOKEN  = process.env.SQUARE_TOKEN || "";
const SQ_SIG    = process.env.SQUARE_SIG_KEY || "";
const SQ_HOOK   = process.env.SQUARE_WEBHOOK_URL || "";

const SQ_READY  = !!(SQ_TOKEN && SQ_SIG && SQ_HOOK);

// -----------------------------------------------------------
// Data persistence — one JSON file, atomic writes via rename.
// One cafe, a few hundred orders/day, easily fine. Upgrade to
// SQLite (node:sqlite in Node 22+) if this ever feels slow.
// -----------------------------------------------------------

async function loadOrders() {
  try { return JSON.parse(await readFile(DATA_FILE, "utf8")); }
  catch { return []; }
}
async function saveOrders(list) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(list, null, 2));
  await rename(tmp, DATA_FILE);
}
async function nextOrderNum() {
  const list = await loadOrders();
  const maxNum = list.reduce((m, o) => Math.max(m, o.num || 0), 41);
  return maxNum + 1;
}

// -----------------------------------------------------------
// Menu lookup — used to infer station + prep-time when an
// order arrives from Square with only line-item names.
// -----------------------------------------------------------
let _menuCache = null;
async function loadMenu() {
  if (_menuCache) return _menuCache;
  _menuCache = JSON.parse(await readFile(join(ROOT, "menu.json"), "utf8"));
  return _menuCache;
}
async function inferItemMeta(name) {
  const menu = await loadMenu();
  const n = (name || "").toLowerCase().trim();
  for (const cat of menu.categories) {
    for (const it of cat.items) {
      const itn = it.name.toLowerCase();
      if (itn === n || n.includes(itn) || itn.includes(n)) {
        return { station: cat.station, prepMin: it.prepMin || 3 };
      }
    }
  }
  return { station: "bar", prepMin: 3 };
}

function mapChannel(sourceName) {
  const s = (sourceName || "").toLowerCase();
  if (s.includes("uber")) return "uber";
  if (s.includes("doordash") || s.includes("door dash")) return "doordash";
  if (s.includes("menulog")) return "doordash";
  if (s.includes("online") || s.includes("web")) return "online";
  if (s.includes("phone")) return "phone";
  return "counter"; // Square POS default
}

// -----------------------------------------------------------
// Square schema → KDS schema
// -----------------------------------------------------------
async function squareOrderToKds(sqOrder, assignedNum) {
  const items = [];
  for (const li of (sqOrder.line_items || [])) {
    const meta = await inferItemMeta(li.name);
    items.push({
      qty: parseInt(li.quantity || "1", 10),
      name: li.name || "Unknown item",
      station: meta.station,
      prepMin: meta.prepMin,
      mods: (li.modifiers || []).map(m => m.name).filter(Boolean),
      priceEach: li.base_price_money
        ? Number(li.base_price_money.amount) / 100
        : undefined,
    });
  }
  const f = (sqOrder.fulfillments || [])[0] || {};
  const customer =
    f.pickup_details?.recipient?.display_name ||
    f.delivery_details?.recipient?.display_name ||
    f.shipment_details?.recipient?.display_name ||
    "Walk-in";
  const note =
    f.pickup_details?.note ||
    f.delivery_details?.note ||
    sqOrder.ticket_name ||
    "";

  return {
    id: "SQ-" + (sqOrder.id || "").slice(-8).toUpperCase(),
    num: assignedNum,
    createdAt: sqOrder.created_at ? new Date(sqOrder.created_at).getTime() : Date.now(),
    channel: mapChannel(sqOrder.source?.name),
    customer,
    note,
    items,
    status: "queued",
    bumpedAt: 0,
    _source: "square",
    _squareId: sqOrder.id,
    _squareEnv: SQ_ENV,
  };
}

async function fetchSquareOrder(orderId) {
  if (!SQ_TOKEN) throw new Error("SQUARE_TOKEN not set");
  const r = await fetch(`${SQ_BASE}/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${SQ_TOKEN}`,
      "Square-Version": "2024-09-19",
      "Accept": "application/json",
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Square API ${r.status}: ${text.slice(0, 300)}`);
  }
  const body = await r.json();
  return body.order;
}

function verifySquareSig(rawBody, sigHeader) {
  if (!SQ_SIG || !SQ_HOOK) return false;
  if (!sigHeader) return false;
  const expected = crypto
    .createHmac("sha256", SQ_SIG)
    .update(SQ_HOOK + rawBody)
    .digest("base64");
  // Timing-safe compare
  const a = Buffer.from(sigHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// -----------------------------------------------------------
// Server-Sent Events — the KDS listens on /api/stream.
// -----------------------------------------------------------
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}
// Keep-alive every 20s so intermediaries don't idle-kill the stream
setInterval(() => broadcast("ping", { at: Date.now() }), 20000);

// -----------------------------------------------------------
// HTTP server
// -----------------------------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/plain; charset=utf-8",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(obj));
}

async function handleApi(req, res, url) {
  // CORS preflight — handy when you open counter.html on a phone
  // and the KDS on a tablet behind the same router.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  try {
    // GET /api/health
    if (url.pathname === "/api/health" && req.method === "GET") {
      const list = await loadOrders();
      return json(res, 200, {
        ok: true,
        square: {
          ready: SQ_READY,
          env: SQ_ENV,
          hasToken: !!SQ_TOKEN,
          hasSigKey: !!SQ_SIG,
          hasHookUrl: !!SQ_HOOK,
          hookUrl: SQ_HOOK || null,
        },
        orders: {
          total: list.length,
          queued: list.filter(o => o.status === "queued").length,
          bumped: list.filter(o => o.status === "bumped").length,
        },
        sseClients: sseClients.size,
      });
    }

    // GET /api/orders
    if (url.pathname === "/api/orders" && req.method === "GET") {
      const status = url.searchParams.get("status");
      let list = await loadOrders();
      if (status) list = list.filter(o => o.status === status);
      return json(res, 200, list);
    }

    // POST /api/orders — counter fires a new order
    if (url.pathname === "/api/orders" && req.method === "POST") {
      const body = await readBody(req);
      const order = JSON.parse(body);
      order.id = order.id || ("LOC-" + Date.now().toString(36).toUpperCase());
      order.num = order.num || await nextOrderNum();
      order.createdAt = order.createdAt || Date.now();
      order.status = "queued";
      order.bumpedAt = 0;
      const list = await loadOrders();
      list.push(order);
      await saveOrders(list);
      broadcast("order.created", order);
      console.log(`[counter] → ${order.id} · ${order.items.length} line${order.items.length === 1 ? "" : "s"}`);
      return json(res, 201, order);
    }

    // DELETE /api/orders — wipe (useful during dev)
    if (url.pathname === "/api/orders" && req.method === "DELETE") {
      await saveOrders([]);
      broadcast("orders.cleared", {});
      console.log("[admin] queue cleared");
      return json(res, 200, { cleared: true });
    }

    // POST /api/orders/:id/bump
    const bumpM = url.pathname.match(/^\/api\/orders\/([^/]+)\/bump$/);
    if (bumpM && req.method === "POST") {
      const list = await loadOrders();
      const i = list.findIndex(o => o.id === bumpM[1]);
      if (i === -1) return json(res, 404, { error: "order not found" });
      list[i].status = "bumped";
      list[i].bumpedAt = Date.now();
      await saveOrders(list);
      broadcast("order.bumped", list[i]);
      return json(res, 200, list[i]);
    }

    // POST /api/orders/:id/recall
    const recallM = url.pathname.match(/^\/api\/orders\/([^/]+)\/recall$/);
    if (recallM && req.method === "POST") {
      const list = await loadOrders();
      const i = list.findIndex(o => o.id === recallM[1]);
      if (i === -1) return json(res, 404, { error: "order not found" });
      list[i].status = "queued";
      list[i].createdAt = Date.now() - 1000;
      list[i].bumpedAt = 0;
      await saveOrders(list);
      broadcast("order.recalled", list[i]);
      return json(res, 200, list[i]);
    }

    // GET /api/stream — Server-Sent Events
    if (url.pathname === "/api/stream" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
        "x-accel-buffering": "no",
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ at: Date.now(), square: SQ_READY })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // POST /api/square/test — fires a fake Square order straight
    // into the queue. Great for demos BEFORE you connect to real Square.
    if (url.pathname === "/api/square/test" && req.method === "POST") {
      const body = await readBody(req);
      const maybe = body.trim() ? JSON.parse(body) : {};
      const sqLike = maybe.order || buildSampleSquareOrder(maybe);
      const num = await nextOrderNum();
      const kds = await squareOrderToKds(sqLike, num);
      const list = await loadOrders();
      list.push(kds);
      await saveOrders(list);
      broadcast("order.created", kds);
      console.log(`[test] → fake Square order ${kds.id}`);
      return json(res, 201, kds);
    }

    return json(res, 404, { error: "no such api route", path: url.pathname });

  } catch (e) {
    console.error("[api] error:", e);
    return json(res, 500, { error: e.message });
  }
}

// A minimal-but-valid Square order object for the /api/square/test path
function buildSampleSquareOrder({ items, customer, source } = {}) {
  const picks = items || [
    { name: "Flat White", quantity: "1", modifiers: [{ name: "oat" }] },
    { name: "Smashed Avo", quantity: "1", modifiers: [] },
  ];
  return {
    id: "TEST_" + crypto.randomBytes(8).toString("hex").toUpperCase(),
    created_at: new Date().toISOString(),
    source: { name: source || "Square Point of Sale" },
    line_items: picks,
    fulfillments: [{
      pickup_details: {
        recipient: { display_name: customer || "Test Customer" },
        note: "",
      },
    }],
  };
}

async function handleWebhook(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405); return res.end("method not allowed");
  }
  const rawBody = await readBody(req);
  const sigHeader = req.headers["x-square-hmacsha256-signature"];

  // Only enforce signature when Square is configured. That way you
  // can test the pipeline with scripts/fire-test-order.mjs without
  // needing valid signatures.
  if (SQ_READY) {
    if (!verifySquareSig(rawBody, sigHeader)) {
      console.warn("[square] ✘ signature mismatch — rejecting");
      res.writeHead(401); return res.end("bad signature");
    }
  } else {
    console.log("[square] ⚠ SQUARE_* env vars not set — accepting webhook without signature check (dev mode)");
  }

  let evt;
  try { evt = JSON.parse(rawBody); }
  catch { res.writeHead(400); return res.end("bad json"); }

  console.log(`[square] event: ${evt.type}  (event_id=${evt.event_id || "?"})`);

  if (evt.type === "order.created" || evt.type === "order.updated") {
    const orderId = evt.data?.id || evt.data?.object?.order_created?.order_id;
    if (!orderId) {
      console.warn("[square] no order id in event payload");
      res.writeHead(200); return res.end("no order id");
    }
    try {
      let sqOrder;
      if (SQ_READY) {
        sqOrder = await fetchSquareOrder(orderId);
      } else if (evt.data?.object?.order_created) {
        // When dev-firing with fire-test-order.mjs we include the
        // full order body inline so we don't have to call the API.
        sqOrder = evt.data.object.order_created.order;
      } else {
        throw new Error("SQ not configured + no inline order in event");
      }

      const list = await loadOrders();
      if (list.find(o => o._squareId === sqOrder.id && o.status === "queued")) {
        console.log(`[square] duplicate ${sqOrder.id}, ignoring`);
        res.writeHead(200); return res.end("duplicate");
      }

      const num = await nextOrderNum();
      const kds = await squareOrderToKds(sqOrder, num);
      list.push(kds);
      await saveOrders(list);
      broadcast("order.created", kds);
      console.log(`[square] ✓ queued ${kds.id}  · ${kds.items.length} items · ${kds.channel}`);

    } catch (e) {
      console.error(`[square] fetch/map error: ${e.message}`);
      // Return 200 anyway — Square retries aggressively and we don't
      // want infinite retries on a malformed payload. Error is logged.
    }
  }

  res.writeHead(200); res.end("ok");
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const abs = normalize(join(ROOT, rel));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(400); return res.end("bad path");
  }
  try {
    const info = await stat(abs);
    let target = abs;
    if (info.isDirectory()) {
      target = join(abs, "index.html");
      await stat(target);
    }
    const data = await readFile(target);
    const ct = TYPES[extname(target).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "content-type": ct, "cache-control": "no-store" });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500);
    res.end(e.code === "ENOENT" ? "404 not found" : "500 " + e.message);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  if (url.pathname === "/square/webhook") return handleWebhook(req, res);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║  DEMO KDS — backend                                  ║");
  console.log("  ║  http://localhost:" + PORT + "                                  ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log("  ║  /              landing / project readme             ║");
  console.log("  ║  /kds.html      kitchen display (tablet)             ║");
  console.log("  ║  /counter.html  counter entry (POS laptop)           ║");
  console.log("  ║  /history.html  bumped orders + analytics            ║");
  console.log("  ║  /settings.html config                               ║");
  console.log("  ║                                                      ║");
  console.log("  ║  /api/health    backend status + Square config       ║");
  console.log("  ║  /api/orders    GET queue / POST new / DELETE clear  ║");
  console.log("  ║  /api/stream    Server-Sent Events stream            ║");
  console.log("  ║  /square/webhook   Square webhook receiver           ║");
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log("");
  if (SQ_READY) {
    console.log(`  ✓ Square ${SQ_ENV} wired up → ${SQ_HOOK}`);
  } else {
    console.log("  ⚠ Square NOT configured (no .env or missing vars).");
    console.log("    The queue still works — use /counter.html, or fire a");
    console.log("    fake Square order with:  node scripts/fire-test-order.mjs");
  }
  console.log("");
});

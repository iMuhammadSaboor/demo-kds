// ===========================================================
// tests/api.test.mjs
//   Integration tests against a real, locally-spawned instance
//   of server.mjs. We boot the server on a random port pointing
//   at a temp DATA_DIR so we don't pollute the real orders.json,
//   then hit the HTTP API the same way a browser would.
// ===========================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSquareSig } from "../lib/hmac.mjs";

const PORT = 4321;                        // unlikely to clash with the dev server (4000)
const BASE = `http://localhost:${PORT}`;
const SQ_SIG_KEY  = "integration-test-key-xyz";
const SQ_HOOK_URL = `${BASE}/square/webhook`;

let server;
let dataDir;

/** Wait until /api/health responds 200 (or fail after timeoutMs) */
async function waitForServer(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("server did not start within " + timeoutMs + "ms");
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "demo-kds-test-"));
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));

  server = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      SQUARE_ENV: "sandbox",
      SQUARE_TOKEN: "fake-token-for-integration-tests",
      SQUARE_SIG_KEY: SQ_SIG_KEY,
      SQUARE_WEBHOOK_URL: SQ_HOOK_URL,
      KDS_ADMIN_USER: "admin",
      KDS_ADMIN_PASSWORD: "test-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Surface server output if the test fails so we can diagnose
  server.stdout.on("data", () => { /* silence in normal runs */ });
  server.stderr.on("data", chunk => process.stderr.write(`[server] ${chunk}`));

  await waitForServer();
}, 10000);

afterAll(async () => {
  if (server && !server.killed) server.kill();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("returns ok=true with full Square + admin status", async () => {
    const r = await fetch(`${BASE}/api/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.square.ready).toBe(true);
    expect(body.square.env).toBe("sandbox");
    expect(body.square.hookUrl).toBe(SQ_HOOK_URL);
    expect(body.orders).toEqual({ total: 0, queued: 0, bumped: 0 });
    expect(typeof body.sseClients).toBe("number");
  });
});

describe("POST + GET /api/orders (counter flow)", () => {
  it("creates a counter order and increments the queue", async () => {
    const r = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ qty: 1, name: "Flat White", station: "bar", prepMin: 3, mods: ["oat"] }],
        customer: "Sarah",
        channel: "counter",
      }),
    });
    expect(r.status).toBe(201);
    const order = await r.json();
    expect(order.id).toMatch(/^LOC-/);
    expect(order.status).toBe("queued");
    expect(order.num).toBeGreaterThanOrEqual(42);
    expect(typeof order.createdAt).toBe("number");

    // ...and it should now show up in the queue list
    const list = await (await fetch(`${BASE}/api/orders`)).json();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(order.id);
  });

  it("filters by status=queued vs status=bumped", async () => {
    const queued = await (await fetch(`${BASE}/api/orders?status=queued`)).json();
    const bumped = await (await fetch(`${BASE}/api/orders?status=bumped`)).json();
    expect(queued.length).toBe(1);
    expect(bumped.length).toBe(0);
  });
});

describe("POST /api/orders/:id/bump and /recall", () => {
  it("bumps an order, then recalls it back to queued", async () => {
    const list = await (await fetch(`${BASE}/api/orders`)).json();
    const id = list[0].id;

    const bumpR = await fetch(`${BASE}/api/orders/${id}/bump`, { method: "POST" });
    expect(bumpR.status).toBe(200);
    const bumped = await bumpR.json();
    expect(bumped.status).toBe("bumped");
    expect(bumped.bumpedAt).toBeGreaterThan(0);

    const recallR = await fetch(`${BASE}/api/orders/${id}/recall`, { method: "POST" });
    expect(recallR.status).toBe(200);
    const recalled = await recallR.json();
    expect(recalled.status).toBe("queued");
    expect(recalled.bumpedAt).toBe(0);
  });

  it("returns 404 for unknown order id on bump", async () => {
    const r = await fetch(`${BASE}/api/orders/nope-not-real/bump`, { method: "POST" });
    expect(r.status).toBe(404);
  });
});

describe("DELETE /api/orders (admin-gated)", () => {
  it("rejects an unauthenticated DELETE with 401", async () => {
    const r = await fetch(`${BASE}/api/orders`, { method: "DELETE" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Basic/);
  });

  it("clears the queue when the right Basic Auth credentials are sent", async () => {
    const auth = "Basic " + Buffer.from("admin:test-password").toString("base64");
    const r = await fetch(`${BASE}/api/orders`, {
      method: "DELETE",
      headers: { authorization: auth },
    });
    expect(r.status).toBe(200);
    const list = await (await fetch(`${BASE}/api/orders`)).json();
    expect(list).toEqual([]);
  });
});

describe("POST /square/webhook (HMAC verified)", () => {
  it("accepts a webhook with a valid signature", async () => {
    // We deliberately use a NON-order event type ("invoice.created") so the
    // signature gate is exercised without triggering an outbound fetch to
    // Square's API (which would slow CI down or flake on sandbox outages).
    // The signature-check logic is identical regardless of event type.
    const event = {
      type: "invoice.created",
      event_id: "evt_int_test_sig_ok",
      data: { id: "INV_TEST", type: "invoice" },
    };
    const body = JSON.stringify(event);
    const sig = computeSquareSig(body, SQ_SIG_KEY, SQ_HOOK_URL);

    const r = await fetch(`${BASE}/square/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-square-hmacsha256-signature": sig,
      },
      body,
    });
    expect(r.status).toBe(200);
  });

  it("rejects a webhook with a bad signature with 401", async () => {
    const body = JSON.stringify({ type: "order.created", event_id: "evt_bad", data: {} });
    const r = await fetch(`${BASE}/square/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-square-hmacsha256-signature": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      },
      body,
    });
    expect(r.status).toBe(401);
  });

  it("rejects a webhook with no signature header at all with 401", async () => {
    const body = JSON.stringify({ type: "order.created", event_id: "evt_none", data: {} });
    const r = await fetch(`${BASE}/square/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(r.status).toBe(401);
  });
});

describe("GET /settings.html (admin-gated static)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const r = await fetch(`${BASE}/settings.html`);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Basic/);
  });

  it("serves the page when the right credentials are sent", async () => {
    const auth = "Basic " + Buffer.from("admin:test-password").toString("base64");
    const r = await fetch(`${BASE}/settings.html`, { headers: { authorization: auth } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<title>");
  });
});

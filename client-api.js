/* =========================================================
   client-api.js — shared browser-side KDS API client.

   Tries the backend at /api/*. If the backend is unreachable
   (server off, offline demo) it transparently falls back to
   localStorage so the pages keep working either way.

   Exposes:      window.kdsApi
   Events:       kdsApi.subscribe(cb) — cb(type, data)
   ========================================================= */

(function () {
  const LS_ORDERS = "cb_orders";
  const LS_NUM    = "cb_order_num";
  const LS_MODE   = "cb_api_mode";

  const kdsApi = {
    mode: "unknown", // "server" | "local"
    health: null,

    _setMode(m) {
      if (this.mode !== m) {
        console.log(`[kdsApi] mode → ${m}`);
        this.mode = m;
        localStorage.setItem(LS_MODE, m);
        window.dispatchEvent(new CustomEvent("kdsapi:mode", { detail: m }));
      }
    },

    async checkHealth() {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) throw new Error(r.status);
        this.health = await r.json();
        this._setMode("server");
        return this.health;
      } catch (e) {
        this.health = null;
        this._setMode("local");
        return null;
      }
    },

    async listOrders(status = null) {
      try {
        const q = status ? `?status=${encodeURIComponent(status)}` : "";
        const r = await fetch(`/api/orders${q}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status);
        this._setMode("server");
        return await r.json();
      } catch (e) {
        this._setMode("local");
        let list = [];
        try { list = JSON.parse(localStorage.getItem(LS_ORDERS) || "[]"); } catch {}
        if (status) list = list.filter(o => o.status === status);
        return list;
      }
    },

    async createOrder(order) {
      try {
        const r = await fetch("/api/orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(order),
        });
        if (!r.ok) throw new Error(r.status);
        this._setMode("server");
        return await r.json();
      } catch (e) {
        this._setMode("local");
        const num = order.num || (parseInt(localStorage.getItem(LS_NUM) || "41", 10) + 1);
        localStorage.setItem(LS_NUM, num.toString());
        const full = {
          id: order.id || ("LOC-" + num.toString().padStart(4, "0")),
          num,
          createdAt: order.createdAt || Date.now(),
          status: "queued",
          bumpedAt: 0,
          ...order,
        };
        const list = this._localList();
        list.push(full);
        this._localSave(list);
        return full;
      }
    },

    async bumpOrder(id) {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(id)}/bump`, { method: "POST" });
        if (!r.ok) throw new Error(r.status);
        this._setMode("server");
        return await r.json();
      } catch (e) {
        this._setMode("local");
        const list = this._localList();
        const i = list.findIndex(o => o.id === id);
        if (i === -1) return null;
        list[i].status = "bumped";
        list[i].bumpedAt = Date.now();
        this._localSave(list);
        return list[i];
      }
    },

    async recallOrder(id) {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(id)}/recall`, { method: "POST" });
        if (!r.ok) throw new Error(r.status);
        this._setMode("server");
        return await r.json();
      } catch (e) {
        this._setMode("local");
        const list = this._localList();
        const i = list.findIndex(o => o.id === id);
        if (i === -1) return null;
        list[i].status = "queued";
        list[i].createdAt = Date.now() - 1000;
        list[i].bumpedAt = 0;
        this._localSave(list);
        return list[i];
      }
    },

    async clearAll() {
      try {
        const r = await fetch("/api/orders", { method: "DELETE" });
        if (!r.ok) throw new Error(r.status);
        return true;
      } catch {
        localStorage.removeItem(LS_ORDERS);
        localStorage.removeItem(LS_NUM);
        return true;
      }
    },

    /* ---------- event stream ---------- */
    subscribe(cb) {
      let es = null;
      let retry;
      const open = () => {
        try {
          es = new EventSource("/api/stream");
          es.addEventListener("connected", e => {
            this._setMode("server");
            try { cb("connected", JSON.parse(e.data)); } catch {}
          });
          ["order.created", "order.bumped", "order.recalled", "orders.cleared"].forEach(k => {
            es.addEventListener(k, e => {
              try { cb(k, JSON.parse(e.data)); } catch {}
            });
          });
          es.onerror = () => {
            // Let EventSource auto-reconnect. If it never does (server off),
            // listening to localStorage 'storage' event keeps multi-tab sync.
          };
        } catch (e) {
          // EventSource unsupported — silent fallback
        }
      };
      open();

      // Cross-tab localStorage sync (works even when the server is off)
      const onStorage = e => {
        if (e.key === LS_ORDERS) cb("local.change", null);
      };
      window.addEventListener("storage", onStorage);

      return () => {
        clearTimeout(retry);
        es?.close();
        window.removeEventListener("storage", onStorage);
      };
    },

    /* ---------- localStorage helpers ---------- */
    _localList() {
      try { return JSON.parse(localStorage.getItem(LS_ORDERS) || "[]"); }
      catch { return []; }
    },
    _localSave(list) {
      localStorage.setItem(LS_ORDERS, JSON.stringify(list));
    },
  };

  window.kdsApi = kdsApi;

  // Run a health check on load so pages can show a mode indicator.
  kdsApi.checkHealth();
})();

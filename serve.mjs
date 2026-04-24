// serve.mjs — zero-dependency static server for the Demo KDS project.
// Runs on http://localhost:4000. No npm install needed — Node 18+ has everything.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 4000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const INDEX_FILES = ["index.html"];

async function serveFile(res, absPath) {
  try {
    const info = await stat(absPath);
    let target = absPath;
    if (info.isDirectory()) {
      let found = null;
      for (const idx of INDEX_FILES) {
        const candidate = join(absPath, idx);
        try {
          await stat(candidate);
          found = candidate;
          break;
        } catch {}
      }
      if (!found) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      target = found;
    }
    const data = await readFile(target);
    const ct = TYPES[extname(target).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": ct,
      "cache-control": "no-store",
      "x-served-by": "demo-kds",
    });
    res.end(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404 — not found");
    } else {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("500 — " + err.message);
    }
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const abs = normalize(join(ROOT, rel));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("bad path");
    return;
  }
  serveFile(res, abs);
});

server.listen(PORT, () => {
  const lines = [
    "",
    "  ╔══════════════════════════════════════════════════╗",
    "  ║  DEMO KDS — local static server                  ║",
    "  ║  http://localhost:" + PORT + "                              ║",
    "  ╠══════════════════════════════════════════════════╣",
    "  ║  /           landing / project readme            ║",
    "  ║  /kds.html   kitchen display (open on tablet)    ║",
    "  ║  /counter    counter entry (open on POS laptop)  ║",
    "  ║  /history    completed orders + analytics        ║",
    "  ║  /settings   prep-time targets, stations         ║",
    "  ╚══════════════════════════════════════════════════╝",
    "",
    "  Tip: open /kds.html in one tab + /counter.html in another,",
    "       send an order, watch it pop on the KDS.",
    "",
  ];
  for (const l of lines) console.log(l);
});

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";

const PORT = Number(process.env.PORT) || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../artifacts/app/dist/public");

const mime = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".ttf":  "font/ttf",
  ".webp": "image/webp",
  ".gif":  "image/gif",
};

// Long cache for hashed assets, no-cache for HTML
const cacheHeader = (ext) =>
  ext === ".html" ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable";

const API_PORT = Number(process.env.API_PORT) || 8080;

const server = http.createServer((req, res) => {
  // Proxy /api/* requests to the Express backend
  if (req.url.startsWith("/api")) {
    const proxy = httpRequest(
      { hostname: "127.0.0.1", port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );
    proxy.on("error", () => { try { res.writeHead(502); res.end("Bad Gateway"); } catch {} });
    req.pipe(proxy, { end: true });
    return;
  }

  // Handle CORS pre-flight quickly
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Content-Length": "0", Connection: "keep-alive" });
    res.end();
    return;
  }

  let url = req.url.split("?")[0];

  // Guard against malformed percent-encoding
  let decoded;
  try { decoded = decodeURIComponent(url); } catch {
    res.writeHead(400); res.end("Bad Request"); return;
  }

  // Guard against path traversal — resolve against root so ../.. tricks are neutralised
  const resolved = path.resolve(root, "." + decoded);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  let filePath = resolved;

  // SPA fallback: anything without an extension → index.html
  const ext = path.extname(filePath);
  if (!ext || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html");
  }

  const finalExt = path.extname(filePath);
  const type = mime[finalExt] || "application/octet-stream";

  let stat;
  try { stat = fs.statSync(filePath); } catch {
    res.writeHead(404); res.end("Not found"); return;
  }

  // Conditional GET support (ETag via mtime)
  const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304); res.end(); return;
  }

  res.writeHead(200, {
    "Content-Type":   type,
    "Content-Length": stat.size,
    "Cache-Control":  cacheHeader(finalExt),
    "ETag":           etag,
    "Connection":     "keep-alive",
  });

  if (req.method === "HEAD") { res.end(); return; }

  // Stream the file — never blocks the event loop
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => { try { res.end(); } catch {} });
  stream.pipe(res);
});

// Keep connections alive between requests (reduces proxy round-trip overhead)
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PhoneLink serving on http://0.0.0.0:${PORT}`);
});

"use strict";

// Synthetic, offline-only layout preview: intentionally excludes ALL module
// scripts, including Firebase clients. This is not production integration QA.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".woff2": "font/woff2", ".ico": "image/x-icon" };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.startsWith("functions")
      || relative.startsWith(".") || !mime[path.extname(file)]) throw new Error("Not available");
    let content = await fs.readFile(file);
    if (file === path.join(root, "index.html")) {
      content = Buffer.from(content.toString("utf8").replace(/<script\b(?=[^>]*\btype="module")[^>]*>[\s\S]*?<\/script>/g, ""));
    }
    response.writeHead(200, { "Content-Type": `${mime[path.extname(file)]}; charset=utf-8`, "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'none'; style-src 'self' 'unsafe-inline'; frame-src 'none'; form-action 'none'" });
    response.end(content);
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(8765, "127.0.0.1", () => console.log("Offline synthetic layout preview: http://127.0.0.1:8765"));

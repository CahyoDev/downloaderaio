// Server pengembangan lokal: menyajikan public/ dan menjalankan fungsi di api/ seperti Vercel.
// Pakai:  npm run dev   ->  http://localhost:3000
// (Alternatif resmi: `npx vercel dev`, tapi itu butuh login Vercel.)

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const apiDir = path.join(root, "api");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, "");
        const file = path.join(apiDir, `${name}.js`);
        try {
          await fs.access(file);
        } catch {
          res.statusCode = 404;
          return res.end("Not found");
        }
        // Meniru Vercel: body JSON otomatis di-parse ke req.body
        if (req.method !== "GET" && req.method !== "HEAD") {
          const raw = await readBody(req);
          if (/application\/json/i.test(req.headers["content-type"] || "") && raw.length) {
            try { req.body = JSON.parse(raw.toString("utf8")); } catch { req.body = undefined; }
          } else {
            req.body = raw.toString("utf8");
          }
        }
        const mod = await import(pathToFileURL(file).href);
        return mod.default(req, res);
      }

      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const filePath = path.join(publicDir, rel);
      if (!filePath.startsWith(publicDir)) {
        res.statusCode = 403;
        return res.end("Forbidden");
      }
      const data = await fs.readFile(filePath);
      res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
    } catch (err) {
      res.statusCode = err.code === "ENOENT" ? 404 : 500;
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`Mori web dev server: http://localhost:${port}`));
}

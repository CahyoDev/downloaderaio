// GET /api/dl?url=<media-url>&name=<file.mp4>&ref=<referer>&origin=<origin>&ua=<ua>&inline=1
// Meneruskan (stream) file media dari CDN ke browser. Dibutuhkan karena banyak CDN menolak
// hotlink tanpa Referer yang benar, dan browser tidak boleh mengatur Referer/Origin sendiri.
//
// Mode default  : Content-Disposition: attachment (untuk tombol Download)
// Mode inline=1 : dipakai untuk preview gambar/video, mendukung header Range.

import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  HttpError, checkAuth, checkSameSite, sendJson, parseTarget, fetchFollowing,
} from "./_lib/guard.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";
const HEADER_TIMEOUT_MS = 20_000;

// Tipe konten yang tidak pernah boleh keluar dari domain ini (cegah hosting HTML/JS/SVG
// dan halaman error Cloudflare yang menyamar jadi "video").
const BLOCKED_TYPES = /^(text\/|application\/(json|xml|xhtml|javascript|x-javascript|ecmascript)|image\/svg)/i;

function maxBytes() {
  const mb = parseFloat(process.env.MAX_DOWNLOAD_MB || "250");
  return (Number.isFinite(mb) && mb > 0 ? mb : 250) * 1024 * 1024;
}

function safeFileName(raw) {
  let name = String(raw || "download")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return name || "download";
}

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function cleanHeaderValue(v, max = 300) {
  if (typeof v !== "string") return "";
  return /[\r\n]/.test(v) ? "" : v.slice(0, max);
}

export default async function handler(req, res) {
  const controller = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (req.method !== "GET") throw new HttpError(405, "Gunakan GET");
    checkSameSite(req);
    checkAuth(req);

    const q = new URL(req.url, "http://x").searchParams;
    const target = parseTarget(q.get("url"));
    const inline = q.get("inline") === "1";

    const headers = {
      "user-agent": cleanHeaderValue(q.get("ua")) || DEFAULT_UA,
      accept: "*/*",
    };
    const ref = cleanHeaderValue(q.get("ref"));
    const origin = cleanHeaderValue(q.get("origin"));
    if (/^https?:\/\//i.test(ref)) headers.referer = ref;
    if (/^https?:\/\//i.test(origin)) headers.origin = origin;
    if (req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.range = req.headers.range;

    // Batas waktu hanya untuk fase header; body di-stream sampai selesai.
    const headerTimer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
    let result;
    try {
      result = await fetchFollowing({
        url: target.toString(),
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, err?.name === "AbortError" ? "Timeout menghubungi server media" : "Gagal menghubungi server media");
    } finally {
      clearTimeout(headerTimer);
    }

    const { res: up } = result;
    if (up.status !== 200 && up.status !== 206) {
      await up.body?.cancel().catch(() => {});
      throw new HttpError(502, `Server media membalas HTTP ${up.status}`);
    }

    const type = up.headers.get("content-type") || "application/octet-stream";
    if (BLOCKED_TYPES.test(type)) {
      await up.body?.cancel().catch(() => {});
      throw new HttpError(502, "Server media mengembalikan halaman/JSON, bukan file (link kedaluwarsa atau diblokir)");
    }

    const limit = maxBytes();
    // Awas: Number(null) === 0. Header yang tidak ada harus dianggap "tidak diketahui".
    const lenHeader = up.headers.get("content-length");
    const len = lenHeader ? Number(lenHeader) : NaN;
    if (Number.isFinite(len) && len > limit) {
      await up.body?.cancel().catch(() => {});
      throw new HttpError(413, `File melebihi batas ${Math.round(limit / 1048576)} MB`);
    }

    const name = safeFileName(q.get("name"));
    res.statusCode = up.status;
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cache-Control", inline ? "private, max-age=300" : "no-store");
    res.setHeader("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", name));
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Disposition");
    const encoded = up.headers.get("content-encoding");
    if (!encoded && Number.isFinite(len)) res.setHeader("Content-Length", String(len));
    for (const h of ["content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    let sent = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        sent += chunk.length;
        if (sent > limit) return cb(new Error("size-limit"));
        cb(null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(up.body), counter, res);
    } catch {
      // klien membatalkan / batas ukuran terlewati: putuskan koneksi
      res.destroy();
    }
  } catch (err) {
    if (res.headersSent) return res.destroy();
    const status = err instanceof HttpError ? err.status : 500;
    sendJson(res, status, { error: err instanceof HttpError ? err.message : "Internal error" });
  }
}

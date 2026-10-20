// POST /api/http
// Pengganti "native HTTP" milik aplikasi Android/Desktop. Browser tidak bisa memanggil
// situs penyedia scraper langsung (CORS + header terlarang seperti Cookie/Referer),
// jadi request dilakukan dari sisi server lalu hasilnya dikembalikan sebagai JSON.
//
// Body : { url, method, headers, data, timeout }
// Balik: { status, headers, data, url }   (atau { status: 0, error } bila gagal jaringan)

import {
  HttpError, checkAuth, checkSameSite, sendJson, getAllowedHosts, hostMatches,
  parseTarget, cleanRequestHeaders, fetchFollowing,
} from "./_lib/guard.js";

const MAX_BODY_IN = 1024 * 1024; // 1 MB body request
const MAX_BODY_OUT = 3.5 * 1024 * 1024; // respons non-streaming Vercel dibatasi 4,5 MB
const MAX_TIMEOUT_MS = 25_000;
const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "HEAD"]);

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY_IN) throw new HttpError(413, "Body terlalu besar");
      chunks.push(c);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Body harus JSON");
  }
}

function decodeBody(buf, contentType) {
  const m = /charset=([^;]+)/i.exec(contentType || "");
  const label = m ? m[1].trim().replace(/["']/g, "") : "utf-8";
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function readCapped(res, limit) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(502, "Respons upstream terlalu besar");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Gunakan POST");
    if (!/application\/json/i.test(req.headers["content-type"] || "")) {
      throw new HttpError(415, "Content-Type harus application/json");
    }
    checkSameSite(req);
    checkAuth(req);

    const opts = await readJsonBody(req);
    const method = String(opts.method || (opts.data ? "POST" : "GET")).toUpperCase();
    if (!METHODS.has(method)) throw new HttpError(400, "Method tidak didukung");

    const target = parseTarget(opts.url);
    if (!hostMatches(target.hostname, getAllowedHosts())) {
      throw new HttpError(403, `Host tidak ada di allowlist: ${target.hostname}`);
    }

    let body;
    if (opts.data !== undefined && opts.data !== null && method !== "GET" && method !== "HEAD") {
      body = typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data);
      if (Buffer.byteLength(body) > MAX_BODY_IN) throw new HttpError(413, "Body terlalu besar");
    }

    const timeout = Math.min(Math.max(Number(opts.timeout) || 20_000, 3_000), MAX_TIMEOUT_MS);
    const cookies = [];

    let result;
    try {
      result = await fetchFollowing({
        url: target.toString(),
        method,
        headers: cleanRequestHeaders(opts.headers),
        body,
        signal: AbortSignal.timeout(timeout),
        onHop: (r) => {
          const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
          cookies.push(...sc);
        },
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      return sendJson(res, 200, {
        status: 0,
        error: timedOut ? `Timeout setelah ${Math.round(timeout / 1000)} detik` : (err?.cause?.code || err?.message || "Request gagal"),
      });
    }

    const { res: up, finalUrl } = result;
    const buf = method === "HEAD" ? Buffer.alloc(0) : await readCapped(up, MAX_BODY_OUT);

    const headers = {};
    up.headers.forEach((v, k) => {
      if (["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(k)) return;
      headers[k] = v;
    });
    if (cookies.length) headers["set-cookie"] = cookies;

    return sendJson(res, 200, {
      status: up.status,
      headers,
      data: decodeBody(buf, up.headers.get("content-type")),
      url: finalUrl,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return sendJson(res, status, { error: err instanceof HttpError ? err.message : "Internal error" });
  }
}

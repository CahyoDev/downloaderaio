// Pengaman bersama untuk semua fungsi /api.
// Tujuan: proxy ini TIDAK boleh bisa dipakai untuk menjangkau jaringan internal (SSRF)
// atau disalahgunakan sebagai open proxy / hosting HTML di domain kamu.

import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

// ---------------------------------------------------------------------------
// Allowlist host untuk /api/http (request scraper).
// Dicocokkan sebagai domain persis ATAU subdomain-nya.
// Tambah host lain lewat env EXTRA_ALLOWED_HOSTS="a.com,b.net".
// ---------------------------------------------------------------------------
export const DEFAULT_ALLOWED_HOSTS = [
  // penyedia scraper
  "snapsave.app", "indown.net", "indown.io", "tikdownloader.io", "tiktokio.com",
  "ytmp3.gg", "ytmp3.mobi", "ymcdn.org", "convert1s.com",
  "twittervideodownloader.com", "savetwt.com", "tweeload.com",
  "spotidown.app", "spotimate.app", "aplmate.com", "pindown.io",
  "threadster.app", "bandcampdownloader.app", "rapidsave.com", "sechno.com",
  "ugoira.com", "pixiv.re",
  // platform sumber
  "tiktok.com", "douyin.com", "iesdouyin.com", "snssdk.com",
  "youtube.com", "youtu.be", "ytimg.com",
  "instagram.com", "facebook.com", "fb.watch", "threads.net", "threads.com",
  "twitter.com", "x.com", "fxtwitter.com", "twimg.com",
  "spotify.com", "music.apple.com", "apple.com", "bandcamp.com",
  "pinterest.com", "pin.it", "pinimg.com",
  "pixiv.net", "pximg.net",
  "bilibili.com", "bilibili.tv", "b23.tv", "bili.im",
  "xiaohongshu.com", "xhslink.com", "rednote.com",
  "reddit.com", "redd.it",
  "terabox.com", "1024tera.com", "nephobox.com", "4funbox.com",
  "mirrobox.com", "momerybox.com", "tibibox.com",
];

export function getAllowedHosts() {
  const extra = (process.env.EXTRA_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_HOSTS, ...extra];
}

export function hostMatches(hostname, list) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return list.some((d) => h === d || h.endsWith("." + d));
}

// ---------------------------------------------------------------------------
// IP publik vs privat
// ---------------------------------------------------------------------------
function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

const V4_BLOCKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0 }));

export function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(({ base, mask }) => (n & mask) >>> 0 === (base & mask) >>> 0);
}

function parseIPv6(input) {
  let s = input.split("%")[0].toLowerCase();
  let tail = null;
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".") && lastColon !== -1) {
    const v4 = s.slice(lastColon + 1);
    if (net.isIPv4(v4)) {
      const n = ipv4ToInt(v4);
      tail = [(n >>> 16) & 0xffff, n & 0xffff];
      s = s.slice(0, lastColon + 1) + "0:0";
    }
  }
  const [head, rest] = s.split("::");
  const h = head ? head.split(":") : [];
  const r = rest !== undefined ? (rest ? rest.split(":") : []) : null;
  let groups;
  if (r === null) {
    groups = h;
  } else {
    const fill = 8 - h.length - r.length;
    groups = [...h, ...Array(Math.max(fill, 0)).fill("0"), ...r];
  }
  const nums = groups.map((g) => parseInt(g || "0", 16));
  if (tail) {
    nums[6] = tail[0];
    nums[7] = tail[1];
  }
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

export function isPrivateIPv6(ip) {
  const g = parseIPv6(ip);
  if (!g) return true; // tidak bisa diparse -> anggap tidak aman
  const [a, b, c, d, e, f, g6, g7] = g;
  const embeddedV4 = `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPrivateIPv4(embeddedV4); // ::ffff:a.b.c.d
  if (a === 0x64 && b === 0xff9b) return isPrivateIPv4(embeddedV4); // NAT64
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // dokumentasi
  if (a === 0x2002) return true; // 6to4 (bisa membungkus IP privat)
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true; // discard
  return false;
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

// ---------------------------------------------------------------------------
// Validasi URL target
// ---------------------------------------------------------------------------
export function parseTarget(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new HttpError(400, "URL tidak valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Hanya http/https yang diizinkan");
  }
  if (url.username || url.password) {
    throw new HttpError(400, "URL dengan kredensial tidak diizinkan");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new HttpError(400, "Port tidak diizinkan");
  }
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpError(400, "Host tidak diizinkan");
  }
  return url;
}

// Pastikan semua alamat hasil DNS adalah IP publik.
export async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateAddress(bare)) throw new HttpError(400, "Alamat IP privat tidak diizinkan");
    return;
  }
  let records;
  try {
    records = await dns.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new HttpError(502, `DNS gagal untuk ${bare}`);
  }
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) {
    throw new HttpError(400, "Host mengarah ke alamat privat");
  }
}

// ---------------------------------------------------------------------------
// Autentikasi & asal request
// ---------------------------------------------------------------------------
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Jika env ACCESS_TOKEN diisi, semua endpoint butuh token itu
// (header x-mori-token, atau ?token= untuk preview gambar/video).
export function checkAuth(req) {
  const expected = process.env.ACCESS_TOKEN;
  if (!expected) return;
  let given = req.headers["x-mori-token"];
  if (!given) {
    try {
      given = new URL(req.url, "http://x").searchParams.get("token");
    } catch {
      given = "";
    }
  }
  if (!given || !safeEqual(given, expected)) {
    throw new HttpError(401, "Access token salah atau belum diisi");
  }
}

// Tolak request lintas-situs (hotlinking dari website lain).
export function checkSameSite(req) {
  const sfs = req.headers["sec-fetch-site"];
  if (sfs && sfs !== "same-origin" && sfs !== "none") {
    throw new HttpError(403, "Request lintas-situs ditolak");
  }
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (origin && origin !== "null") {
    try {
      if (new URL(origin).host !== host) throw new Error("mismatch");
    } catch {
      throw new HttpError(403, "Origin tidak cocok");
    }
  }
}

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// Header request yang tidak boleh diteruskan ke upstream.
export const BLOCKED_REQ_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding", "accept-encoding",
  "keep-alive", "upgrade", "te", "trailer", "proxy-authorization", "proxy-connection",
  "forwarded", "via", "x-real-ip",
]);

export function cleanRequestHeaders(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).toLowerCase();
    if (BLOCKED_REQ_HEADERS.has(key) || key.startsWith("x-forwarded-") || key.startsWith("x-vercel-")) continue;
    if (typeof v !== "string" || v.length > 4096) continue;
    if (/[\r\n]/.test(v) || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) continue;
    out[key] = v;
  }
  return out;
}

// Ikuti redirect secara manual supaya SETIAP hop divalidasi (anti SSRF lewat redirect).
export async function fetchFollowing({ url, method = "GET", headers = {}, body, signal, onHop }) {
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = parseTarget(current);
    await assertPublicHost(target.hostname);
    const res = await fetch(target, {
      method: currentMethod,
      headers,
      body: ["GET", "HEAD"].includes(currentMethod) ? undefined : currentBody,
      redirect: "manual",
      signal,
    });
    if (onHop) onHop(res, target);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc && hop < MAX_REDIRECTS) {
      await res.body?.cancel().catch(() => {});
      current = new URL(loc, target).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
        currentMethod = currentMethod === "HEAD" ? "HEAD" : "GET";
        currentBody = undefined;
      }
      continue;
    }
    return { res, finalUrl: target.toString() };
  }
  throw new HttpError(502, "Terlalu banyak redirect");
}

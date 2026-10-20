import { test, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { createServer } from "../scripts/dev-server.mjs";
import {
  isPrivateAddress, parseTarget, assertPublicHost, hostMatches, DEFAULT_ALLOWED_HOSTS, HttpError,
} from "../api/_lib/guard.js";

// ---- stub jaringan: semua fetch ke luar diarahkan ke `upstream`, DNS dipalsukan ----
const realFetch = globalThis.fetch;
let upstream = async () => new Response("unconfigured", { status: 500 });
let upstreamCalls = [];
globalThis.fetch = (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.hostname === "127.0.0.1") return realFetch(input, init);
  upstreamCalls.push({ url: u, init });
  return upstream(u, init);
};
mock.method(dns, "lookup", async (host) =>
  host.startsWith("internal.") ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }],
);

let server, base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  upstreamCalls = [];
  delete process.env.ACCESS_TOKEN;
  delete process.env.MAX_DOWNLOAD_MB;
  delete process.env.EXTRA_ALLOWED_HOSTS;
});

const postHttp = (body, headers = {}) =>
  realFetch(`${base}/api/http`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const getDl = (qs, headers = {}) => realFetch(`${base}/api/dl?${new URLSearchParams(qs)}`, { headers });

// ===================================================================== guard
test("isPrivateAddress: IPv4 privat/khusus diblokir, IP publik lolos", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "1.1.1.1", "172.15.255.255"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("isPrivateAddress: IPv6 loopback/ULA/link-local/mapped/NAT64 diblokir", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1",
    "::ffff:7f00:1", "64:ff9b::a00:1", "ff02::1", "2002:7f00:1::1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("parseTarget menolak skema/kredensial/port/host berbahaya", () => {
  for (const bad of ["ftp://a.com/x", "javascript:alert(1)", "http://u:p@a.com/", "http://a.com:22/",
    "http://localhost/", "http://foo.localhost/", "http://svc.internal/", "http://printer.local/", "not a url"]) {
    assert.throws(() => parseTarget(bad), HttpError, bad);
  }
  assert.equal(parseTarget("https://snapsave.app/action.php").hostname, "snapsave.app");
});

test("assertPublicHost menolak bentuk IP alternatif (desimal/heks) dan host ber-DNS privat", async () => {
  await assert.rejects(assertPublicHost(parseTarget("http://2130706433/").hostname), HttpError); // 127.0.0.1
  await assert.rejects(assertPublicHost(parseTarget("http://0x7f.1/").hostname), HttpError);
  await assert.rejects(assertPublicHost(parseTarget("http://[::1]/").hostname), HttpError);
  await assert.rejects(assertPublicHost("internal.example.com"), HttpError);
  await assert.doesNotReject(assertPublicHost("snapsave.app"));
});

test("hostMatches cocok untuk domain & subdomain, bukan akhiran palsu", () => {
  assert.equal(hostMatches("a.snapsave.app", DEFAULT_ALLOWED_HOSTS), true);
  assert.equal(hostMatches("snapsave.app", DEFAULT_ALLOWED_HOSTS), true);
  assert.equal(hostMatches("evilsnapsave.app", DEFAULT_ALLOWED_HOSTS), false);
  assert.equal(hostMatches("snapsave.app.evil.com", DEFAULT_ALLOWED_HOSTS), false);
});

// ================================================================== /api/http
test("/api/http: GET host allowlist, ikuti redirect, kumpulkan Set-Cookie semua hop", async () => {
  upstream = async (u) => {
    if (u.pathname === "/start") {
      const h = new Headers({ location: "/next" });
      h.append("set-cookie", "a=1; Path=/");
      return new Response(null, { status: 302, headers: h });
    }
    const h = new Headers({ "content-type": "text/html; charset=utf-8" });
    h.append("set-cookie", "b=2; Path=/");
    return new Response("<p>halo</p>", { status: 200, headers: h });
  };
  const r = await postHttp({ url: "https://snapsave.app/start" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 200);
  assert.equal(j.url, "https://snapsave.app/next");
  assert.equal(j.data, "<p>halo</p>");
  assert.deepEqual(j.headers["set-cookie"], ["a=1; Path=/", "b=2; Path=/"]);
});

test("/api/http: POST meneruskan body & Cookie/Referer, membuang header berbahaya", async () => {
  upstream = async () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  const r = await postHttp({
    url: "https://tikdownloader.io/api/ajaxSearch",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded", Cookie: "x=1", Referer: "https://tikdownloader.io/",
      Host: "evil.com", "X-Forwarded-For": "1.2.3.4", "Content-Length": "999",
    },
    data: "q=abc&vt=id",
  });
  assert.equal((await r.json()).data, '{"ok":true}');
  const { init } = upstreamCalls[0];
  assert.equal(init.method, "POST");
  assert.equal(init.body, "q=abc&vt=id");
  assert.equal(init.headers.cookie, "x=1");
  assert.equal(init.headers.referer, "https://tikdownloader.io/");
  assert.equal(init.headers.host, undefined);
  assert.equal(init.headers["x-forwarded-for"], undefined);
  assert.equal(init.headers["content-length"], undefined);
  assert.equal(init.redirect, "manual");
});

test("/api/http: 301/302 pada POST berubah jadi GET tanpa body", async () => {
  upstream = async (u) =>
    u.pathname === "/a" ? new Response(null, { status: 302, headers: { location: "/b" } }) : new Response("ok");
  await postHttp({ url: "https://snapsave.app/a", method: "POST", data: "x=1" });
  assert.equal(upstreamCalls[1].init.method, "GET");
  assert.equal(upstreamCalls[1].init.body, undefined);
});

test("/api/http: host di luar allowlist ditolak (403), EXTRA_ALLOWED_HOSTS memperluas", async () => {
  upstream = async () => new Response("ok");
  assert.equal((await postHttp({ url: "https://example.org/" })).status, 403);
  process.env.EXTRA_ALLOWED_HOSTS = "example.org";
  assert.equal((await postHttp({ url: "https://example.org/" })).status, 200);
});

test("/api/http: SSRF — DNS privat, IP literal, dan redirect ke metadata cloud ditolak", async () => {
  upstream = async (u) =>
    u.pathname === "/r"
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
      : new Response("ok");
  assert.equal((await postHttp({ url: "https://internal.snapsave.app/" })).status, 400);
  assert.equal((await postHttp({ url: "http://127.0.0.1:8080/" })).status, 403); // bukan allowlist
  const viaRedirect = await postHttp({ url: "https://snapsave.app/r" });
  assert.equal(viaRedirect.status, 400);
  assert.equal(upstreamCalls.some((c) => c.url.hostname === "169.254.169.254"), false, "tidak boleh sampai fetch");
});

test("/api/http: error jaringan dibalas {status:0,error} (kontrak bridge)", async () => {
  upstream = async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } }); };
  const j = await (await postHttp({ url: "https://snapsave.app/" })).json();
  assert.equal(j.status, 0);
  assert.equal(j.error, "ECONNRESET");
});

test("/api/http: respons upstream >3,5 MB ditolak", async () => {
  upstream = async () => new Response(new Uint8Array(4 * 1024 * 1024));
  assert.equal((await postHttp({ url: "https://snapsave.app/big" })).status, 502);
});

test("/api/http: wajib JSON, tolak lintas-situs, dan hormati ACCESS_TOKEN", async () => {
  upstream = async () => new Response("ok");
  const plain = await realFetch(`${base}/api/http`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(plain.status, 415);
  assert.equal((await postHttp({ url: "https://snapsave.app/" }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await postHttp({ url: "https://snapsave.app/" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await realFetch(`${base}/api/http`)).status, 405);

  process.env.ACCESS_TOKEN = "rahasia";
  assert.equal((await postHttp({ url: "https://snapsave.app/" })).status, 401);
  assert.equal((await postHttp({ url: "https://snapsave.app/" }, { "x-mori-token": "salah" })).status, 401);
  assert.equal((await postHttp({ url: "https://snapsave.app/" }, { "x-mori-token": "rahasia" })).status, 200);
});

// ==================================================================== /api/dl
test("/api/dl: stream file, header attachment, Referer/Origin diteruskan", async () => {
  const bytes = new Uint8Array(1000).fill(7);
  upstream = async () => new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": "1000" } });
  const r = await getDl({
    url: "https://v16.tiktokcdn.example/video.mp4", name: "Judul Video é.mp4",
    ref: "https://tikdownloader.io/", origin: "https://tikdownloader.io",
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "video/mp4");
  assert.equal(r.headers.get("content-length"), "1000");
  assert.match(r.headers.get("content-disposition"), /^attachment; filename="Judul Video _\.mp4"; filename\*=UTF-8''Judul%20Video%20%C3%A9\.mp4$/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(new Uint8Array(await r.arrayBuffer()).length, 1000);
  const h = upstreamCalls[0].init.headers;
  assert.equal(h.referer, "https://tikdownloader.io/");
  assert.equal(h.origin, "https://tikdownloader.io");
});

test("/api/dl: nama file disanitasi dari path traversal", async () => {
  upstream = async () => new Response("x", { headers: { "content-type": "audio/mpeg" } });
  const r = await getDl({ url: "https://cdn.example.com/a.mp3", name: "../../etc/passwd" });
  assert.match(r.headers.get("content-disposition"), /filename=".{0,6}etc_passwd"/);
  assert.doesNotMatch(r.headers.get("content-disposition"), /\.\.\//);
});

test("/api/dl: mode inline + Range meneruskan 206", async () => {
  upstream = async () =>
    new Response(new Uint8Array(100), {
      status: 206,
      headers: { "content-type": "video/mp4", "content-range": "bytes 0-99/5000", "accept-ranges": "bytes", "content-length": "100" },
    });
  const r = await getDl({ url: "https://cdn.example.com/a.mp4", inline: "1" }, { range: "bytes=0-99" });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 0-99/5000");
  assert.match(r.headers.get("content-disposition"), /^inline;/);
  assert.equal(upstreamCalls[0].init.headers.range, "bytes=0-99");
  await r.arrayBuffer();
});

test("/api/dl: halaman HTML/JSON/SVG dari upstream ditolak (bukan media)", async () => {
  for (const type of ["text/html; charset=utf-8", "application/json", "image/svg+xml", "text/javascript"]) {
    upstream = async () => new Response("<html>Cloudflare</html>", { headers: { "content-type": type } });
    const r = await getDl({ url: "https://cdn.example.com/a.mp4" });
    assert.equal(r.status, 502, type);
    assert.match((await r.json()).error, /bukan file/);
  }
});

test("/api/dl: status upstream non-2xx → 502", async () => {
  upstream = async () => new Response("denied", { status: 403 });
  const r = await getDl({ url: "https://cdn.example.com/a.mp4" });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /403/);
});

test("/api/dl: batas ukuran (Content-Length & stream tanpa length)", async () => {
  process.env.MAX_DOWNLOAD_MB = "1";
  upstream = async () => new Response(new Uint8Array(10), { headers: { "content-type": "video/mp4", "content-length": String(2 * 1048576) } });
  assert.equal((await getDl({ url: "https://cdn.example.com/a.mp4" })).status, 413);

  // stream tanpa Content-Length, dikirim per potongan 64 KB seperti CDN sungguhan
  const chunked = () => {
    let left = 3 * 1048576;
    return new ReadableStream({
      pull(c) {
        if (left <= 0) return c.close();
        c.enqueue(new Uint8Array(65536));
        left -= 65536;
      },
    });
  };
  upstream = async () => new Response(chunked(), { headers: { "content-type": "video/mp4" } });
  const r = await getDl({ url: "https://cdn.example.com/b.mp4" });
  assert.equal(r.status, 200);
  await assert.rejects(r.arrayBuffer(), "koneksi harus diputus saat melewati batas");
});

test("/api/dl: SSRF, lintas-situs, token, dan method", async () => {
  upstream = async () => new Response("x", { headers: { "content-type": "video/mp4" } });
  assert.equal((await getDl({ url: "http://127.0.0.1/secret" })).status, 400);
  assert.equal((await getDl({ url: "http://169.254.169.254/latest" })).status, 400);
  assert.equal((await getDl({ url: "https://internal.cdn.example.com/a.mp4" })).status, 400);
  assert.equal((await getDl({ url: "file:///etc/passwd" })).status, 400);
  assert.equal((await getDl({ url: "https://cdn.example.com/a.mp4" }, { "sec-fetch-site": "cross-site" })).status, 403);

  process.env.ACCESS_TOKEN = "rahasia";
  assert.equal((await getDl({ url: "https://cdn.example.com/a.mp4" })).status, 401);
  const ok = await getDl({ url: "https://cdn.example.com/a.mp4", token: "rahasia" });
  assert.equal(ok.status, 200);
  await ok.arrayBuffer();
  assert.equal((await realFetch(`${base}/api/dl`, { method: "POST" })).status, 405);
});

test("/api/dl: regresi — upstream tanpa Content-Length (chunked) tetap terkirim utuh", async () => {
  let left = 5 * 65536;
  upstream = async () =>
    new Response(
      new ReadableStream({
        pull(c) {
          if (left <= 0) return c.close();
          c.enqueue(new Uint8Array(65536).fill(1));
          left -= 65536;
        },
      }),
      { headers: { "content-type": "video/mp4" } },
    );
  const r = await getDl({ url: "https://cdn.example.com/chunked.mp4" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-length"), null, "tidak boleh mengarang Content-Length");
  assert.equal((await r.arrayBuffer()).byteLength, 5 * 65536);
});

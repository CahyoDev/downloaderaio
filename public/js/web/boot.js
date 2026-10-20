/*
 * Mori Web — boot (skrip klasik, dimuat SEBELUM js/app.js)
 *
 * 1. Menandai bahwa app berjalan sebagai website (bukan APK / desktop).
 * 2. Mengatur default setting yang masuk akal untuk browser.
 * 3. Menyediakan "jembatan HTTP": scraper aslinya memanggil window.MoriMainBridge.httpRequestAsync
 *    (kontrak bridge Android). Di web, panggilan itu diteruskan ke fungsi serverless /api/http,
 *    sehingga seluruh scraper (termasuk bundle.js) jalan TANPA diubah.
 */
(function () {
  "use strict";

  window.__MORI_WEB__ = true;
  document.documentElement.classList.add("is-web");

  var W = (window.__moriWeb = {});

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* mode privat / penuh */ }
  }

  // ---- default setting khusus web -------------------------------------------------
  // DEFAULTS: hanya diisi kalau pengguna belum pernah mengaturnya.
  var DEFAULTS = {
    mori_auto_paste: "false",     // baca clipboard otomatis memicu prompt izin di browser
    mori_auto_update: "false",    // cek rilis APK tidak relevan di web
    mori_auto_download: "false",
  };
  Object.keys(DEFAULTS).forEach(function (k) {
    if (lsGet(k) === null) lsSet(k, DEFAULTS[k]);
  });
  // FORCED: fitur native yang tidak ada di browser; dipaksa mati agar tidak memblokir alur.
  var FORCED = {
    mori_show_gallery: "false",   // galeri membaca file lokal lewat plugin Filesystem
    mori_wifi_only: "false",
    mori_cellular_warning: "false",
    mori_bypass_ssl: "false",
    mori_force_ipv4: "false",
    mori_doh: "off",
  };
  Object.keys(FORCED).forEach(function (k) { lsSet(k, FORCED[k]); });
  // Kode eksekusi OTA dari GitHub tidak dipakai di web (update = deploy ulang).
  try {
    localStorage.removeItem("mori_patched_scraper_bin");
    localStorage.removeItem("mori_active_scraper_version");
  } catch (e) { /* abaikan */ }

  // ---- access token (opsional, bila env ACCESS_TOKEN di-set di Vercel) -------------
  W.getToken = function () { return lsGet("mori_access_token") || ""; };
  W.authHeaders = function () {
    var t = W.getToken();
    return t ? { "x-mori-token": t } : {};
  };
  W.askToken = function () {
    var t = window.prompt("Situs ini dilindungi. Masukkan access token:");
    if (t && t.trim()) {
      lsSet("mori_access_token", t.trim());
      return true;
    }
    return false;
  };

  // URL ke /api/dl (stream media lewat server supaya Referer/Origin bisa diatur)
  W.dlUrl = function (mediaUrl, o) {
    o = o || {};
    var p = new URLSearchParams();
    p.set("url", mediaUrl);
    if (o.name) p.set("name", o.name);
    if (o.ref) p.set("ref", o.ref);
    if (o.origin) p.set("origin", o.origin);
    if (o.ua) p.set("ua", o.ua);
    if (o.inline) p.set("inline", "1");
    // <img>/<video> tidak bisa mengirim header khusus, jadi token ikut di query
    if (o.inline && W.getToken()) p.set("token", W.getToken());
    return "/api/dl?" + p.toString();
  };

  // POST JSON ke fungsi serverless; bila 401, minta token sekali lalu coba lagi
  W.postJson = async function (path, body) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var headers = Object.assign({ "content-type": "application/json" }, W.authHeaders());
      var res = await fetch(path, { method: "POST", headers: headers, body: JSON.stringify(body) });
      if (res.status === 401 && attempt === 0 && W.askToken()) continue;
      return res;
    }
  };

  // ---- jembatan HTTP untuk scraper -------------------------------------------------
  var bridge = (window.MoriMainBridge = window.MoriMainBridge || {});
  if (!bridge.httpRequestAsync) {
    bridge.httpRequestAsync = function (optsJson, reqId) {
      function done(obj) {
        var cb = window.__moriNativeCallbacks && window.__moriNativeCallbacks[reqId];
        if (cb) cb(JSON.stringify(obj));
      }
      (async function () {
        try {
          var opts = JSON.parse(optsJson);
          var timeoutSec = parseInt(lsGet("mori_request_timeout"), 10);
          var res = await W.postJson("/api/http", {
            url: opts.url,
            method: opts.method,
            headers: opts.headers,
            data: opts.data,
            timeout: timeoutSec >= 5 && timeoutSec <= 180 ? timeoutSec * 1000 : 30000,
          });
          var j = null;
          try { j = await res.json(); } catch (e) { /* bukan JSON */ }
          if (!res.ok || !j) {
            done({ status: 0, error: (j && j.error) || "Proxy error HTTP " + res.status });
            return;
          }
          done(j);
        } catch (e) {
          done({ status: 0, error: (e && e.message) || "Network error" });
        }
      })();
    };
  }
})();

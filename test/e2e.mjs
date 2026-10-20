// Uji end-to-end di browser sungguhan (Chromium via Playwright).
// Tidak ikut `npm test` karena butuh Playwright:
//   npm i -D playwright && npx playwright install chromium && node test/e2e.mjs
// Penyedia scraper & CDN dipalsukan di dalam proses ini (tanpa internet).

import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { mock } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "../scripts/dev-server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

// ---------------------------------------------------------------- upstream palsu
const VIDEO = new Uint8Array(300 * 1024).map((_, i) => i % 251);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.hostname === "127.0.0.1") return realFetch(input, init);
  calls.push({ url: u.toString(), method: init.method || "GET", headers: init.headers || {}, body: init.body });

  if (u.hostname === "tikdownloader.io" && u.pathname === "/api/ajaxSearch") {
    const html = `
      <div class="clearfix"><div class="image-tik"><img src="https://cdn.fake-tt.example/thumb.jpg"></div>
      <h3>Video Uji Mori #1</h3></div>
      <a href="https://cdn.fake-tt.example/video.mp4" class="tik-button-dl button dl-success">Download MP4 HD</a>`;
    return new Response(JSON.stringify({ status: "ok", data: html }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (u.hostname === "cdn.fake-tt.example" && u.pathname === "/video.mp4") {
    return new Response(VIDEO, { headers: { "content-type": "video/mp4", "content-length": String(VIDEO.length) } });
  }
  if (u.hostname === "cdn.fake-tt.example" && u.pathname === "/thumb.jpg") {
    return new Response(PNG, { headers: { "content-type": "image/png" } });
  }
  return new Response("not found", { status: 404 });
};
mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);

// ---------------------------------------------------------------- jalankan
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addInitScript(() => {
  localStorage.setItem("mori_hide_guide", "true");
  localStorage.setItem("mori_prefer_server", "server2"); // TikDownloader
});
// Browser sandbox tidak punya internet: blokir host luar (font Google, dll) agar cepat gagal
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
const page = await ctx.newPage();

const pageErrors = [];
const failedApi = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400) failedApi.push(`${r.status()} ${r.url()}`);
});

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

try {
  console.log("E2E Mori Web");
  await page.goto(base + "/");
  await page.waitForSelector("#urlInput");
  assert.equal(await page.evaluate(() => window.__MORI_WEB__), true);
  assert.equal(await page.evaluate(() => typeof window.MoriMainBridge.httpRequestAsync), "function");
  ok("halaman termuat, mode web & bridge HTTP aktif");

  assert.equal(await page.isVisible('.nav-item[data-page="gallery"]'), false);
  ok("menu Galeri (native-only) tersembunyi");

  await page.fill("#urlInput", "https://www.tiktok.com/@mori/video/7234567890123456789");
  await page.click("#downloadBtn");
  await page.waitForSelector("#resultSection:not(.hidden)", { timeout: 15000 });
  ok("analisis link selesai, hasil tampil");

  const title = await page.textContent("#resultTitle");
  assert.match(title, /Video Uji Mori/);
  const items = await page.locator("#downloadList .dl-item:not(.dl-all-btn)").count();
  assert.ok(items >= 1, "harus ada tombol download");
  ok(`judul "${title.trim()}" & ${items} opsi download`);

  const scrape = calls.find((c) => c.url.includes("tikdownloader.io/api/ajaxSearch"));
  assert.ok(scrape, "scraper harus memanggil penyedia lewat /api/http");
  assert.equal(scrape.method, "POST");
  assert.match(String(scrape.body), /q=https%3A%2F%2Fwww\.tiktok\.com/);
  ok("scraper memanggil penyedia lewat proxy /api/http (POST + body form benar)");

  // Hasil video: thumbnail dipakai sebagai poster <video>. Host CDN palsu tidak bisa dijangkau
  // browser (diblokir), jadi poster harus jatuh ke proxy /api/dl?inline=1.
  await page.waitForFunction(() => (document.querySelector("#slidesWrapper video")?.poster || "").includes("/api/dl"), null, { timeout: 15000 });
  assert.ok(calls.some((c) => c.url.includes("cdn.fake-tt.example/thumb.jpg")));
  ok("poster/thumbnail termuat lewat fallback proxy /api/dl?inline=1");

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.locator("#downloadList .dl-item:not(.dl-all-btn)").first().click(),
  ]);
  const path = await download.path();
  const { size } = await import("node:fs").then((fs) => fs.statSync(path));
  assert.match(download.suggestedFilename(), /\.mp4$/);
  assert.equal(size, VIDEO.length);
  ok(`file terunduh: ${download.suggestedFilename()} (${size} byte, utuh)`);

  const dl = calls.find((c) => c.url.includes("/video.mp4"));
  assert.ok(dl, "CDN harus dipanggil lewat /api/dl");
  ok("media diambil dari CDN lewat proxy streaming /api/dl");

  // ---- Riwayat & Pengaturan ----
  await page.click('.nav-item[data-page="history"]');
  await page.waitForSelector("#historyPage:not(.hidden)");
  await page.waitForFunction(() => document.querySelector("#historyPage")?.textContent.includes("Video Uji Mori"), null, { timeout: 5000 });
  ok("halaman Riwayat memuat entri hasil analisis");

  await page.click('.nav-item[data-page="settings"]');
  await page.waitForSelector("#settingsPage:not(.hidden)");
  const menus = await page.locator(".settings-menu-item").evaluateAll((els) => els.map((e) => e.dataset.target));
  assert.ok(menus.length >= 5, "menu pengaturan harus ada: " + menus);
  const hiddenIds = ["changePathBtn", "changeMusicPathBtn", "allFilesAccessItem", "autoFolderToggle", "overwriteSelect",
    "clearCacheBtn", "showGalleryToggle", "forceIpv4Toggle", "bypassSslToggle", "dohSelect", "wifiOnlyToggle",
    "checkUpdateBtn", "checkScraperUpdateBtn", "autoUpdateToggle"];
  for (const target of menus) {
    await page.click(`.settings-menu-item[data-target="${target}"]`);
    await page.waitForSelector(`#${target}:not(.hidden)`);
    for (const id of hiddenIds) {
      const el = page.locator(`#${id}`);
      if (await el.count()) {
        const item = el.first().locator("xpath=ancestor-or-self::*[contains(@class,'settings-item')][1]");
        assert.equal(await item.isVisible(), false, `#${id} seharusnya tersembunyi di web`);
      }
    }
    await page.click(`#${target} .back-btn-settings`);
  }
  ok(`${menus.length} sub-halaman pengaturan terbuka; ${hiddenIds.length} fitur native-only tersembunyi`);

  // Toggle yang masih relevan tetap berfungsi (nama file: pilih template)
  assert.equal(await page.evaluate(() => localStorage.getItem("mori_show_gallery")), "false");
  ok("setting paksa-web (galeri off) tersimpan");

  assert.deepEqual(pageErrors, [], "tidak boleh ada exception JS: " + pageErrors.join(" | "));
  assert.deepEqual(failedApi, [], "tidak boleh ada API 4xx/5xx: " + failedApi.join(" | "));
  ok("tidak ada error JS maupun API gagal");
  console.log("\nSEMUA LULUS");
} catch (err) {
  console.error("\nGAGAL:", err.message);
  console.error("pageErrors:", pageErrors, "failedApi:", failedApi);
  await page.screenshot({ path: "/tmp/e2e-fail.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

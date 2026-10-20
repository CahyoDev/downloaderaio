// webDownload.js — pengganti plugin Filesystem/Tauri untuk versi website.
// Alur: fetch("/api/dl?...") (stream lewat server) -> baca progres -> Blob -> <a download>.

import { buildDownloadHeaders } from "../downloader/headers.js";

const web = () => window.__moriWeb;

/** URL proxy untuk preview inline (gambar/video) yang butuh Referer tertentu. */
export function inlineProxyUrl(mediaUrl) {
  const h = buildDownloadHeaders(mediaUrl, "", mediaUrl);
  return web().dlUrl(mediaUrl, {
    inline: true,
    ref: h["Referer"],
    origin: h["Origin"],
    ua: h["User-Agent"],
  });
}

function triggerBrowserDownload(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(href);
    a.remove();
  }, 60_000);
}

async function readError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j && j.error) msg = j.error;
  } catch (_) {
    /* bukan JSON */
  }
  return msg;
}

async function downloadOnce({ actualDownloadUrl, fileName, downloadHeaders, onProgress, checkCancelled }) {
  const controller = new AbortController();
  const poll = setInterval(() => {
    if (checkCancelled()) controller.abort();
  }, 250);

  try {
    const endpoint = web().dlUrl(actualDownloadUrl, {
      name: fileName,
      ref: downloadHeaders?.["Referer"],
      origin: downloadHeaders?.["Origin"],
      ua: downloadHeaders?.["User-Agent"],
    });
    const doFetch = () => fetch(endpoint, { headers: web().authHeaders(), signal: controller.signal });
    let res = await doFetch();
    if (res.status === 401 && web().askToken()) res = await doFetch();
    if (!res.ok) {
      const err = new Error(await readError(res));
      err.noRetry = true; // kesalahan dari server/CDN, bukan jaringan: percuma diulang
      throw err;
    }

    const total = Number(res.headers.get("content-length")) || 0;
    const type = res.headers.get("content-type") || "application/octet-stream";
    let blob;

    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total && onProgress) onProgress(Math.round((loaded / total) * 100));
      }
      blob = new Blob(chunks, { type });
    } else {
      blob = await res.blob();
    }

    if (checkCancelled()) return { savedFile: null, successfulDir: "WEB", cancelled: true };
    if (blob.size === 0) {
      const err = new Error("File kosong dari server media");
      err.noRetry = true;
      throw err;
    }
    triggerBrowserDownload(blob, fileName);
    return { savedFile: { path: fileName, uri: "" }, successfulDir: "WEB", cancelled: false };
  } catch (err) {
    if (checkCancelled()) return { savedFile: null, successfulDir: "WEB", cancelled: true };
    throw err;
  } finally {
    clearInterval(poll);
  }
}

/**
 * Pengganti saveToStorage() untuk browser. Mengembalikan bentuk hasil yang sama:
 * { savedFile, successfulDir, cancelled }.
 */
export async function webSaveFile(opts) {
  const autoRetry = localStorage.getItem("mori_auto_retry") !== "false";
  const maxAttempts = autoRetry ? Math.max(1, parseInt(localStorage.getItem("mori_max_retry") || "3", 10) || 3) : 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await downloadOnce(opts);
    } catch (err) {
      lastErr = err;
      if (err.noRetry || opts.checkCancelled()) break;
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr || new Error("Download failed");
}

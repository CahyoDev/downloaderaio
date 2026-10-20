// webMode.js — merapikan UI untuk versi website.
// Fitur yang bergantung pada perangkat (folder, galeri lokal, biometrik, update APK, bypass SSL…)
// tidak punya padanan di browser, jadi disembunyikan agar tidak membingungkan.

const NATIVE_ONLY_ITEM_IDS = [
  // Storage
  "allFilesAccessItem", "changePathBtn", "changeMusicPathBtn", "autoFolderToggle",
  "overwriteSelect", "autoDownloadToggle", "storageSizeVal", "clearCacheBtn",
  // Appearance
  "showGalleryToggle",
  // Network (semua request kini lewat server, jadi opsi level-socket tidak berlaku)
  "forceIpv4Toggle", "bypassSslToggle", "dohSelect", "wifiOnlyToggle", "cellularWarningToggle",
  // About / update (versi web diperbarui lewat deploy ulang)
  "autoUpdateToggle", "checkUpdateBtn", "checkScraperUpdateBtn",
];

function hide(el) {
  if (el) el.style.setProperty("display", "none", "important");
}

export function applyWebMode() {
  document.documentElement.classList.add("is-web");

  NATIVE_ONLY_ITEM_IDS.forEach((id) => {
    const el = document.getElementById(id);
    hide(el && (el.closest(".settings-item") || el));
  });

  // Galeri menampilkan file di perangkat -> tidak ada di web
  document.querySelectorAll('.nav-item[data-page="gallery"]').forEach(hide);
  // Biometrik butuh plugin native; PIN tetap tersedia
  document.querySelectorAll('#lockTypeMenu [data-value="biometric"]').forEach(hide);
}

// Toast Notifications & Download Progress Toast UI

import { translations, t } from "../i18n/index.js";
import { triggerHaptic } from "./device.js";

export let currentLang = "en";
export function setUtilsState(state) {
  if (state.currentLang) currentLang = state.currentLang;
}

export function autoClearInputBox() {
  if (localStorage.getItem("mori_auto_clear_input") === "true") {
    const urlInput = document.getElementById("urlInput");
    const batchUrlInput = document.getElementById("batchUrlInput");
    const clearBtn = document.getElementById("clearBtn");
    const pasteBtn = document.getElementById("pasteBtn");
    if (urlInput) {
      urlInput.value = "";
      urlInput.dispatchEvent(new Event("input"));
    }
    if (batchUrlInput) {
      batchUrlInput.value = "";
      batchUrlInput.dispatchEvent(new Event("input"));
    }
    if (clearBtn) clearBtn.classList.add("hidden");
    if (pasteBtn) pasteBtn.classList.remove("hidden");
  }
}

// Toast Function
export async function showToast(message) {
  if (
    message &&
    (message.includes("Saved to") ||
      message.includes("Tersimpan di") ||
      message.includes("保存されました"))
  ) {
    return;
  }
  console.log("[TOAST]", message);
  triggerHaptic("light");

  const existingToasts = document.querySelectorAll(".custom-toast");
  existingToasts.forEach((t) => t.remove());

  const toastEl = document.createElement("div");
  toastEl.className = "custom-toast";
  toastEl.textContent = message;
  document.body.appendChild(toastEl);

  requestAnimationFrame(() => {
    toastEl.classList.add("show");
  });

  const durSec = parseInt(localStorage.getItem("mori_toast_dur") || "3", 10);
  const durMs = durSec * 1000;
  setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => toastEl.remove(), 300);
  }, durMs);
}

// ponytail: Floating progress toast removed in favor of downloadBubble manager
export function showDownloadProgressToast() {}
export function updateDownloadProgressToast() {}
export function completeDownloadProgressToast() {}
export function failDownloadProgressToast() {}
export function cancelDownloadProgressToast() {}
export function hideDownloadProgressToast() {}

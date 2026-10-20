// Filename, extension, and subfolder resolution utilities

export function resolveExtension(type, url) {
  const isAudio = /mp3|audio|128k|48k|m4a|wav|flac/i.test(type);
  const isImage =
    /image|photo|jpg|jpeg|png|webp/i.test(type) ||
    /\.(jpg|jpeg|png|webp)/i.test(url);
  let ext = isAudio ? "mp3" : isImage ? "jpg" : "mp4";
  const typeStr = (type || "").toLowerCase();
  const urlLower = (url || "").toLowerCase();

  if (/\.png(\?|$)/i.test(urlLower) || typeStr.includes("png")) ext = "png";
  else if (/\.webp(\?|$)/i.test(urlLower) || typeStr.includes("webp"))
    ext = "webp";
  else if (/\.m4a(\?|$)/i.test(urlLower) || typeStr.includes("m4a")) ext = "m4a";
  else if (/\.mp3(\?|$)/i.test(urlLower) || typeStr.includes("mp3")) ext = "mp3";
  else if (
    /\.jpe?g(\?|$)/i.test(urlLower) ||
    typeStr.includes("jpg") ||
    typeStr.includes("jpeg")
  )
    ext = "jpg";
  else if (
    /\.mp4(\?|$)/i.test(urlLower) ||
    typeStr.includes("video") ||
    typeStr.includes("mp4") ||
    /\d+p/i.test(typeStr)
  )
    ext = "mp4";

  const knownExt = (typeStr || urlLower).match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (knownExt) {
    const c = knownExt[1].toLowerCase();
    if (
      !["html", "htm", "php", "asp", "aspx", "jsp", "com", "net", "org"].includes(
        c,
      )
    ) {
      ext = c;
    }
  }

  return ext.toLowerCase();
}

export function sanitizeTitle(title, type) {
  const cleanTypeLabel = (type || "")
    .replace(/\s*\[(MP3|MP4|JPG|PNG|WEBP)\]/gi, "")
    .trim();
  const isTrackType = /^\d+\.\s+/.test(cleanTypeLabel);

  let effectiveTitle = title || "Mori Media";
  if (isTrackType) {
    effectiveTitle =
      cleanTypeLabel.replace(/^\d+\.\s+/, "").trim() || cleanTypeLabel;
  }

  let sanitized = effectiveTitle
    .replace(/[\\/:*?"<>|#%&{}[\]@$^+=~`';,]/g, "")
    .replace(/[^\w\s\-.\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/gi, "")
    .trim()
    .replace(/\s+/g, " ")
    .substring(0, 60);

  return sanitized || "Mori_Media";
}

export function generateFileName(sanitizedTitle, ext, sourceUrl, url) {
  const template = localStorage.getItem("mori_filename") || "title";
  const cleanTitle = sanitizedTitle.toLowerCase().endsWith("." + ext.toLowerCase())
    ? sanitizedTitle.slice(0, -(ext.length + 1))
    : sanitizedTitle;
  let fileName = `${cleanTitle}.${ext}`;

  if (template === "title-platform") {
    let platform = "Media";
    const lowerUrl = (sourceUrl || url || "").toLowerCase();
    if (lowerUrl.includes("tiktok") || lowerUrl.includes("douyin"))
      platform = "TikTok";
    else if (lowerUrl.includes("instagram")) platform = "Instagram";
    else if (lowerUrl.includes("youtube") || lowerUrl.includes("youtu.be"))
      platform = "YouTube";
    else if (
      lowerUrl.includes("twitter") ||
      /(?:^|[/.])x\.com(?:[/?#:]|$)/i.test(lowerUrl)
    )
      platform = "Twitter";
    else if (lowerUrl.includes("facebook")) platform = "Facebook";
    else if (lowerUrl.includes("pinterest")) platform = "Pinterest";
    else if (lowerUrl.includes("spotify")) platform = "Spotify";
    else if (lowerUrl.includes("rednote") || lowerUrl.includes("xiaohongshu"))
      platform = "RedNote";
    else if (lowerUrl.includes("reddit") || lowerUrl.includes("redd.it"))
      platform = "Reddit";
    else if (
      lowerUrl.includes("terabox") ||
      lowerUrl.includes("1024tera") ||
      lowerUrl.includes("nephobox") ||
      lowerUrl.includes("4funbox") ||
      lowerUrl.includes("mirrobox") ||
      lowerUrl.includes("momerybox") ||
      lowerUrl.includes("tibibox")
    )
      platform = "TeraBox";
    fileName = `${cleanTitle}_${platform}.${ext}`;
  } else if (template === "title-date") {
    const dateStr = new Date().toISOString().split("T")[0];
    fileName = `${cleanTitle}_${dateStr}.${ext}`;
  } else if (template === "title") {
    fileName = `${cleanTitle}.${ext}`;
  } else {
    // default: Title_Timestamp
    fileName = `${cleanTitle}_${Date.now()}.${ext}`;
  }

  // Ensure file extension is strictly lowercase for broad device compatibility
  const dotPos = fileName.lastIndexOf(".");
  if (dotPos > 0 && dotPos < fileName.length - 1) {
    fileName =
      fileName.substring(0, dotPos) +
      "." +
      fileName.substring(dotPos + 1).toLowerCase();
  }

  return fileName;
}

export function detectPlatformFolder(sourceUrl, url) {
  const src = (sourceUrl || url || "").toLowerCase();
  if (
    src.includes("tiktok") ||
    src.includes("douyin") ||
    src.includes("iesdouyin")
  )
    return "TikTok";
  if (src.includes("instagram") || src.includes("instagr.am"))
    return "Instagram";
  if (src.includes("youtube") || src.includes("youtu.be")) return "YouTube";
  if (
    src.includes("twitter") ||
    /(?:^|[/.])x\.com(?:[/?#:]|$)/i.test(src) ||
    /(?:^|[/.])t\.co(?:[/?#:]|$)/i.test(src)
  )
    return "Twitter";
  if (
    src.includes("facebook") ||
    src.includes("fb.watch") ||
    src.includes("fb.com")
  )
    return "Facebook";
  if (src.includes("pinterest") || src.includes("pin.it")) return "Pinterest";
  if (src.includes("spotify") || src.includes("spoti.fi")) return "Spotify";
  if (src.includes("music.apple.com") || src.includes("apple.com"))
    return "AppleMusic";
  if (src.includes("threads.net") || src.includes("threads.com"))
    return "Threads";
  if (
    src.includes("rednote") ||
    src.includes("xiaohongshu") ||
    src.includes("xhslink")
  )
    return "RedNote";
  if (
    src.includes("bilibili") ||
    src.includes("b23.tv") ||
    src.includes("bili.im")
  )
    return "Bilibili";
  if (src.includes("pixiv") || src.includes("pximg") || src.includes("pixiv.me"))
    return "Pixiv";
  if (src.includes("bandcamp") || src.includes("bandcamp.com"))
    return "Bandcamp";
  if (src.includes("reddit") || src.includes("redd.it")) return "Reddit";
  if (
    src.includes("terabox") ||
    src.includes("1024tera") ||
    src.includes("nephobox") ||
    src.includes("4funbox") ||
    src.includes("mirrobox") ||
    src.includes("momerybox") ||
    src.includes("tibibox")
  )
    return "TeraBox";

  return "Other";
}

export async function resolveUniqueFileName(
  fullPath,
  fileName,
  ext,
  directoriesToTry,
  Filesystem,
  btn,
) {
  const overwriteMode = localStorage.getItem("mori_overwrite") || "rename";

  try {
    let checkExist = null;
    for (const dir of directoriesToTry) {
      checkExist = await Filesystem.stat({
        path: fullPath + "/" + fileName,
        directory: dir,
      }).catch(() => null);
      if (checkExist) break;
    }

    if (checkExist) {
      if (overwriteMode === "skip") {
        if (btn) {
          const b = btn.querySelector(".dl-badge");
          if (b) b.textContent = "SAVED";
        }
        return {
          skipped: true,
          fileName,
          path: fullPath + "/" + fileName,
        };
      } else if (overwriteMode === "overwrite") {
        // Overwrite: keep same filename
        return { skipped: false, fileName };
      } else {
        // rename (default): append _1, _2, etc.
        const dotIdx = fileName.lastIndexOf(".");
        const baseName =
          dotIdx !== -1 ? fileName.substring(0, dotIdx) : fileName;
        let counter = 1;
        let newFileName = `${baseName}_${counter}.${ext.toLowerCase()}`;
        while (true) {
          let exist = null;
          for (const dir of directoriesToTry) {
            exist = await Filesystem.stat({
              path: fullPath + "/" + newFileName,
              directory: dir,
            }).catch(() => null);
            if (exist) break;
          }
          if (!exist) {
            return { skipped: false, fileName: newFileName };
          }
          counter++;
          newFileName = `${baseName}_${counter}.${ext.toLowerCase()}`;
        }
      }
    }
  } catch (_) {}

  return { skipped: false, fileName };
}

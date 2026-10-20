# Mori Web — versi website untuk Vercel

Port dari aplikasi **Mori / Downall** (Android · iOS · Desktop · CLI) menjadi **website** yang bisa
di-deploy ke Vercel. Tampilan dan scraper aslinya dipertahankan; yang diganti hanya lapisan
jaringan dan penyimpanan file yang sebelumnya bergantung pada plugin native.

## Cara kerja

```
Browser ──(UI + scraper bundle.js, tidak diubah)───────────────┐
   │                                                            │
   │ window.MoriMainBridge.httpRequestAsync  (js/web/boot.js)   │
   ▼                                                            │
POST /api/http ──► situs penyedia scraper (allowlist) ──► HTML/JSON dikembalikan
GET  /api/dl   ──► CDN media (stream, Referer/Origin diatur) ──► Blob ──► file terunduh
```

Browser tidak bisa memanggil situs penyedia scraper langsung (CORS, header `Cookie`/`Referer`
terlarang). Aplikasi asli menyelesaikannya dengan HTTP native; di web, tugas itu dipindah ke dua
fungsi serverless:

| Endpoint | Fungsi |
| --- | --- |
| `POST /api/http` | Menjalankan request scraper dari sisi server. Hanya host di allowlist, tiap redirect divalidasi, respons maks 3,5 MB. |
| `GET /api/dl` | Meneruskan (stream) file media dari CDN untuk download dan preview. Mendukung `Range`. |

## Struktur

```
public/            frontend statis (hasil port; js/web/* adalah tambahan baru)
api/http.js        proxy request scraper
api/dl.js          proxy streaming download/preview
api/_lib/guard.js  anti-SSRF, allowlist, token akses
scripts/dev-server.mjs   server lokal yang meniru Vercel
test/              tes otomatis (API + end-to-end browser)
vercel.json        konfigurasi (tanpa build step, tanpa dependency)
```

## Deploy ke Vercel

**Lewat GitHub (disarankan)**
1. Push folder ini ke repo GitHub.
2. Di Vercel: **Add New → Project →** pilih repo → **Deploy**. Tidak perlu mengubah apa pun:
   `vercel.json` sudah menyetel output `public/`, tanpa build command, dan fungsi di `api/`.

**Lewat CLI**
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # produksi
```

### Environment variable (opsional, Settings → Environment Variables)

| Nama | Default | Kegunaan |
| --- | --- | --- |
| `ACCESS_TOKEN` | *(kosong)* | Jika diisi, semua `/api/*` butuh token ini. Situs akan meminta token sekali dan menyimpannya di browser. **Sangat disarankan** untuk situs publik (lihat Keamanan). |
| `MAX_DOWNLOAD_MB` | `250` | Batas ukuran satu file. |
| `EXTRA_ALLOWED_HOSTS` | *(kosong)* | Tambah host scraper di luar bawaan, pisahkan koma: `a.com,b.net`. |

Setelah mengubah env, lakukan **Redeploy**.

## Jalankan lokal

```bash
npm run dev      # http://localhost:3000  (butuh Node 20+, tanpa npm install)
npm test         # 21 tes API (SSRF, allowlist, redirect, streaming, batas ukuran, token)

# uji end-to-end di Chromium (opsional)
npm i -D playwright && npx playwright install chromium
node test/e2e.mjs
```

## Yang berbeda dari aplikasi native

Fitur yang butuh perangkat tidak punya padanan di browser, jadi disembunyikan:
galeri file lokal, pemilih folder & "All Files Access", biometrik, Force IPv4 / bypass SSL / DoH,
mode Wi-Fi only, cek update APK, dan **OTA scraper**. OTA sengaja dimatikan: ia mengunduh JS dari
GitHub lalu mengeksekusinya, dan itu tidak pantas dilakukan di situs publik. Di web, scraper
diperbarui lewat deploy ulang.

File hasil download masuk ke folder Download browser. Riwayat tetap tersimpan di `localStorage`.

## Batasan yang perlu kamu tahu

- **Belum diuji dengan penyedia scraper sungguhan.** Pengembangan dilakukan tanpa akses internet,
  jadi alur diuji dengan penyedia dan CDN tiruan (analisis → proxy → download file utuh di
  Chromium), bukan dengan snapsave.app, tikdownloader.io, dll. secara langsung.
- **IP datacenter bisa diblokir.** Banyak situs penyedia berada di balik Cloudflare dan lebih
  sering menolak IP server (Vercel) dibanding IP rumah/seluler, yang dipakai aplikasi native.
  Gejalanya: pesan "blocked or rate-limited" / HTTP 403. Itu bukan bug kode; coba server lain di
  pengaturan, ganti region di `vercel.json` (`regions`), atau pakai VPS dengan IP residensial.
- **Fungsi Vercel bukan media server.** Download dialirkan lewat fungsi sehingga memakan bandwidth
  dan waktu eksekusi akun kamu (`maxDuration` 60 dtk untuk `/api/dl`; jika paketmu menolak
  nilainya, turunkan di `vercel.json`).
- **File ditampung di memori browser** sebelum disimpan (agar ada progres & pesan error), jadi
  file sangat besar berat di HP. Karena itu batas bawaannya 250 MB.
- "Download All" memicu banyak unduhan beruntun; Chrome bisa meminta izin sekali.
- `region` diset `sin1` (Singapura) supaya dekat dengan Indonesia.

## Keamanan

- Proxy memblokir IP privat/loopback/link-local/metadata cloud (IPv4 & IPv6, termasuk bentuk
  desimal/heks/mapped), memvalidasi **setiap** redirect, hanya `http/https` port umum, dan menolak
  respons HTML/JSON/SVG dari `/api/dl` agar domainmu tidak bisa dipakai menghosting halaman.
- `/api/http` hanya mengizinkan host di allowlist. `/api/dl` harus menerima host CDN apa pun,
  sehingga **tanpa `ACCESS_TOKEN` situs publikmu bisa dipakai orang lain sebagai proxy unduhan**
  dan menghabiskan kuota. Untuk pemakaian pribadi/tim, set `ACCESS_TOKEN`.
- Scraper SnapSave dalam `bundle.js` asli menjalankan `eval` atas respons situs pihak ketiga. Itu
  perilaku bawaan aplikasi, tetapi di web kodenya berjalan di origin-mu. Pertimbangkan itu sebelum
  membuka layanan ke publik.

## Legal

Berlisensi **GPL-3.0-or-later** (lihat `LICENSE`), turunan dari [coflyn/Mori](https://github.com/coflyn/Mori);
sertakan atribusi itu dan buka source jika kamu mendistribusikan versi modifikasi. Unduhlah hanya
konten yang kamu berhak simpan. Menjalankan layanan unduhan publik juga tunduk pada ketentuan
Vercel dan platform sumber, dan mengunduh musik berlisensi (Spotify/Apple Music) dapat melanggar
hak cipta di yurisdiksimu.

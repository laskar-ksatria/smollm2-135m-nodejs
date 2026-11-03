# Deploy Qwen2.5-0.5B MCQ API ke VPS

Panduan menjalankan layanan ini di VPS Linux (Ubuntu/Debian) tanpa Docker dan tanpa PM2. Proses dijaga oleh **systemd**, yang sudah ada di Ubuntu/Debian.

> **Penting:** `npm install` / `npm ci` **tidak** mengunduh model. Perintah itu hanya memasang library (termasuk binary llama.cpp). File model (`.gguf`, sekitar 676 MB) disimpan di folder `models/`, yang tidak masuk repo. Di VPS, model diunduh **sekali** dengan `npm run model:pull` (langkah 4).

---

## Ringkasan perintah

```bash
git clone https://github.com/laskar-ksatria/smollm2-135m-nodejs.git /opt/qwen-api
cd /opt/qwen-api
npm ci                    # pasang dependensi (tanpa model)
npm run build             # compile TypeScript ke dist/
npm run model:pull        # unduh model ~676 MB ke models/
cp .env.example .env      # konfigurasi
npm start                 # uji jalan, lalu Ctrl+C
# lalu pasang systemd (langkah 7)
```

---

## 1. Kebutuhan VPS

| | Minimal | Keterangan |
|---|---|---|
| OS | Ubuntu 22.04/24.04 atau Debian 12, x64 atau arm64 | Ada binary llama.cpp siap pakai untuk Linux x64 dan arm64, jadi tidak perlu compile |
| RAM | **2 GB** | Proses memakai sekitar **1,3 GB** setelah model dimuat (diukur dalam mode CPU) |
| Disk kosong | **1,5 GB** | Model 676 MB + `node_modules` sekitar 120–300 MB + ruang untuk update |
| CPU | 2 vCPU | Lebih banyak core = lebih cepat |
| GPU | Tidak perlu | Tanpa GPU otomatis memakai CPU |
| Internet | Hanya saat setup | Untuk `npm ci` dan mengunduh model. Setelah itu server berjalan offline |

**Perkiraan kecepatan.** Diukur dalam mode CPU di laptop Apple M5: sekitar 85 ms per soal dengan 4 thread dan 120 ms dengan 2 thread. vCPU di VPS biasanya lebih lambat, jadi perkirakan **ratusan milidetik per soal**. Ukur sendiri setelah deploy dengan melihat `latency_ms` (langkah 6).

---

## 2. Pasang Node.js 22 dan git

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v    # harus v20 atau lebih baru
```

---

## 3. Ambil kode dan pasang dependensi

```bash
sudo mkdir -p /opt/qwen-api
sudo chown "$USER":"$USER" /opt/qwen-api
git clone https://github.com/laskar-ksatria/smollm2-135m-nodejs.git /opt/qwen-api
cd /opt/qwen-api

npm ci
npm run build
```

- `npm ci` memasang versi yang persis sama dengan `package-lock.json`. Pastikan `package.json` dan `package-lock.json` sudah di-commit.
- Saat `npm ci`, node-llama-cpp memilih binary llama.cpp yang cocok untuk VPS (`@node-llama-cpp/linux-x64` atau `linux-arm64`). Biasanya tidak ada proses compile.
- Kalau muncul `A prebuilt binary was not found, falling back to building from source`, node-llama-cpp akan meng-compile llama.cpp sendiri. Proses ini butuh compiler C++ dan beberapa menit. Pasang compiler-nya, lalu ulangi:

  ```bash
  sudo apt-get install -y build-essential
  npm ci
  ```

---

## 4. Unduh model

```bash
npm run model:pull
ls -lh models/
# models/qwen2.5-0.5b-instruct-q8_0.gguf  sekitar 645M
```

Script ini menjalankan:

```bash
node-llama-cpp pull --dir ./models --filename qwen2.5-0.5b-instruct-q8_0.gguf \
  hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf
```

- Model berasal dari repo resmi Qwen di Hugging Face, lisensi Apache 2.0, **tidak gated**, jadi tidak perlu token atau login.
- Jika file sudah ada, download dilewati.

**Alternatif: kirim dari laptop.** Kalau VPS tidak bisa mengakses Hugging Face, salin file yang sudah ada di laptop:

```bash
# jalankan di laptop
scp models/qwen2.5-0.5b-instruct-q8_0.gguf user@IP-VPS:/opt/qwen-api/models/
```

Folder `models/` di VPS harus sudah ada (`mkdir -p /opt/qwen-api/models`).

---

## 5. Konfigurasi `.env`

```bash
cp .env.example .env
nano .env
```

| Variabel | Nilai | Keterangan |
|---|---|---|
| `PORT` | `3009` | Port HTTP |
| `MODELS_DIR` | `./models` | Folder model |
| `MODEL_URI` | `qwen2.5-0.5b-instruct-q8_0.gguf` | **Nama file** di `MODELS_DIR`, supaya server tidak menghubungi Hugging Face saat start |
| `MAX_TOKENS` | `32` | Panjang maksimal jawaban |
| `USE_GRAMMAR` | `true` | Jawaban selalu salah satu opsi, tidak pernah `null` |

`.env` tidak masuk repo (ada di `.gitignore`), jadi file ini dibuat langsung di VPS.

---

## 6. Uji jalan

```bash
npm start
```

Tunggu sampai muncul `[http] siap di http://localhost:3009`. Peringatan `control-looking token: 128247 '</s>' ...` saat model dimuat adalah pesan bawaan untuk file GGUF Qwen dan bisa diabaikan.

Dari terminal lain di VPS:

```bash
curl http://localhost:3009/health

curl -X POST http://localhost:3009/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"Who was the first person to walk on the Moon, in 1969?","options":{"a":"Neil Armstrong","b":"John Glenn","c":"Buzz Aldrin","d":"Yuri Gagarin"}}'
```

Ulangi request kedua beberapa kali dan lihat `latency_ms` untuk mengetahui kecepatan sebenarnya di VPS. Request pertama selalu lebih lambat karena pemanasan. Setelah itu hentikan dengan `Ctrl+C`.

---

## 7. Jalankan sebagai service (systemd)

systemd menjalankan server di background, menyalakannya lagi kalau crash, dan otomatis start saat VPS reboot.

Perintah di bawah mengisi user dan lokasi `node` secara otomatis:

```bash
sudo tee /etc/systemd/system/qwen-api.service > /dev/null <<EOF
[Unit]
Description=Qwen2.5-0.5B MCQ API
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=/opt/qwen-api
ExecStart=$(command -v node) --env-file=.env dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now qwen-api
```

Perintah sehari-hari:

```bash
systemctl status qwen-api          # status
journalctl -u qwen-api -f          # lihat log secara live
sudo systemctl restart qwen-api    # restart (mis. setelah mengubah .env)
sudo systemctl stop qwen-api       # hentikan
```

Server menangani sinyal `SIGTERM` dari systemd dan menutup model dengan rapi.

---

## 8. Keamanan: jangan buka port ke publik

Layanan ini **tidak punya autentikasi**, dan server mendengarkan di semua interface. Batasi aksesnya dengan firewall `ufw`:

```bash
sudo ufw allow OpenSSH       # jangan sampai terkunci dari SSH
sudo ufw enable
```

Lalu pilih salah satu:

- **Aplikasi pemanggil ada di VPS yang sama:** jangan buka port 3009. Aplikasi memanggil `http://localhost:3009`.
- **Aplikasi pemanggil di server lain:** izinkan hanya IP server itu.

  ```bash
  sudo ufw allow from IP-SERVER-APLIKASI to any port 3009 proto tcp
  ```

Cek dengan `sudo ufw status`. Kalau layanan harus diakses dari internet, letakkan reverse proxy (misalnya nginx) dengan API key atau autentikasi di depannya.

---

## 9. Update ke versi baru

```bash
cd /opt/qwen-api
git pull
npm ci
npm run build
sudo systemctl restart qwen-api
```

Model **tidak perlu** diunduh ulang, kecuali Anda mengganti model.

---

## 10. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `No model file found at ...` | Model belum diunduh, atau nama di `.env` berbeda | `npm run model:pull`, lalu cek `ls models/` dan `MODEL_URI` di `.env` |
| `node: .env: not found` | `.env` belum dibuat | `cp .env.example .env` |
| `npm ci` gagal saat compile llama.cpp | Tidak ada compiler C++ | `sudo apt-get install -y build-essential`, lalu `npm ci` lagi |
| Service mati sendiri, log berhenti tiba-tiba | RAM habis (proses dimatikan sistem) | Cek `sudo dmesg \| grep -i -E "killed\|oom"`. Tambah swap atau naikkan RAM VPS |
| `EADDRINUSE` | Port 3009 dipakai proses lain | Ganti `PORT` di `.env`, lalu restart |
| Server menghubungi Hugging Face saat start | `MODEL_URI` masih berbentuk `hf:...` | Pakai nama file seperti di `.env.example` |
| Banyak `503` | Antrean penuh | Naikkan `MAX_QUEUE` di `.env`, atau jalankan instance tambahan |
| Lambat | vCPU sedikit/lambat | Pakai VPS dengan core lebih banyak. Q4_K_M (491 MB) sedikit lebih cepat, tapi kualitasnya bisa turun |

**Menambah swap 2 GB** (jika RAM VPS pas-pasan):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

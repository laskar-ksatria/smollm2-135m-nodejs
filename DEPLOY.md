# Deploy LFM2-350M MCQ API ke VPS

Panduan menjalankan layanan ini di VPS Linux (Ubuntu/Debian) tanpa Docker dan tanpa PM2. Proses dijaga oleh **systemd**, yang sudah ada di Ubuntu/Debian.

> **Penting:** `npm install` / `npm ci` **tidak** mengunduh model. Perintah itu hanya memasang library, termasuk binary llama.cpp. File model (`.gguf`, 379 MB) disimpan di folder `models/`, yang tidak masuk repo. Di VPS, model diunduh **sekali** dengan `npm run model:pull` (langkah 4).

---

## Ringkasan perintah

```bash
git clone -b lfm2-350m https://github.com/laskar-ksatria/smollm2-135m-nodejs.git /opt/lfm2-api
cd /opt/lfm2-api
npm ci                    # pasang dependensi (tanpa model)
npm run build             # compile TypeScript ke dist/
npm run model:pull        # unduh model 379 MB ke models/
cp .env.example .env      # konfigurasi, lalu isi THREADS = jumlah vCPU
npm start                 # uji jalan, lalu Ctrl+C
# lalu pasang systemd (langkah 7)
```

---

## 1. Kebutuhan VPS

| | Minimal | Keterangan |
|---|---|---|
| OS | Ubuntu 22.04/24.04 atau Debian 12, x64 atau arm64 | Ada binary llama.cpp siap pakai untuk Linux x64 dan arm64, jadi biasanya tidak perlu compile |
| RAM | **2 GB** | Proses memakai sekitar **650 MB** setelah model dimuat (diukur di Mac). Ukur ulang di VPS |
| Disk kosong | **1 GB** | Model 379 MB + `node_modules` sekitar 120 MB + ruang untuk update |
| CPU | 2 vCPU, sebaiknya dengan AVX2 | Tanpa AVX2, llama.cpp jauh lebih lambat |
| GPU | Tidak perlu | Tanpa GPU otomatis memakai CPU |
| Internet | Hanya saat setup | Untuk `npm ci` dan mengunduh model. Setelah itu server berjalan offline |

---

## 2. Pasang Node.js 22 dan git

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v    # harus v20 atau lebih baru
```

---

## 3. Ambil kode dan pasang dependensi

Kode LFM2 ada di branch **`lfm2-350m`**.

```bash
sudo mkdir -p /opt/lfm2-api
sudo chown "$USER":"$USER" /opt/lfm2-api
git clone -b lfm2-350m https://github.com/laskar-ksatria/smollm2-135m-nodejs.git /opt/lfm2-api
cd /opt/lfm2-api

npm ci
npm run build
```

- `npm ci` memasang versi yang persis sama dengan `package-lock.json`.
- Saat `npm ci`, node-llama-cpp memilih binary llama.cpp yang cocok untuk VPS (`@node-llama-cpp/linux-x64` atau `linux-arm64`). Biasanya tidak ada proses compile.
- Kalau muncul `A prebuilt binary was not found, falling back to building from source`, node-llama-cpp akan meng-compile llama.cpp sendiri. Proses ini butuh compiler C++ dan beberapa menit. Pasang compiler-nya, lalu ulangi:

  ```bash
  sudo apt-get install -y build-essential
  npm ci
  ```

---

## 4. Unduh model

### Cara utama: `npm run model:pull`

```bash
npm run model:pull
ls -l models/
# models/lfm2-350m-q8_0.gguf  379214784 byte (379 MB)
```

Script ini menjalankan:

```bash
node-llama-cpp pull --dir ./models --filename lfm2-350m-q8_0.gguf \
  hf:LiquidAI/LFM2-350M-GGUF/LFM2-350M-Q8_0.gguf
```

| | |
|---|---|
| Sumber | Repo resmi Liquid AI di Hugging Face: [`LiquidAI/LFM2-350M-GGUF`](https://huggingface.co/LiquidAI/LFM2-350M-GGUF) |
| File asli | `LFM2-350M-Q8_0.gguf`, disimpan dengan nama `lfm2-350m-q8_0.gguf` |
| Ukuran | 379.214.784 byte |
| SHA-256 | `b7bfeab6495a1ae3ae78811c1297df9f301b35261ff9580d42fb30dc4dc9034b` |
| Akses | **Tidak gated**, jadi tidak perlu token atau login Hugging Face |

- Jika file sudah ada, download dilewati.
- Nama file di `models/` harus sama dengan `MODEL_URI` di `.env` (`lfm2-350m-q8_0.gguf`).

### Alternatif 1: unduh langsung dengan `curl`

Cara ini berguna kalau `npm run model:pull` gagal, misalnya karena proxy.

```bash
mkdir -p models
curl -L --fail -o models/lfm2-350m-q8_0.gguf \
  https://huggingface.co/LiquidAI/LFM2-350M-GGUF/resolve/main/LFM2-350M-Q8_0.gguf
```

### Alternatif 2: kirim dari komputer lain

Kalau VPS tidak bisa mengakses Hugging Face, unduh di laptop, lalu salin ke VPS:

```bash
# jalankan di laptop
ssh user@IP-VPS "mkdir -p /opt/lfm2-api/models"
scp models/lfm2-350m-q8_0.gguf user@IP-VPS:/opt/lfm2-api/models/
```

### Cek file model

```bash
sha256sum models/lfm2-350m-q8_0.gguf
# harus: b7bfeab6495a1ae3ae78811c1297df9f301b35261ff9580d42fb30dc4dc9034b
```

Kalau hasilnya berbeda, file rusak atau tidak lengkap. Hapus file itu, lalu unduh ulang.

### Lisensi model

LFM2-350M memakai **LFM Open License v1.0**. Pemakaian komersial diizinkan **selama pendapatan tahunan entitas Anda di bawah USD 10 juta**. Layanan ini hanya menjalankan model di server Anda, tidak menyebarkannya. Rangkuman lengkapnya ada di `requirement.md`, dan teks aslinya di [halaman lisensi](https://huggingface.co/LiquidAI/LFM2-350M/blob/main/LICENSE).

---

## 5. Konfigurasi `.env`

```bash
cp .env.example .env
nproc       # jumlah vCPU, isi THREADS dengan angka ini
nano .env
```

| Variabel | Nilai | Keterangan |
|---|---|---|
| `PORT` | `3009` | Port HTTP |
| `MODELS_DIR` | `./models` | Folder model |
| `MODEL_URI` | `lfm2-350m-q8_0.gguf` | **Nama file** di `MODELS_DIR`, supaya server tidak menghubungi Hugging Face saat start |
| `THREADS` | `2` | **Sama dengan jumlah vCPU** (`nproc`). Jangan lebih, karena justru melambat |
| `ANSWER_MODE` | `letter` | `letter` = model menulis 1 huruf (cepat). `full` = `huruf) teks` |
| `USE_GRAMMAR` | `true` | Jawaban selalu salah satu opsi, tidak pernah `null` |
| `TEMPERATURE` | `2` | `0` = soal yang sama selalu dapat jawaban yang sama. Lebih dari `0` = jawaban bisa berbeda tiap request; makin tinggi makin acak. Default di kode `0` jika tidak diisi |
| `MAX_TOKENS` | `32` | Panjang maksimal jawaban |

`.env` tidak masuk repo (ada di `.gitignore`), jadi file ini dibuat langsung di VPS. Setelah mengubah `.env`, cukup restart. Tidak perlu build ulang.

---

## 6. Uji jalan

```bash
npm start
```

Tunggu sampai log menampilkan:

```
[init] model siap: /opt/lfm2-api/models/lfm2-350m-q8_0.gguf | threads: 2 | mode: letter
[init] pemanasan selesai dalam ... ms
[http] siap di http://localhost:3009
```

Dari terminal lain di VPS:

```bash
curl http://localhost:3009/health

# Tanpa kunci jawaban
curl -X POST http://localhost:3009/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"Who was the first person to walk on the Moon, in 1969?","options":{"a":"Neil Armstrong","b":"John Glenn","c":"Buzz Aldrin","d":"Yuri Gagarin"}}'

# Dengan kunci jawaban
curl -X POST http://localhost:3009/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"Who was the first person to walk on the Moon, in 1969?","options":{"a":"Neil Armstrong","b":"John Glenn","c":"Buzz Aldrin","d":"Yuri Gagarin"},"answer_key":"a"}'
```

Ulangi request beberapa kali dan lihat `latency_ms` untuk mengetahui kecepatan sebenarnya di VPS. Setelah itu hentikan server dengan `Ctrl+C`.

---

## 7. Jalankan sebagai service (systemd)

systemd menjalankan server di background, menyalakannya lagi kalau crash, dan otomatis start saat VPS reboot.

Perintah di bawah mengisi user dan lokasi `node` secara otomatis:

```bash
sudo tee /etc/systemd/system/lfm2-api.service > /dev/null <<EOF
[Unit]
Description=LFM2-350M MCQ API
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=/opt/lfm2-api
ExecStart=$(command -v node) --env-file=.env dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now lfm2-api
```

Perintah sehari-hari:

```bash
systemctl status lfm2-api          # status dan pemakaian RAM (baris Memory:)
journalctl -u lfm2-api -f          # lihat log secara live
sudo systemctl restart lfm2-api    # restart (mis. setelah mengubah .env)
sudo systemctl stop lfm2-api       # hentikan
```

**Pindah dari layanan lain di port yang sama?** Matikan layanan lama dulu supaya port 3009 tidak bentrok:

```bash
sudo systemctl disable --now qwen-api      # jika sebelumnya memakai Qwen
sudo systemctl disable --now granite-api   # jika sebelumnya memakai Granite
```

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

Cek dengan `sudo ufw status`. Kalau layanan harus diakses dari internet, letakkan reverse proxy (misalnya nginx) dengan API key di depannya.

---

## 9. Update ke versi baru

```bash
cd /opt/lfm2-api
git pull
npm ci
npm run build
sudo systemctl restart lfm2-api
```

Model **tidak perlu** diunduh ulang, kecuali Anda mengganti model.

**Ganti ke Q4_K_M (229 MB, lebih hemat RAM):**

```bash
npx node-llama-cpp pull --dir ./models --filename lfm2-350m-q4_k_m.gguf \
  hf:LiquidAI/LFM2-350M-GGUF/LFM2-350M-Q4_K_M.gguf
```

Lalu ubah `.env` menjadi `MODEL_URI=lfm2-350m-q4_k_m.gguf` dan restart. Model kecil lebih rapuh terhadap kuantisasi 4-bit, jadi bandingkan dulu hasilnya pada soal yang sama sebelum berpindah.

---

## 10. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `No model file found at ...` | Model belum diunduh, atau nama di `.env` berbeda | `npm run model:pull`, lalu cek `ls models/` dan `MODEL_URI` di `.env` |
| `node: .env: not found` | `.env` belum dibuat | `cp .env.example .env` |
| `npm ci` gagal saat compile llama.cpp | Tidak ada compiler C++ | `sudo apt-get install -y build-essential`, lalu `npm ci` lagi |
| Error `unknown model architecture` | node-llama-cpp terlalu lama | Pastikan node-llama-cpp 3.22 atau lebih baru (`npm ls node-llama-cpp`) |
| Error saat memuat model / file rusak | Unduhan terputus | Cek `sha256sum` (langkah 4), hapus file, unduh ulang |
| Server menghubungi Hugging Face saat start | `MODEL_URI` masih berbentuk `hf:...` | Pakai nama file seperti di `.env.example` |
| `EADDRINUSE` | Port 3009 dipakai proses lain | Matikan layanan lama (langkah 7) atau ganti `PORT` |
| Service mati sendiri, log berhenti tiba-tiba | RAM habis (proses dimatikan sistem) | Cek `sudo dmesg \| grep -i -E "killed\|oom"`. Tambah swap, pakai Q4_K_M, atau naikkan RAM |
| Lambat | `THREADS` lebih dari jumlah vCPU, swap, atau CPU tanpa AVX2 | Samakan `THREADS` dengan `nproc`. Cek `vmstat 1` (kolom `si`/`so` harus 0) dan `lscpu \| grep -o avx2` |
| Banyak `503` | Antrean penuh | Naikkan `MAX_QUEUE` di `.env`, atau jalankan instance tambahan |

**Menambah swap 2 GB** (jika RAM VPS pas-pasan):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

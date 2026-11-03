# Granite 4.0 H 350M API Service

Layanan HTTP (Node.js + TypeScript) yang menjalankan **IBM Granite 4.0 H 350M** (format GGUF, Q8_0) di **CPU** untuk menjawab soal pilihan ganda. Service lain mengirim `question` dan `options` (opsional `answer_key`), lalu menerima huruf jawabannya.

> **Analogi:** Layanan ini seperti dapur restoran. Model adalah koki yang tinggal di dapur (server). Aplikasi lain adalah pelanggan yang memesan lewat pelayan (HTTP API), lalu jawabannya diantar kembali.

```
Aplikasi / service lain ──POST /ask──> Granite API (node-llama-cpp + GGUF) ──> { "answer": "c" }
```

| | |
|---|---|
| Model | `ibm-granite/granite-4.0-h-350m`, GGUF resmi dari IBM: `ibm-granite/granite-4.0-h-350m-GGUF` |
| File | `granite-4.0-h-350m-Q8_0.gguf`, 366 MB (alternatif `Q4_K_M`, 223 MB) |
| Lisensi | **Apache 2.0**, bebas dipakai komersial, tidak gated |
| Arsitektur | Hybrid: 28 lapis Mamba2 + 4 lapis attention, sekitar 340 juta parameter |
| Runtime | Node.js 20+ dengan node-llama-cpp 3.22+ (arsitektur `granitehybrid` sudah didukung) |
| Target server | VPS 2 GB RAM, 2 vCPU, tanpa GPU |
| Port | `3009` |

> **Kenapa hybrid Mamba cocok untuk CPU?** Lapisan attention biasa harus "melihat ulang" seluruh teks sebelumnya setiap kali menulis kata baru. Lapisan Mamba cukup membawa ringkasan pendek, seperti orang yang mencatat poin penting alih-alih membaca ulang seluruh buku. Karena itu memorinya kecil dan kecepatannya stabil.

---

## Daftar isi

1. [Spesifikasi API](#1-spesifikasi-api)
2. [Cara kerja di balik layar](#2-cara-kerja-di-balik-layar)
3. [Struktur proyek](#3-struktur-proyek)
4. [Setup](#4-setup)
5. [Kode](#5-kode)
6. [Menjalankan di lokal](#6-menjalankan-di-lokal)
7. [Deploy ke VPS (systemd)](#7-deploy-ke-vps-systemd)
8. [Konfigurasi](#8-konfigurasi)
9. [Contoh memanggil dari service lain](#9-contoh-memanggil-dari-service-lain)
10. [Performa di VPS 2 GB](#10-performa-di-vps-2-gb)
11. [Keamanan](#11-keamanan)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Spesifikasi API

### `POST /ask`

**Request body**

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `question` | string | Ya | Teks pertanyaan, maksimal 2000 karakter |
| `options` | object **atau** array berisi 1 object | Ya | Kunci berupa 1 huruf (`a`, `b`, `c`, ...), minimal 2 opsi |
| `answer_key` | string **atau** object | Tidak | Kunci jawaban, contoh `"c"` atau `{"c": "Mitosis"}`. Jika dikirim, kunci dimasukkan ke system prompt (lihat bagian 2) |

Contoh tanpa kunci jawaban:

```json
{
  "question": "What is the process by which a cell divides into two identical daughter cells?",
  "options": { "a": "Meiosis", "b": "Osmosis", "c": "Mitosis", "d": "Fertilization" }
}
```

Contoh dengan kunci jawaban, dalam format satu baris dataset `.jsonl` yang dikirim apa adanya:

```json
{
  "question": "What is the process by which a cell divides into two identical daughter cells?",
  "options": [{ "a": "Meiosis", "b": "Osmosis", "c": "Mitosis", "d": "Fertilization" }],
  "answer_key": { "c": "Mitosis" }
}
```

Field lain (`id`, `category`, `answer`) diabaikan. Field `answer` dari dataset **tidak** dibaca sebagai kunci. Hanya `answer_key` yang dipakai.

**Response `200 OK`**

```json
{
  "answer": "c",
  "answer_text": "Mitosis",
  "answer_key": null,
  "raw": "c",
  "latency_ms": 420
}
```

| Field | Keterangan |
|---|---|
| `answer` | Huruf jawaban. Dengan `USE_GRAMMAR=true` (default) **selalu terisi** |
| `answer_text` | Teks opsi yang dipilih, diambil dari `options` |
| `answer_key` | Huruf kunci yang dipakai di system prompt, atau `null` jika request tanpa kunci |
| `raw` | Output asli model. Di `ANSWER_MODE=letter` (default) isinya hanya huruf, misalnya `"c"`. Di `ANSWER_MODE=full` isinya `"c) Mitosis"` |
| `latency_ms` | Waktu proses di server dalam milidetik, termasuk menunggu antrean. Tidak termasuk waktu jaringan |

Angka `latency_ms` di atas hanya ilustrasi. Ukur sendiri di VPS Anda.

**Response error**

| Status | Kapan terjadi |
|---|---|
| `400` | `question` kosong/terlalu panjang, `options` kurang dari 2, atau `answer_key` bukan huruf salah satu opsi |
| `503` | Antrean penuh (lebih dari `MAX_QUEUE`) |
| `500` | Error saat model memproses |

### `GET /health`

```json
{ "status": "ok", "model": "granite-4.0-h-350m-q8_0.gguf", "queue": 0 }
```

Server baru menerima koneksi **setelah model dimuat dan pemanasan selesai**. Kalau `/health` sudah menjawab, model sudah siap.

---

## 2. Cara kerja di balik layar

### Prompt

Payload diubah menjadi prompt berikut, dengan *greedy decoding* (`temperature: 0`). Pertanyaan yang sama selalu menghasilkan jawaban yang sama.

```
What is the process by which a cell divides into two identical daughter cells?

a) Meiosis
b) Osmosis
c) Mitosis
d) Fertilization

Answer with the letter (a, b, c, or d).
```

### System prompt: berbeda dari SmolLM2 dan Qwen

Template chat resmi Granite **selalu menambahkan system prompt**. Jika request tidak membawa system prompt, Granite memakai system prompt default-nya sendiri:

| Request | System prompt yang diterima model |
|---|---|
| Tanpa `answer_key` | Default Granite: *"You are a helpful assistant. Please ensure responses are professional, accurate, and safe."* |
| Dengan `answer_key` | `Jawab pertanyaan berikut dengan kunci jawaban yang diberikan,`<br>`Kunci jawaban: c) Mitosis` |

Ini perilaku resmi dari IBM dan dibiarkan apa adanya. Saat `answer_key` dikirim, system prompt Anda **menggantikan** default Granite, bukan ditambahkan.

### Grammar: jawaban tidak pernah `null`

Output model dikunci dengan grammar GBNF, jadi model **hanya bisa** menulis salah satu opsi:

| `ANSWER_MODE` | Grammar | Contoh output |
|---|---|---|
| `letter` (default, cepat) | `root ::= "a" \| "b" \| "c" \| "d"` | `c` |
| `full` | `root ::= "a) Meiosis" \| "b) Osmosis" \| "c) Mitosis" \| "d) Fertilization"` | `c) Mitosis` |

Di kedua mode, pilihan model ditentukan di **token pertama**, yaitu hurufnya. Mode `full` hanya menambahkan penyalinan teks opsi yang sudah pasti. Karena itu mode `letter` jauh lebih cepat di CPU, dengan jawaban yang praktis sama.

> **Analogi:** Murid tidak diberi pulpen, hanya stempel A, B, C, dan D. Ia bisa salah pilih, tapi tidak mungkin mengosongkan jawaban. Mode `letter` berarti ia cukup menstempel huruf. Mode `full` berarti ia juga harus menyalin ulang teks jawabannya, yang memakan waktu tanpa mengubah pilihannya.

### Pembacaan jawaban

Output dibaca menjadi huruf dengan urutan aturan berikut. Saat grammar aktif, aturan 1 selalu cocok.

0. Huruf dalam kurung di akhir: `Mitosis (c)`
1. Diawali huruf: `c`, `c)`, `(c)`, `c. Mitosis`
2. Frasa seperti `The answer is c`, `Answer: (b)`
3. Menyebut teks opsi secara utuh
4. Huruf diikuti kurung di tengah kalimat

### Antrean dan pemanasan

- Satu instance memproses **satu pertanyaan dalam satu waktu**. Request lain menunggu di antrean.
- Saat start, server menjawab satu soal contoh sebagai **pemanasan**, supaya request pertama dari pengguna tidak lambat.

---

## 3. Struktur proyek

```
granite-api/
├── src/
│   └── server.ts
├── models/              # berisi file .gguf (tidak masuk git)
├── .env                 # konfigurasi (tidak masuk git)
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

`.gitignore`:

```
node_modules
dist
models
.env
```

---

## 4. Setup

Butuh **Node.js 20 atau lebih baru** (disarankan 22).

```bash
mkdir granite-api && cd granite-api
npm init -y
npm pkg set type=module

npm i node-llama-cpp express
npm i -D typescript tsx @types/express @types/node
```

Script di `package.json`:

```bash
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node --env-file=.env dist/server.js"
npm pkg set scripts.model:pull="node-llama-cpp pull --dir ./models --filename granite-4.0-h-350m-q8_0.gguf hf:ibm-granite/granite-4.0-h-350m-GGUF/granite-4.0-h-350m-Q8_0.gguf"
```

`.env.example` (salin menjadi `.env` dengan `cp .env.example .env`):

```env
PORT=3009
MODELS_DIR=./models
# Nama file di MODELS_DIR (offline). Unduh dulu dengan: npm run model:pull
MODEL_URI=granite-4.0-h-350m-q8_0.gguf
# Jumlah thread = jumlah vCPU VPS. Jangan lebih.
THREADS=2
# letter = cepat (1 huruf), full = "huruf) teks"
ANSWER_MODE=letter
USE_GRAMMAR=true
MAX_TOKENS=32
```

---

## 5. Kode

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### `src/server.ts`

```ts
import os from "node:os";
import express, { type Request, type Response } from "express";
import { getLlama, LlamaChatSession, resolveModelFile, type LlamaGrammar } from "node-llama-cpp";

// ===================== Konfigurasi (via environment variable) =====================
const PORT = Number(process.env.PORT ?? 3009);
const MODEL_URI = process.env.MODEL_URI ?? "hf:ibm-granite/granite-4.0-h-350m-GGUF/granite-4.0-h-350m-Q8_0.gguf";
const MODELS_DIR = process.env.MODELS_DIR ?? "./models";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 32); // cukup untuk "huruf) teks jawaban"
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE ?? 512);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 50);
// true = output model dikunci ke salah satu opsi ("a) ...", "b) ...", dst.), jadi jawaban tidak pernah null
const USE_GRAMMAR = (process.env.USE_GRAMMAR ?? "true").toLowerCase() !== "false";
// Jumlah thread CPU. Default = jumlah vCPU. Jangan lebih dari jumlah vCPU (justru melambat).
const THREADS = Number(process.env.THREADS ?? os.availableParallelism());
// "letter" (cepat) = model hanya menulis 1 huruf; "full" = model menulis "huruf) teks" lengkap
const ANSWER_MODE = (process.env.ANSWER_MODE ?? "letter").toLowerCase() === "full" ? "full" : "letter";
const MAX_QUESTION_CHARS = 2000;
// Kalimat pembuka system prompt saat request membawa kunci jawaban
const ANSWER_KEY_INSTRUCTION = "Jawab pertanyaan berikut dengan kunci jawaban yang diberikan,";

// ===================== Tipe =====================
type Options = Record<string, string>;

interface AskBody {
  question?: unknown;
  options?: unknown;
  answer_key?: unknown; // opsional: "c" atau {"c": "Mitosis"}
}

// ===================== Load model (sekali saat start) =====================
console.log(`[init] memuat model ${MODEL_URI} ...`);
const modelPath = await resolveModelFile(MODEL_URI, MODELS_DIR); // unduh jika belum ada
const llama = await getLlama({ maxThreads: THREADS });
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: CONTEXT_SIZE, threads: THREADS });
const session = new LlamaChatSession({ contextSequence: context.getSequence() });
console.log(`[init] model siap: ${modelPath} | threads: ${THREADS} | mode: ${ANSWER_MODE}`);

// ===================== Antrean (1 session = 1 request pada satu waktu) =====================
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

function generate(prompt: string, grammar?: LlamaGrammar, systemPrompt?: string): Promise<string> {
  pending++;
  const job = queue.then(async () => {
    // reset riwayat; system prompt hanya dipasang jika request membawa kunci jawaban
    session.setChatHistory(systemPrompt ? [{ type: "system", text: systemPrompt }] : []);
    return session.prompt(prompt, {
      maxTokens: MAX_TOKENS,
      temperature: 0,
      ...(grammar ? { grammar } : {}),
    });
  });
  queue = job.catch(() => {}).finally(() => pending--);
  return job;
}

// ===================== Helper =====================
/** Terima options sebagai objek {"a": "..."} atau array [{"a": "..."}] (format dataset). */
function normalizeOptions(raw: unknown): Options | null {
  const obj = Array.isArray(raw) ? raw[0] : raw;
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => /^[a-z]$/i.test(k) && typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => [k.toLowerCase(), (v as string).trim()] as const);
  if (entries.length < 2) return null;
  return Object.fromEntries(entries);
}

/**
 * Kunci jawaban opsional: huruf ("c") atau objek {"c": "Mitosis"} (format field `answer` di dataset).
 * Yang menentukan hanya hurufnya; teks diambil dari options.
 * Hasil: huruf kunci, undefined jika tidak dikirim, atau null jika tidak valid.
 */
function normalizeAnswerKey(raw: unknown, options: Options): string | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  let letter: unknown = raw;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    if (keys.length !== 1) return null;
    letter = keys[0];
  }
  if (typeof letter !== "string") return null;
  const key = letter.trim().toLowerCase();
  return Object.hasOwn(options, key) ? key : null;
}

function buildSystemPrompt(answerKey: string, options: Options): string {
  return `${ANSWER_KEY_INSTRUCTION}\nKunci jawaban: ${answerKey}) ${options[answerKey]}`;
}

function buildPrompt(question: string, options: Options): string {
  const keys = Object.keys(options);
  const lines = [question.trim(), "", ...keys.map((k) => `${k}) ${options[k]}`), ""];
  lines.push(`Answer with the letter (${keys.slice(0, -1).join(", ")}, or ${keys.at(-1)}).`);
  return lines.join("\n");
}

/** Escape teks agar aman di dalam string GBNF ("..."). */
function escapeGbnf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
}

/**
 * Grammar GBNF yang mengunci output ke salah satu opsi.
 * - mode "letter": hanya huruf, mis. "c". Model cukup menulis 1 token, jadi jauh lebih cepat.
 * - mode "full"  : persis "huruf) teks", mis. "c) Mitosis".
 * Di kedua mode, pilihan model ditentukan di token pertama (hurufnya), jadi jawabannya praktis sama.
 */
function buildGrammar(options: Options): Promise<LlamaGrammar> {
  const alts = Object.entries(options).map(([k, v]) =>
    `"${escapeGbnf(ANSWER_MODE === "letter" ? k : `${k}) ${v}`)}"`);
  return llama.createGrammar({ grammar: `root ::= ${alts.join(" | ")}` });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ambil huruf jawaban dari output model. Hasil: huruf opsi atau null. */
function parseAnswer(text: string, options: Options): string | null {
  const t = text.trim().toLowerCase();
  const keys = Object.keys(options);
  const k = keys.map(escapeRegex).join("");

  // 0) Huruf dalam kurung di akhir: "Mitosis (c)"
  let m = t.match(new RegExp(`\\(([${k}])\\)\\s*[.!]?\\s*$`));
  if (m) return m[1];

  // 1) Diawali huruf: "c", "c)", "(c)", "c. mitosis"
  m = t.match(new RegExp(`^\\(?([${k}])(?:[).:,]|\\s*$)`));
  if (m) return m[1];

  // 2) "answer is c" / "answer: (b)" / "option d"
  m = t.match(new RegExp(`(?:answer|jawaban(?:nya)?|option|pilihan)\\s*(?:is|adalah)?\\s*[:\\-]?\\s*\\(?([${k}])\\b`));
  if (m) return m[1];

  // 3) Menyebut teks opsi secara utuh (ambil yang muncul paling awal)
  const found = keys
    .map((key) => ({ key, idx: t.indexOf(options[key].toLowerCase()) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  if (found.length) return found[0].key;

  // 4) Huruf diikuti kurung tutup di tengah kalimat: "... is b)"
  m = t.match(new RegExp(`\\b([${k}])\\)`));
  if (m) return m[1];

  return null;
}

// ===================== HTTP API =====================
const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", model: MODEL_URI, queue: pending });
});

app.post("/ask", async (req: Request<{}, {}, AskBody>, res: Response) => {
  const { question, options: rawOptions, answer_key: rawAnswerKey } = req.body ?? {};

  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "Field 'question' wajib berupa teks." });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return res.status(400).json({ error: `Field 'question' maksimal ${MAX_QUESTION_CHARS} karakter.` });
  }
  const options = normalizeOptions(rawOptions);
  if (!options) {
    return res.status(400).json({
      error: "Field 'options' wajib berisi minimal 2 opsi, contoh: {\"a\": \"...\", \"b\": \"...\"}.",
    });
  }
  const answerKey = normalizeAnswerKey(rawAnswerKey, options);
  if (answerKey === null) {
    return res.status(400).json({
      error: "Field 'answer_key' harus berupa huruf salah satu opsi, contoh: \"c\" atau {\"c\": \"...\"}.",
    });
  }
  if (pending >= MAX_QUEUE) {
    return res.status(503).json({ error: "Server sedang sibuk, coba lagi sebentar." });
  }

  try {
    const t0 = performance.now();
    const grammar = USE_GRAMMAR ? await buildGrammar(options) : undefined;
    const systemPrompt = answerKey ? buildSystemPrompt(answerKey, options) : undefined;
    const raw = await generate(buildPrompt(question, options), grammar, systemPrompt);
    const answer = parseAnswer(raw, options);
    res.json({
      answer,                                         // "c" atau null jika tidak terbaca
      answer_text: answer ? options[answer] : null,   // "Mitosis"
      answer_key: answerKey ?? null,                  // kunci yang dipakai di system prompt, null jika tanpa kunci
      raw: raw.trim(),                                // output asli model
      latency_ms: Math.round(performance.now() - t0),
    });
  } catch (err) {
    console.error("[ask] error:", err);
    res.status(500).json({ error: "Gagal memproses pertanyaan." });
  }
});

// Pemanasan: request pertama selalu lambat, jadi "dipanaskan" sebelum server menerima request
{
  const t0 = performance.now();
  const warmOptions: Options = { a: "Paris", b: "London", c: "Rome", d: "Berlin" };
  await generate(buildPrompt("What is the capital of France?", warmOptions),
    USE_GRAMMAR ? await buildGrammar(warmOptions) : undefined);
  console.log(`[init] pemanasan selesai dalam ${Math.round(performance.now() - t0)} ms`);
}

const server = app.listen(PORT, () => console.log(`[http] siap di http://localhost:${PORT}`));

// ===================== Shutdown rapi =====================
async function shutdown() {
  console.log("[shutdown] menutup server ...");
  server.close();
  await context.dispose();
  await model.dispose();
  await llama.dispose();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

---

## 6. Menjalankan di lokal

```bash
npm run model:pull    # unduh model sekali (366 MB)
npm run build
npm start
```

Tunggu sampai log menampilkan:

```
[init] model siap: .../models/granite-4.0-h-350m-q8_0.gguf | threads: 2 | mode: letter
[init] pemanasan selesai dalam ... ms
[http] siap di http://localhost:3009
```

Uji dari terminal lain:

```bash
# Tanpa kunci jawaban
curl -X POST http://localhost:3009/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"Who was India'\''s first Prime Minister?","options":{"a":"Lal Bahadur Shastri","b":"Jawaharlal Nehru","c":"Indira Gandhi","d":"Sardar Vallabhbhai Patel"}}'

# Dengan kunci jawaban
curl -X POST http://localhost:3009/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"Who was India'\''s first Prime Minister?","options":{"a":"Lal Bahadur Shastri","b":"Jawaharlal Nehru","c":"Indira Gandhi","d":"Sardar Vallabhbhai Patel"},"answer_key":"b"}'

curl http://localhost:3009/health
```

`npm run dev` menjalankan server dengan auto-restart saat file berubah. Mode ini tidak membaca `.env`, jadi memakai nilai default: model diunduh otomatis dari Hugging Face saat pertama kali menyala.

---

## 7. Deploy ke VPS (systemd)

**1. Clone dan pasang dependensi**

```bash
sudo mkdir -p /opt/granite-api
sudo chown "$USER":"$USER" /opt/granite-api
git clone <URL-REPO-ANDA> /opt/granite-api
cd /opt/granite-api
npm ci
```

`npm ci` hanya memasang library, termasuk binary llama.cpp. Model **tidak** ikut terunduh.

**2. Unduh model (sekali)**

```bash
npm run model:pull
ls -lh models/    # granite-4.0-h-350m-q8_0.gguf sekitar 366 MB
```

Kalau VPS tidak bisa mengakses Hugging Face, unduh di komputer lain lalu salin:

```bash
scp models/granite-4.0-h-350m-q8_0.gguf user@IP-VPS:/opt/granite-api/models/
```

**3. Konfigurasi dan build**

```bash
cp .env.example .env
nproc             # jumlah vCPU, isi THREADS di .env dengan angka ini
nano .env
npm run build
```

**4. Uji sekali di foreground**

```bash
npm start
```

Pastikan log menampilkan `threads: 2 | mode: letter` dan `pemanasan selesai`. Hentikan dengan `Ctrl+C`.

**5. Jalankan sebagai service**

systemd menjalankan server di background, menyalakannya lagi kalau crash, dan otomatis start saat VPS reboot. Perintah di bawah mengisi user dan lokasi `node` secara otomatis:

```bash
sudo tee /etc/systemd/system/granite-api.service > /dev/null <<EOF
[Unit]
Description=Granite 4.0 H 350M MCQ API
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=/opt/granite-api
ExecStart=$(command -v node) --env-file=.env dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now granite-api
```

Perintah sehari-hari:

```bash
systemctl status granite-api          # status
journalctl -u granite-api -f          # lihat log secara live
sudo systemctl restart granite-api    # restart (setelah mengubah .env atau kode)
sudo systemctl stop granite-api       # hentikan
```

**Pindah dari layanan Qwen di port yang sama?** Matikan layanan lama dulu supaya port 3009 tidak bentrok:

```bash
sudo systemctl disable --now qwen-api
```

**Update ke versi baru:**

```bash
cd /opt/granite-api
git pull
npm ci
npm run build
sudo systemctl restart granite-api
```

---

## 8. Konfigurasi

Semua pengaturan lewat `.env`. Nilai di `.env` selalu mengalahkan default di kode, jadi cukup ubah `.env` lalu restart. Tidak perlu build ulang.

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3009` | Port HTTP |
| `MODEL_URI` | `hf:ibm-granite/granite-4.0-h-350m-GGUF/granite-4.0-h-350m-Q8_0.gguf` | Nama file `.gguf` di `MODELS_DIR` (offline, disarankan) **atau** URI Hugging Face (unduh otomatis) |
| `MODELS_DIR` | `./models` | Folder file `.gguf` |
| `THREADS` | jumlah vCPU | Thread CPU. **Jangan lebih dari jumlah vCPU**, karena justru melambat |
| `ANSWER_MODE` | `letter` | `letter` = model menulis 1 huruf (cepat). `full` = `huruf) teks` |
| `USE_GRAMMAR` | `true` | `true` = output dikunci ke salah satu opsi, jadi `answer` tidak pernah `null` |
| `MAX_TOKENS` | `32` | Batas panjang output. Hanya berpengaruh di `ANSWER_MODE=full` atau saat grammar mati |
| `CONTEXT_SIZE` | `512` | Ukuran konteks. Cukup untuk satu soal |
| `MAX_QUEUE` | `50` | Batas antrean. Melebihi ini, server membalas `503` |

**Ganti ke Q4_K_M (223 MB, lebih hemat RAM):**

```bash
npx node-llama-cpp pull --dir ./models --filename granite-4.0-h-350m-q4_k_m.gguf hf:ibm-granite/granite-4.0-h-350m-GGUF/granite-4.0-h-350m-Q4_K_M.gguf
```

```env
MODEL_URI=granite-4.0-h-350m-q4_k_m.gguf
```

Model kecil lebih rapuh terhadap kuantisasi 4-bit. Bandingkan dulu hasilnya pada soal yang sama sebelum berpindah.

---

## 9. Contoh memanggil dari service lain

### TypeScript / Node.js

```ts
type AskResponse = {
  answer: string | null;
  answer_text: string | null;
  answer_key: string | null;
  raw: string;
  latency_ms: number;
};

async function askMcq(
  question: string,
  options: Record<string, string>,
  answerKey?: string,
): Promise<AskResponse> {
  const res = await fetch("http://localhost:3009/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, options, ...(answerKey ? { answer_key: answerKey } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Granite API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<AskResponse>;
}

const result = await askMcq("Who was the first person to walk on the Moon, in 1969?", {
  a: "Neil Armstrong", b: "John Glenn", c: "Buzz Aldrin", d: "Yuri Gagarin",
});
console.log(result.answer, result.answer_text);
```

### Python

```python
import requests

r = requests.post("http://localhost:3009/ask", json={
    "question": "Director Sergio Leone is best known for which film genre?",
    "options": {"a": "Horror", "b": "Spaghetti Western", "c": "Film noir", "d": "Musical"},
    "answer_key": "b",   # opsional
}, timeout=30)
r.raise_for_status()
print(r.json())
```

---

## 10. Performa di VPS 2 GB

**Perkiraan RAM:** file model 366 MB. Total proses diperkirakan di bawah 1 GB, jauh lebih ringan dari Qwen2.5-0.5B (sekitar 1,3 GB). Ini perkiraan, jadi ukur di VPS Anda dengan `systemctl status granite-api` (baris `Memory:`).

Tiga pengaturan yang paling berpengaruh pada kecepatan sudah aktif secara default:

| Pengaturan | Kenapa penting |
|---|---|
| `THREADS` = jumlah vCPU | Tanpa ini, node-llama-cpp memakai minimal 4 thread. Di VPS 2 vCPU, thread saling berebut core dan justru jauh lebih lambat |
| `ANSWER_MODE=letter` | Model cukup menulis 1 token, bukan seluruh teks opsi |
| Pemanasan saat start | Request pertama dari pengguna tidak kena lambatnya pemanasan |

**Kalau masih lambat**, cek di VPS:

```bash
vmstat 1                                                  # kolom si/so harus 0 (tidak memakai swap)
lscpu | grep -o -w 'avx2\|avx512f\|fma' | sort -u          # llama.cpp jauh lebih lambat tanpa AVX2
top                                                       # angka "st" tinggi = CPU dipakai VPS lain
```

| Hasil | Arti | Solusi |
|---|---|---|
| `si`/`so` > 0 | RAM tidak cukup, model dibaca dari disk | Pakai Q4_K_M, atau naikkan RAM |
| Tidak ada `avx2` | CPU VPS lemah/lama | Pindah ke paket VPS lain |
| `st` > 10% | CPU berbagi dengan pengguna lain | Paket dedicated vCPU |

---

## 11. Keamanan

Layanan ini **tidak punya autentikasi**, dan server mendengarkan di semua interface. Batasi aksesnya dengan firewall:

```bash
sudo ufw allow OpenSSH       # jangan sampai terkunci dari SSH
sudo ufw enable
```

- **Aplikasi pemanggil di VPS yang sama:** jangan buka port 3009. Panggil `http://localhost:3009`.
- **Aplikasi pemanggil di server lain:** izinkan hanya IP server itu.

  ```bash
  sudo ufw allow from IP-SERVER-APLIKASI to any port 3009 proto tcp
  ```

Kalau harus diakses dari internet, letakkan reverse proxy (misalnya nginx) dengan API key di depannya.

---

## 12. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| `No model file found at ...` | Model belum diunduh, atau nama di `.env` berbeda | `npm run model:pull`, lalu cek `ls models/` dan `MODEL_URI` |
| `node: .env: not found` | File `.env` belum dibuat | `cp .env.example .env` |
| `EADDRINUSE` / port 3009 dipakai | Layanan lama (misalnya Qwen) masih jalan | `sudo systemctl disable --now qwen-api` |
| Error `unknown model architecture` | node-llama-cpp terlalu lama | `npm i node-llama-cpp@latest`, lalu build ulang |
| Server menghubungi Hugging Face saat start | `MODEL_URI` masih berbentuk `hf:...` | Pakai nama file, seperti di `.env.example` |
| Service mati sendiri, log berhenti tiba-tiba | RAM habis | `sudo dmesg \| grep -i -E "killed\|oom"`. Pakai Q4_K_M atau tambah swap |
| Lambat | Thread berlebih, swap, atau CPU lemah | Lihat bagian 10 |
| Banyak `503` | Antrean penuh | Tambah instance, atau naikkan `MAX_QUEUE` |
| `answer` bernilai `null` | `USE_GRAMMAR=false` dan model menjawab di luar format | Set `USE_GRAMMAR=true` |
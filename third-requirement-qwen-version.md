# Qwen2.5-0.5B-Instruct API Service

Layanan HTTP (Node.js + TypeScript) yang menjalankan **Qwen2.5-0.5B-Instruct** (format GGUF, Q8_0) di **CPU** untuk menjawab soal pilihan ganda. Service lain cukup mengirim `question` dan `options`, lalu menerima huruf jawabannya.

> **Analogi:** Layanan ini seperti dapur restoran. Model adalah koki yang tinggal di dapur (server). Aplikasi lain adalah pelanggan yang memesan lewat pelayan (HTTP API), lalu jawabannya diantar kembali. Pelanggan tidak perlu tahu cara memasaknya.

```
Aplikasi / service lain ──POST /ask──> Qwen2.5 API (node-llama-cpp + GGUF) ──> { "answer": "c" }
```

| | |
|---|---|
| Model | `Qwen/Qwen2.5-0.5B-Instruct`, versi GGUF resmi dari `Qwen/Qwen2.5-0.5B-Instruct-GGUF` (lisensi Apache 2.0, tidak gated) |
| Ukuran | Q8_0 sekitar 676 MB (Q4_K_M sekitar 491 MB) |
| Port default di contoh ini | `3002` (agar bisa berjalan berdampingan dengan layanan SmolLM2 di port 3000 dan 3001) |
| Runtime | Node.js 20+ dengan [node-llama-cpp](https://node-llama-cpp.withcat.ai) |
| Butuh GPU? | Tidak. Berjalan di CPU |

### Dibanding SmolLM2

| | SmolLM2-135M | SmolLM2-360M | **Qwen2.5-0.5B** |
|---|---|---|---|
| Parameter | 135 juta | 360 juta | **sekitar 500 juta** |
| Ukuran file Q8_0 | 145 MB | 386 MB | **676 MB** |
| Kecepatan di CPU | Paling cepat | Sedang | **Paling lambat dari ketiganya** |
| Akurasi uji 148 soal | 27,0% | 19,6% | **Belum diuji** |

Qwen2.5-0.5B dilatih dengan data jauh lebih banyak, jadi kemungkinan **tahu lebih banyak** dibanding SmolLM2. Ini perlu dipertimbangkan kalau tujuan Anda model yang minim pengetahuan. Ukur dulu akurasinya dengan notebook `uji_model_kecil.ipynb` (model ini sudah ada di daftar `MODELS`) sebelum dipakai.

> **Analogi:** Kalau SmolLM2 seperti anak SD yang sopan, Qwen2.5-0.5B seperti anak SMP: sama-sama patuh, tapi lebih banyak yang sudah ia ketahui, dan ia berpikir sedikit lebih lama.

**Format prompt.** node-llama-cpp mengenali model Qwen dan memakai format chat Qwen tanpa system prompt bawaan. Prompt yang dikirim sama dengan layanan SmolLM2.

---

## Daftar isi

1. [Spesifikasi API](#1-spesifikasi-api)
2. [Struktur proyek](#2-struktur-proyek)
3. [Setup](#3-setup)
4. [Kode](#4-kode)
5. [Menjalankan (tanpa Docker)](#5-menjalankan-tanpa-docker)
6. [Agar tetap menyala: PM2](#6-agar-tetap-menyala-pm2)
7. [Docker (opsional)](#7-docker-opsional)
8. [Konfigurasi](#8-konfigurasi)
9. [Contoh memanggil dari service lain](#9-contoh-memanggil-dari-service-lain)
10. [Catatan penting](#10-catatan-penting)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Spesifikasi API

### `POST /ask`

Menjawab satu soal pilihan ganda.

**Request body**

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `question` | string | Ya | Teks pertanyaan, maksimal 2000 karakter |
| `options` | object **atau** array berisi 1 object | Ya | Kunci berupa 1 huruf (`a`, `b`, `c`, ...), minimal 2 opsi |

Kedua bentuk `options` berikut diterima. Bentuk kedua sama dengan format dataset `.jsonl`, jadi satu baris dataset bisa langsung dikirim apa adanya.

```json
{
  "question": "What is the process by which a cell divides into two identical daughter cells?",
  "options": { "a": "Meiosis", "b": "Osmosis", "c": "Mitosis", "d": "Fertilization" }
}
```

```json
{
  "question": "What is the process by which a cell divides into two identical daughter cells?",
  "options": [{ "a": "Meiosis", "b": "Osmosis", "c": "Mitosis", "d": "Fertilization" }]
}
```

Field lain (`id`, `category`, `answer`) diabaikan, jadi aman ikut terkirim.

**Response `200 OK`**

```json
{
  "answer": "c",
  "answer_text": "Mitosis",
  "raw": "c) Mitosis",
  "latency_ms": 184
}
```

| Field | Keterangan |
|---|---|
| `answer` | Huruf jawaban. Dengan `USE_GRAMMAR=true` (default) **selalu terisi**. Hanya bisa `null` jika grammar dimatikan dan output model tidak bisa dibaca |
| `answer_text` | Teks opsi yang dipilih |
| `raw` | Output asli model, berguna untuk debugging |
| `latency_ms` | Waktu proses di server dalam milidetik, termasuk menunggu antrean. Tidak termasuk waktu perjalanan jaringan |

Angka `latency_ms` di atas hanya ilustrasi.

**Response error**

| Status | Kapan terjadi | Contoh body |
|---|---|---|
| `400` | `question` kosong/terlalu panjang, atau `options` kurang dari 2 | `{"error": "Field 'question' wajib berupa teks."}` |
| `503` | Antrean penuh (lebih dari `MAX_QUEUE`) | `{"error": "Server sedang sibuk, coba lagi sebentar."}` |
| `500` | Error saat model memproses | `{"error": "Gagal memproses pertanyaan."}` |

### `GET /health`

Untuk health check (load balancer, PM2, Docker, Kubernetes).

```json
{ "status": "ok", "model": "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf", "queue": 0 }
```

Server baru menerima koneksi **setelah model selesai dimuat**. Jadi kalau `/health` sudah menjawab, model sudah siap.

### Cara kerja di balik layar

**1. Prompt.** Payload diubah menjadi prompt berikut, lalu dikirim ke model **tanpa system prompt** dengan *greedy decoding* (`temperature: 0`). Pertanyaan yang sama selalu menghasilkan jawaban yang sama.

```
What is the process by which a cell divides into two identical daughter cells?

a) Meiosis
b) Osmosis
c) Mitosis
d) Fertilization

Answer with the letter (a, b, c, or d).
```

**2. Grammar (default aktif).** Output model dikunci dengan grammar GBNF, sehingga model **hanya bisa** menulis salah satu opsi secara persis:

```
root ::= "a) Meiosis" | "b) Osmosis" | "c) Mitosis" | "d) Fertilization"
```

Model tetap memilih sendiri opsi mana yang ditulis, tapi tidak bisa menulis kalimat lain, menolak menjawab, atau mengarang opsi. Akibatnya `answer` **tidak pernah `null`**.

> **Analogi:** Murid tidak diberi pulpen, hanya stempel A, B, C, dan D. Ia bisa salah pilih, tapi tidak mungkin mengosongkan atau menulis esai di lembar jawaban.

**3. Membaca jawaban.** Output dibaca menjadi huruf dengan urutan aturan berikut. Saat grammar aktif, aturan 1 selalu cocok.

0. Huruf dalam kurung di akhir: `Mitosis (c)`
1. Diawali huruf: `c`, `c)`, `(c)`, `c. Mitosis`
2. Frasa seperti `The answer is c`, `Answer: (b)`
3. Menyebut teks opsi secara utuh, misalnya `...by mitosis` menjadi `c`
4. Huruf diikuti kurung di tengah kalimat, misalnya `I think it's d) ...`

---

## 2. Struktur proyek

```
qwen2.5-0.5b-api/
├── src/
│   └── server.ts
├── models/              # berisi file .gguf (dibuat otomatis)
├── .env
├── package.json
└── tsconfig.json
```

---

## 3. Setup

Butuh **Node.js 20 atau lebih baru** (disarankan 22).

```bash
mkdir qwen2.5-0.5b-api && cd qwen2.5-0.5b-api
npm init -y
npm pkg set type=module

npm i node-llama-cpp express
npm i -D typescript tsx @types/express @types/node
```

Tambahkan script ke `package.json`:

```bash
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node --env-file=.env dist/server.js"
npm pkg set scripts.model:pull="node-llama-cpp pull --dir ./models --filename qwen2.5-0.5b-instruct-q8_0.gguf hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf"
```

Buat file `.env` di folder proyek:

```env
PORT=3002
MODELS_DIR=./models
MODEL_URI=qwen2.5-0.5b-instruct-q8_0.gguf
MAX_TOKENS=32
USE_GRAMMAR=true
```

---

## 4. Kode

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
import express, { type Request, type Response } from "express";
import { getLlama, LlamaChatSession, resolveModelFile, type LlamaGrammar } from "node-llama-cpp";

// ===================== Konfigurasi (via environment variable) =====================
const PORT = Number(process.env.PORT ?? 3000);
const MODEL_URI = process.env.MODEL_URI ?? "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf";
const MODELS_DIR = process.env.MODELS_DIR ?? "./models";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 32); // cukup untuk "huruf) teks jawaban"
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE ?? 512);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 50);
// true = output model dikunci ke salah satu opsi ("a) ...", "b) ...", dst.), jadi jawaban tidak pernah null
const USE_GRAMMAR = (process.env.USE_GRAMMAR ?? "true").toLowerCase() !== "false";
const MAX_QUESTION_CHARS = 2000;

// ===================== Tipe =====================
type Options = Record<string, string>;

interface AskBody {
  question?: unknown;
  options?: unknown;
}

// ===================== Load model (sekali saat start) =====================
console.log(`[init] memuat model ${MODEL_URI} ...`);
const modelPath = await resolveModelFile(MODEL_URI, MODELS_DIR); // unduh jika belum ada
const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: CONTEXT_SIZE });
const session = new LlamaChatSession({ contextSequence: context.getSequence() });
console.log(`[init] model siap: ${modelPath}`);

// ===================== Antrean (1 session = 1 request pada satu waktu) =====================
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

function generate(prompt: string, grammar?: LlamaGrammar): Promise<string> {
  pending++;
  const job = queue.then(async () => {
    session.setChatHistory([]); // reset: tanpa system prompt & tanpa riwayat sebelumnya
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
 * Grammar GBNF yang hanya mengizinkan salah satu opsi, persis "huruf) teks".
 * Model tetap memilih sendiri opsinya, tapi tidak bisa menulis hal lain.
 */
function buildGrammar(options: Options): Promise<LlamaGrammar> {
  const alts = Object.entries(options).map(([k, v]) => `"${escapeGbnf(`${k}) ${v}`)}"`);
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
  const { question, options: rawOptions } = req.body ?? {};

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
  if (pending >= MAX_QUEUE) {
    return res.status(503).json({ error: "Server sedang sibuk, coba lagi sebentar." });
  }

  try {
    const t0 = performance.now();
    const grammar = USE_GRAMMAR ? await buildGrammar(options) : undefined;
    const raw = await generate(buildPrompt(question, options), grammar);
    const answer = parseAnswer(raw, options);
    res.json({
      answer,                                         // "c" atau null jika tidak terbaca
      answer_text: answer ? options[answer] : null,   // "Mitosis"
      raw: raw.trim(),                                // output asli model
      latency_ms: Math.round(performance.now() - t0),
    });
  } catch (err) {
    console.error("[ask] error:", err);
    res.status(500).json({ error: "Gagal memproses pertanyaan." });
  }
});

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

## 5. Menjalankan (tanpa Docker)

```bash
# 1) Unduh model sekali (sekitar 676 MB) ke ./models/qwen2.5-0.5b-instruct-q8_0.gguf
npm run model:pull

# 2) Compile TypeScript
npm run build

# 3) Jalankan (membaca .env)
npm start
```

Untuk development, `npm run dev` menjalankan server dengan auto-restart saat file berubah. Mode ini tidak membaca `.env`, sehingga memakai nilai default: model diunduh otomatis dari Hugging Face saat pertama kali menyala.

**Dua cara menentukan model lewat `MODEL_URI`:**

| Bentuk `MODEL_URI` | Perilaku | Cocok untuk |
|---|---|---|
| Nama file di `MODELS_DIR`, misalnya `qwen2.5-0.5b-instruct-q8_0.gguf` | Langsung dibaca dari disk, **tanpa internet** | Produksi |
| URI Hugging Face, misalnya `hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf` | Diunduh otomatis saat pertama kali menyala | Development / coba-coba |

> Kenapa produksi memakai nama file? Dengan URI `hf:`, library mencari file lokal berdasarkan tebakan nama. Kalau nama di disk berbeda, server menghubungi Hugging Face lagi saat start dan gagal jika tidak ada internet. Nama file langsung menghilangkan ketergantungan ini.

**Uji dari terminal lain:**

```bash
curl -X POST http://localhost:3002/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Who was India'\''s first Prime Minister?",
    "options": {"a": "Lal Bahadur Shastri", "b": "Jawaharlal Nehru", "c": "Indira Gandhi", "d": "Sardar Vallabhbhai Patel"}
  }'

curl http://localhost:3002/health
```

---

## 6. Agar tetap menyala: PM2

`npm start` berhenti kalau terminal ditutup atau server crash. **PM2** menjaga layanan tetap hidup dan menyalakannya ulang kalau mati.

> **Analogi:** PM2 seperti satpam yang berjaga di dapur. Kalau koki pingsan, satpam langsung memanggil koki pengganti.

```bash
npm install -g pm2

pm2 start dist/server.js --name qwen2.5-0.5b-api --node-args="--env-file=.env"

pm2 logs qwen2.5-0.5b-api      # lihat log
pm2 restart qwen2.5-0.5b-api   # restart setelah mengubah .env atau kode
pm2 save                  # simpan daftar proses
pm2 startup               # menyala otomatis saat server reboot (Linux/macOS)
```

---

## 7. Docker (opsional)

Lewati bagian ini jika tidak memakai Docker. Docker berguna jika Anda deploy ke banyak server atau ke platform yang meminta image (Kubernetes, Cloud Run).

Model diunduh **saat build image**, jadi container tidak butuh internet saat berjalan.

### `Dockerfile`

```dockerfile
FROM node:22-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Unduh model ke dalam image dengan nama file yang pasti
RUN npx --no node-llama-cpp pull --dir /app/models --filename model.gguf \
    hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf

RUN npm prune --omit=dev

ENV NODE_ENV=production \
    PORT=3002 \
    MODELS_DIR=/app/models \
    MODEL_URI=model.gguf \
    MAX_TOKENS=32 \
    USE_GRAMMAR=true
EXPOSE 3002

# Tidak memakai --env-file: konfigurasi diambil dari ENV di atas
CMD ["node", "dist/server.js"]
```

### `.dockerignore`

```
node_modules
dist
models
.env
```

```bash
docker build -t qwen2.5-0.5b-api .
docker run -p 3002:3002 qwen2.5-0.5b-api
```

---

## 8. Konfigurasi

Semua pengaturan lewat environment variable (file `.env`). Nilai di `.env` selalu mengalahkan nilai default di kode, jadi untuk mengganti pengaturan cukup ubah `.env` lalu restart. Tidak perlu `npm run build` ulang.

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP. Contoh `.env` di dokumen ini memakai `3002` |
| `MODEL_URI` | `hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf` | Nama file `.gguf` di `MODELS_DIR` (offline) **atau** URI Hugging Face (unduh otomatis) |
| `MODELS_DIR` | `./models` | Folder penyimpanan file `.gguf` |
| `MAX_TOKENS` | `32` | Panjang maksimal jawaban. Kecil = cepat. Jika opsi sangat panjang, teks di `raw` bisa terpotong, tetapi huruf jawaban tetap terbaca karena ditulis di awal |
| `CONTEXT_SIZE` | `512` | Ukuran konteks. Cukup untuk satu soal |
| `MAX_QUEUE` | `50` | Batas antrean. Melebihi ini, server membalas `503` |
| `USE_GRAMMAR` | `true` | `true` = output dikunci ke salah satu opsi, jadi `answer` tidak pernah `null`. `false` = model menjawab bebas |

**Mengganti ke Q4_K_M (lebih kecil, sedikit lebih cepat):**

```bash
npx node-llama-cpp pull --dir ./models --filename qwen2.5-0.5b-instruct-q4_k_m.gguf hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

```env
MODEL_URI=qwen2.5-0.5b-instruct-q4_k_m.gguf
```

Q4_K_M hanya sekitar 28% lebih kecil (491 MB vs 676 MB), tidak sampai setengahnya. Penyebabnya, Qwen punya kosakata yang sangat besar, dan sebagian besar ukuran file ada di tabel kosakata itu. Ibaratnya, kamusnya tetap tebal walaupun isi bukunya diringkas. Q8_0 tetap pilihan yang lebih aman untuk kualitas.

---

## 9. Contoh memanggil dari service lain

### TypeScript / Node.js

```ts
type AskResponse = {
  answer: string | null;
  answer_text: string | null;
  raw: string;
  latency_ms: number;
};

async function askMcq(question: string, options: Record<string, string>): Promise<AskResponse> {
  const res = await fetch("http://localhost:3002/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, options }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Qwen2.5 API ${res.status}: ${await res.text()}`);
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

r = requests.post("http://localhost:3002/ask", json={
    "question": "Director Sergio Leone is best known for which film genre?",
    "options": {"a": "Horror", "b": "Spaghetti Western", "c": "Film noir", "d": "Musical"},
}, timeout=30)
r.raise_for_status()
print(r.json())
```

---

## 10. Catatan penting

**Kemampuan model.** Qwen2.5-0.5B-Instruct patuh pada format, dan pengetahuannya kemungkinan lebih banyak dari SmolLM2, tapi tetap terbatas untuk ukuran 0,5B. Akurasinya pada dataset trivia Anda belum diukur. Jalankan `uji_model_kecil.ipynb` dulu untuk mengetahuinya.

**Antrean dan konkurensi.** Satu instance memproses **satu pertanyaan dalam satu waktu**, sedangkan request lain menunggu di antrean. Ibaratnya satu koki memasak pesanan satu per satu. Qwen2.5-0.5B paling lambat dibanding kedua model SmolLM2, jadi antrean lebih cepat terasa saat trafik ramai. Jika trafik ramai, jalankan beberapa instance di belakang load balancer.

**Request pertama lebih lambat.** Request pertama setelah start biasanya lebih lambat karena pemanasan. Ukur latensi mulai dari request kedua.

**Keamanan.** Layanan ini belum memiliki autentikasi. Jangan buka port-nya ke internet publik. Letakkan di jaringan internal, atau tambahkan API key atau reverse proxy di depannya.

---

## 11. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| Start sangat lama saat pertama kali | Model sedang diunduh (`MODEL_URI` berbentuk `hf:...`) | Tunggu, atau jalankan `npm run model:pull` lebih dulu dan pakai nama file |
| Error koneksi ke `huggingface.co` | Server tanpa internet, sementara `MODEL_URI` masih `hf:...` | Unduh file `.gguf` di mesin yang punya internet, salin ke `MODELS_DIR`, set `MODEL_URI` ke nama filenya |
| `No model file found at ...` | `MODEL_URI` berupa nama file, tapi file tidak ada di `MODELS_DIR` | Cek nama file dan isi folder (`ls ./models`) |
| `node: .env: not found` saat `npm start` | File `.env` belum dibuat | Buat `.env` seperti di bagian 3 |
| Error saat `npm i node-llama-cpp` atau saat start (binary tidak cocok) | Platform tidak punya binary siap pakai | Pasang `cmake` dan compiler (`build-essential` di Debian/Ubuntu) |
| `answer` bernilai `null` | `USE_GRAMMAR=false` dan model menjawab di luar format | Set `USE_GRAMMAR=true`, atau cek field `raw` |
| Banyak `503` | Antrean penuh | Tambah instance, atau naikkan `MAX_QUEUE` jika latensi masih bisa diterima |
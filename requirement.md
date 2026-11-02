# SmolLM2 MCQ API Service

Layanan HTTP (Node.js + TypeScript) yang menjalankan model **SmolLM2-135M-Instruct** (format GGUF) di **CPU** untuk menjawab soal pilihan ganda. Layanan lain cukup mengirim `question` dan `options`, lalu menerima huruf jawabannya.

> **Analogi:** Layanan ini seperti dapur restoran. Model adalah koki yang tinggal di dapur (server). Aplikasi lain adalah pelanggan yang memesan lewat pelayan (HTTP API), lalu jawaban diantar kembali. Pelanggan tidak perlu tahu cara memasaknya.

```
Aplikasi / service lain ──POST /ask──> SmolLM2 API (node-llama-cpp + GGUF) ──> { "answer": "c" }
```

---

## Daftar isi

1. [Spesifikasi API](#1-spesifikasi-api)
2. [Struktur proyek](#2-struktur-proyek)
3. [Setup](#3-setup)
4. [Kode](#4-kode)
5. [Menjalankan](#5-menjalankan)
6. [Docker (produksi)](#6-docker-produksi)
7. [Konfigurasi](#7-konfigurasi)
8. [Contoh memanggil dari service lain](#8-contoh-memanggil-dari-service-lain)
9. [Catatan penting](#9-catatan-penting)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Spesifikasi API

### `POST /ask`

Menjawab satu soal pilihan ganda.

**Request body**

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `question` | string | Ya | Teks pertanyaan, maksimal 2000 karakter |
| `options` | object **atau** array berisi 1 object | Ya | Kunci berupa 1 huruf (`a`, `b`, `c`, ...), minimal 2 opsi |

Kedua bentuk `options` di bawah ini diterima. Bentuk kedua sama dengan format dataset `.jsonl`, jadi baris dataset bisa langsung dikirim.

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

Field lain (misalnya `id`, `category`, `answer`) diabaikan, jadi aman ikut terkirim.

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
| `answer` | Huruf jawaban. Dengan `USE_GRAMMAR=true` (default) selalu terisi. Hanya bisa `null` jika grammar dimatikan dan output model tidak bisa dibaca |
| `answer_text` | Teks opsi yang dipilih, atau `null` |
| `raw` | Output asli model, berguna untuk debugging |
| `latency_ms` | Waktu proses di server, termasuk waktu menunggu antrean |

**Response error**

| Status | Kapan terjadi | Contoh body |
|---|---|---|
| `400` | `question` kosong/terlalu panjang, atau `options` kurang dari 2 | `{"error": "Field 'question' wajib berupa teks."}` |
| `503` | Antrean penuh (lebih dari `MAX_QUEUE`) | `{"error": "Server sedang sibuk, coba lagi sebentar."}` |
| `500` | Error saat model memproses | `{"error": "Gagal memproses pertanyaan."}` |

### `GET /health`

Untuk health check (load balancer, Docker, Kubernetes).

```json
{ "status": "ok", "model": "hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0", "queue": 0 }
```

Server baru mulai menerima koneksi **setelah model selesai dimuat**. Jadi, kalau `/health` sudah menjawab, berarti model sudah siap.

### Cara kerja di balik layar

Server mengubah payload menjadi prompt berikut, lalu mengirimnya ke model **tanpa system prompt** dengan *greedy decoding* (`temperature: 0`). Artinya, pertanyaan yang sama selalu menghasilkan jawaban yang sama.

```
What is the process by which a cell divides into two identical daughter cells?

a) Meiosis
b) Osmosis
c) Mitosis
d) Fertilization

Answer with the letter (a, b, c, or d).
```

**Grammar (default aktif).** Output model dikunci dengan grammar GBNF, sehingga model **hanya bisa** menulis salah satu opsi secara persis:

```
root ::= "a) Meiosis" | "b) Osmosis" | "c) Mitosis" | "d) Fertilization"
```

Model tetap memilih sendiri opsi mana yang ditulis, tapi tidak bisa menulis kalimat lain, menolak menjawab, atau mengarang opsi. Akibatnya `answer` **tidak pernah `null`**. Ibaratnya, murid hanya diberi stempel A, B, C, atau D, sehingga tidak bisa menulis esai di LJK.

Grammar memakai format `huruf) teks`, sama dengan model dasar dan model fine-tuning 6 epoch. Untuk model v2 yang menjawab `teks (huruf)`, set `USE_GRAMMAR=false`.

Output model lalu dibaca menjadi huruf dengan urutan aturan berikut:

0. Huruf dalam kurung di akhir: `Jawaharlal Nehru (b)` (format model hasil fine-tuning v2)
1. Diawali huruf: `c`, `c)`, `(c)`, `c. Mitosis`
2. Frasa seperti `The answer is c`, `Answer: (b)`
3. Menyebut teks opsi secara utuh, misalnya `...by mitosis` menjadi `c`
4. Huruf diikuti kurung di tengah kalimat, misalnya `I think it's d) ...`

Kalau tidak ada aturan yang cocok, `answer` bernilai `null`.

---

## 2. Struktur proyek

```
smollm-api/
├── src/
│   └── server.ts
├── models/              # dibuat otomatis, berisi file .gguf
├── package.json
├── tsconfig.json
├── Dockerfile
└── .dockerignore
```

---

## 3. Setup

Butuh **Node.js 20 atau lebih baru** (disarankan 22).

```bash
mkdir smollm-api && cd smollm-api
npm init -y
npm pkg set type=module

npm i node-llama-cpp express
npm i -D typescript tsx @types/express @types/node
```

Tambahkan script ke `package.json`:

```bash
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node dist/server.js"
npm pkg set scripts.model:pull="node-llama-cpp pull --dir ./models --filename smollm2-135m-instruct-q8_0.gguf hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0"
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
const MODEL_URI = process.env.MODEL_URI ?? "hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0";
const MODELS_DIR = process.env.MODELS_DIR ?? "./models";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 32); // cukup untuk "teks jawaban (huruf)"
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
      budgets: { thoughtTokens: 0 }, // matikan "berpikir" (Qwen3 dll.); model lain mengabaikannya
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

  // 0) Huruf dalam kurung di akhir: "Jawaharlal Nehru (b)" (format model hasil fine-tuning v2)
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

## 5. Menjalankan

```bash
# (Opsional) unduh model lebih dulu, sekitar 145 MB
npm run model:pull

# Mode development (auto-restart saat file berubah)
npm run dev

# Mode produksi
npm run build
npm start
```

Ada dua cara menentukan model lewat `MODEL_URI`:

| Bentuk `MODEL_URI` | Perilaku | Cocok untuk |
|---|---|---|
| URI Hugging Face, misalnya `hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0` (default) | Diunduh otomatis saat server pertama kali menyala | Development |
| Nama file di `MODELS_DIR`, misalnya `smollm2-135m-instruct-q8_0.gguf` | Langsung dibaca dari disk, **tanpa koneksi internet sama sekali** | Produksi / server offline |

Untuk produksi, unduh dulu dengan `npm run model:pull`, lalu jalankan dengan nama file:

```bash
MODEL_URI=smollm2-135m-instruct-q8_0.gguf npm start
```

> Kenapa tidak cukup URI `hf:` saja? Dengan URI, library mencari file lokal berdasarkan tebakan nama. Kalau nama file di disk berbeda dari tebakan itu, server akan menghubungi Hugging Face lagi saat start, dan gagal jika server tidak punya internet. Memakai nama file langsung menghilangkan ketergantungan ini.

Uji dari terminal lain:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Who was India'\''s first Prime Minister?",
    "options": {"a": "Lal Bahadur Shastri", "b": "Jawaharlal Nehru", "c": "Indira Gandhi", "d": "Sardar Vallabhbhai Patel"}
  }'
```

---

## 6. Docker (produksi)

Model diunduh **saat build image**, bukan saat container menyala. Dengan begitu container cepat siap, tidak bergantung pada Hugging Face saat runtime, dan versi modelnya sama di setiap deploy. Untuk mengganti ke Q4_K_M, ubah `:Q8_0` menjadi `:Q4_K_M` di perintah `pull`, lalu build ulang image.

### `Dockerfile`

```dockerfile
FROM node:22-slim

WORKDIR /app

# Dependensi
COPY package*.json ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Unduh model ke dalam image dengan nama file yang pasti
RUN npx --no node-llama-cpp pull --dir /app/models --filename model.gguf \
    hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0

# Server membaca file lokal, tidak menghubungi Hugging Face saat runtime
ENV MODELS_DIR=/app/models
ENV MODEL_URI=model.gguf

# Buang devDependencies agar image lebih kecil
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### `.dockerignore`

```
node_modules
dist
models
```

### Build & run

```bash
docker build -t smollm-api .
docker run -p 3000:3000 smollm-api
```

---

## 7. Konfigurasi

Semua pengaturan lewat environment variable.

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `MODEL_URI` | `hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0` | URI Hugging Face (diunduh otomatis) **atau** nama file `.gguf` di `MODELS_DIR` (offline). Ganti `:Q8_0` menjadi `:Q4_K_M` untuk versi lebih kecil (sekitar 105 MB) |
| `MODELS_DIR` | `./models` | Folder penyimpanan file `.gguf` |
| `MAX_TOKENS` | `32` | Panjang maksimal jawaban model. Kecil = cepat, tapi untuk format `teks (huruf)` jangan di bawah 32 agar huruf di akhir tidak terpotong |
| `CONTEXT_SIZE` | `512` | Ukuran konteks. Cukup untuk satu soal |
| `MAX_QUEUE` | `50` | Batas antrean. Melebihi ini, server membalas `503` |
| `USE_GRAMMAR` | `true` | `true` = output dikunci ke salah satu opsi, jadi `answer` tidak pernah `null`. Set `false` untuk model yang menjawab `teks (huruf)` (v2) |

Contoh:

```bash
# Development: unduh otomatis versi Q4_K_M
MODEL_URI=hf:bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M PORT=8080 npm run dev

# Produksi: file lokal
MODEL_URI=smollm2-135m-instruct-q8_0.gguf npm start
```

---

## 8. Contoh memanggil dari service lain

### TypeScript / Node.js

```ts
type AskResponse = {
  answer: string | null;
  answer_text: string | null;
  raw: string;
  latency_ms: number;
};

async function askMcq(question: string, options: Record<string, string>): Promise<AskResponse> {
  const res = await fetch("http://localhost:3000/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, options }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`SmolLM2 API ${res.status}: ${await res.text()}`);
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

r = requests.post("http://localhost:3000/ask", json={
    "question": "Director Sergio Leone is best known for which film genre?",
    "options": {"a": "Horror", "b": "Spaghetti Western", "c": "Film noir", "d": "Musical"},
}, timeout=30)
r.raise_for_status()
print(r.json())
```

---

## 9. Catatan penting

**Antrean dan konkurensi.** Satu instance memproses **satu pertanyaan dalam satu waktu**, sedangkan request lain menunggu di antrean. Ibaratnya satu koki memasak pesanan satu per satu. Untuk model 135M dengan jawaban 16 token, setiap giliran biasanya singkat. Jika trafik ramai, jalankan beberapa container di belakang load balancer (tambah koki), lalu atur `MAX_QUEUE` agar request tidak menumpuk terlalu lama.

**Request pertama lebih lambat.** Request pertama setelah start biasanya lebih lambat karena pemanasan. Ukur latensi mulai dari request kedua.

**Q8_0 vs Q4_K_M.** Q8_0 (145 MB) lebih aman untuk kualitas. Q4_K_M (105 MB) sedikit lebih kecil dan cepat, tapi model sekecil 135M lebih rapuh terhadap kuantisasi 4-bit. Sebelum mengganti, bandingkan persentase `answer` yang tidak `null` (format patuh) pada dataset yang sama.

**Keterbatasan model.** Pada uji 148 soal, akurasi SmolLM2-135M sekitar 27%, setara tebakan acak, dengan format patuh 95%. Layanan ini cocok untuk eksperimen "model patuh instruksi tapi minim pengetahuan", **bukan** untuk menjawab soal secara akurat.

**Keamanan.** Layanan ini belum memiliki autentikasi. Jangan buka port-nya ke internet publik. Letakkan di jaringan internal, atau tambahkan API key atau reverse proxy di depannya.

---

## 10. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| Start sangat lama saat pertama kali | Model sedang diunduh | Tunggu, atau jalankan `npm run model:pull` lebih dulu |
| Error koneksi ke `huggingface.co` | Server tanpa internet atau diblokir firewall, sementara `MODEL_URI` masih berbentuk `hf:...` | Unduh file `.gguf` di mesin yang punya internet, salin ke `MODELS_DIR`, lalu set `MODEL_URI` ke **nama file** tersebut |
| `No model file found at ...` | `MODEL_URI` berupa nama file, tapi file tidak ada di `MODELS_DIR` | Cek nama file dan isi `MODELS_DIR` (`ls ./models`) |
| Error saat `npm i node-llama-cpp` atau saat start (binary tidak cocok) | Platform tidak punya binary siap pakai, sehingga llama.cpp perlu di-compile | Pasang `cmake` dan compiler (`build-essential` di Debian/Ubuntu) |
| `answer` sering `null` | `USE_GRAMMAR=false` dan model menjawab di luar format | Aktifkan kembali `USE_GRAMMAR=true`, atau cek field `raw` |
| Banyak `503` | Antrean penuh | Tambah instance, atau naikkan `MAX_QUEUE` jika latensi masih bisa diterima |
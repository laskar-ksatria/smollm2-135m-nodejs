import express, { type Request, type Response } from "express";
import { getLlama, LlamaChatSession, resolveModelFile, type LlamaGrammar } from "node-llama-cpp";

// ===================== Konfigurasi (via environment variable) =====================
const PORT = Number(process.env.PORT ?? 3009);
const MODEL_URI = process.env.MODEL_URI ?? "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf";
const MODELS_DIR = process.env.MODELS_DIR ?? "./models";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 32); // cukup untuk "huruf) teks jawaban"
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE ?? 512);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 50);
// true = output model dikunci ke salah satu opsi ("a) ...", "b) ...", dst.), jadi jawaban tidak pernah null
const USE_GRAMMAR = (process.env.USE_GRAMMAR ?? "true").toLowerCase() !== "false";
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
const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const context = await model.createContext({ contextSize: CONTEXT_SIZE });
const session = new LlamaChatSession({ contextSequence: context.getSequence() });
console.log(`[init] model siap: ${modelPath}`);

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

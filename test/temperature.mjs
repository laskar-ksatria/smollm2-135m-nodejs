// Uji temperature per request terhadap server yang sedang jalan.
//   - Dengan answer_key: jawaban tiap soal harus selalu sama (ANSWER_KEY_TEMPERATURE=0).
//   - Tanpa answer_key : jawaban harus bisa berbeda-beda (TEMPERATURE > 0).
//
// Pemakaian:
//   npm start                      (terminal lain)
//   npm test                       (pakai sample-questions.jsonl)
//   npm test -- questions.jsonl    (pakai file lain)
//   RUNS=20 API_URL=http://localhost:3009 npm test
import fs from "node:fs";

const FILE = process.argv[2] ?? "sample-questions.jsonl";
const API_URL = process.env.API_URL ?? "http://localhost:3009";
const RUNS = Number(process.env.RUNS ?? 10);

const rows = fs.readFileSync(FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));

async function ask(body) {
  const res = await fetch(`${API_URL}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Ringkas daftar jawaban jadi "a×7 b×3". */
function summarize(answers) {
  const count = {};
  for (const a of answers) count[a] = (count[a] ?? 0) + 1;
  return Object.entries(count).sort().map(([k, n]) => `${k}×${n}`).join(" ");
}

async function run(withKey) {
  const result = [];
  for (const row of rows) {
    const key = Object.keys(row.answer)[0];
    // Baris dataset dikirim apa adanya; field `answer` tidak dibaca server sebagai kunci
    const body = withKey ? { ...row, answer_key: row.answer } : row;
    const answers = [];
    for (let i = 0; i < RUNS; i++) answers.push((await ask(body)).answer);
    result.push({ key, answers, correct: answers.filter((a) => a === key).length });
  }
  return result;
}

console.log(`API: ${API_URL} | data: ${FILE} (${rows.length} soal) | ${RUNS} kali per soal\n`);
const noKey = await run(false);
const withKey = await run(true);

console.log("No | Kunci | Tanpa kunci        | Dengan kunci");
rows.forEach((_, i) => {
  console.log(`${String(i + 1).padStart(2)} | ${noKey[i].key.padEnd(5)} | ${summarize(noKey[i].answers).padEnd(18)} | ${summarize(withKey[i].answers)}`);
});

function stats(result) {
  const total = result.length * RUNS;
  const correct = result.reduce((s, r) => s + r.correct, 0);
  return {
    accuracy: Math.round((100 * correct) / total),
    varied: result.filter((r) => new Set(r.answers).size > 1).length,
    alwaysWrong: result.filter((r) => r.correct === 0).length,
  };
}
const a = stats(noKey);
const b = stats(withKey);
console.log(`\nTanpa kunci : akurasi ${a.accuracy}% | soal bervariasi ${a.varied}/${rows.length} | selalu salah ${a.alwaysWrong}`);
console.log(`Dengan kunci: akurasi ${b.accuracy}% | soal bervariasi ${b.varied}/${rows.length} | selalu salah ${b.alwaysWrong}\n`);

const checks = [
  ["Dengan kunci, jawaban tiap soal selalu sama (temperature 0)", b.varied === 0],
  ["Tanpa kunci, jawaban bisa berbeda-beda (temperature > 0)", a.varied > 0],
];
for (const [name, ok] of checks) console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;

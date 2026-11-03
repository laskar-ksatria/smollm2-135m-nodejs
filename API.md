# API

Base URL: `http://localhost:3009`. Semua request dan response memakai JSON.

---

## `POST /ask`

Kirim satu soal pilihan ganda, lalu terima jawaban model.

### Payload

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `question` | string | ya | Teks soal, maksimal 2000 karakter |
| `options` | object atau array | ya | Minimal 2 opsi. Format `{"a": "...", "b": "..."}`, atau `[{"a": "...", "b": "..."}]` seperti di dataset |
| `answer_key` | string atau object | tidak | Kunci jawaban. Jika diisi, kunci dimasukkan ke system prompt. Format `"a"`, atau `{"a": "..."}` seperti field `answer` di dataset |

Aturan `options`:

- Kunci opsi berupa satu huruf. Huruf besar diubah menjadi huruf kecil.
- Nilai opsi berupa teks yang tidak kosong.
- Entri yang tidak memenuhi aturan di atas diabaikan.

Aturan `answer_key`:

- Hurufnya harus salah satu kunci di `options`. Besar-kecil huruf dan spasi diabaikan.
- Yang menentukan hanya hurufnya. Teks kunci di system prompt diambil dari `options`.
- Nilai `null` sama dengan tidak mengirim kunci.

**Tanpa kunci jawaban**

```json
{
  "question": "Who was the first person to walk on the Moon, in 1969?",
  "options": {
    "a": "Neil Armstrong",
    "b": "John Glenn",
    "c": "Buzz Aldrin",
    "d": "Yuri Gagarin"
  }
}
```

**Dengan kunci jawaban**

```json
{
  "question": "Who was the first person to walk on the Moon, in 1969?",
  "options": {
    "a": "Neil Armstrong",
    "b": "John Glenn",
    "c": "Buzz Aldrin",
    "d": "Yuri Gagarin"
  },
  "answer_key": "a"
}
```

`"answer_key": {"a": "Neil Armstrong"}` memberi hasil yang sama.

### Response `200`

```json
{
  "answer": "a",
  "answer_text": "Neil Armstrong",
  "answer_key": "a",
  "raw": "a) Neil Armstrong",
  "latency_ms": 48
}
```

| Field | Tipe | Keterangan |
|---|---|---|
| `answer` | string atau null | Huruf jawaban model. `null` jika jawaban tidak terbaca (hanya mungkin bila `USE_GRAMMAR=false`) |
| `answer_text` | string atau null | Teks opsi yang dipilih |
| `answer_key` | string atau null | Huruf kunci yang dipakai di system prompt. `null` jika request dikirim tanpa kunci |
| `raw` | string | Output asli model |
| `latency_ms` | number | Waktu proses dalam milidetik |

> Model tidak selalu mengikuti `answer_key`. Pada uji 1060 soal, jawabannya sama dengan kunci di 97,6% soal. Selalu baca `answer`; jangan menganggap `answer` sama dengan `answer_key`.

### Response error

Body error selalu berbentuk:

```json
{ "error": "<pesan>" }
```

| Status | Kondisi | `error` |
|---|---|---|
| `400` | `question` kosong atau bukan teks | `Field 'question' wajib berupa teks.` |
| `400` | `question` lebih dari 2000 karakter | `Field 'question' maksimal 2000 karakter.` |
| `400` | Opsi valid kurang dari 2 | `Field 'options' wajib berisi minimal 2 opsi, contoh: {"a": "...", "b": "..."}.` |
| `400` | `answer_key` tidak valid | `Field 'answer_key' harus berupa huruf salah satu opsi, contoh: "c" atau {"c": "..."}.` |
| `503` | Antrean penuh (`MAX_QUEUE`, default 50) | `Server sedang sibuk, coba lagi sebentar.` |
| `500` | Gagal saat model memproses | `Gagal memproses pertanyaan.` |

---

## `GET /health`

Tidak ada payload.

### Response `200`

```json
{
  "status": "ok",
  "model": "qwen2.5-0.5b-instruct-q8_0.gguf",
  "queue": 0
}
```

| Field | Tipe | Keterangan |
|---|---|---|
| `status` | string | Selalu `"ok"` jika server berjalan |
| `model` | string | Nilai `MODEL_URI` |
| `queue` | number | Jumlah request `/ask` yang sedang diproses atau mengantre |

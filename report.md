# Report Uji Akurasi — 100 soal acak dari `questions.jsonl`

Tanggal uji: 2026-11-03 02:53:31 UTC  
Endpoint: `POST http://localhost:3009/ask`  
Model: `qwen2.5-0.5b-instruct-q8_0.gguf` (Qwen2.5-0.5B-Instruct, GGUF resmi dari Qwen, Q8_0, file lokal via `.env`, GPU Metal — default `getLlama()` di macOS)  
Pengaturan: `USE_GRAMMAR=true` (default), `temperature: 0`, `MAX_TOKENS=32`  
Mesin: Apple M5, 10 core, darwin arm64, Node v24.14.1

**Sampel acak:** 100 soal diambil acak dari `questions.jsonl` (600 soal) dengan seed `329010894`. Nomor baris di file sumber, sesuai urutan # di report: 400, 258, 20, 137, 467, 161, 340, 496, 408, 477, 439, 336, 99, 138, 309, 382, 445, 162, 229, 516, 435, 255, 394, 259, 539, 67, 106, 329, 235, 351, 231, 154, 456, 561, 15, 165, 488, 570, 464, 480, 418, 148, 395, 12, 577, 396, 514, 485, 63, 283, 80, 546, 441, 19, 362, 282, 31, 497, 112, 482, 334, 386, 34, 285, 473, 21, 26, 103, 454, 533, 179, 501, 491, 449, 409, 98, 356, 381, 428, 339, 557, 399, 104, 200, 18, 578, 455, 220, 552, 421, 520, 7, 291, 523, 422, 333, 64, 560, 379, 222. Sampel ini **sama persis** dengan uji model SmolLM2 sebelumnya.

Setiap baris dikirim **apa adanya** sebagai body request (termasuk `id`, `category`, `answer`, dan `options` berbentuk array), berurutan, setelah satu request pemanasan yang tidak dihitung. Latensi adalah `latency_ms` dari server.

## Ringkasan

| Metrik | Nilai |
|---|---|
| Total soal | 100 |
| Huruf berbeda yang dipakai model | 4 dari 4 (a=47, b=13, c=25, d=15) |
| **Akurasi** (`answer` = kunci) | **56 / 100 (56.0%)** |
| Interval kepercayaan 95% (Wilson) | 46.2% – 65.3% |
| Baseline tebakan acak (4 opsi) | 25.0% |
| Skor jika selalu menjawab **a** (huruf favorit model) | 25 / 100 (25.0%) |
| Format patuh (`answer` tidak `null`) | 100 / 100 (100.0%) |
| `raw` persis `huruf) teks opsi` | 100 / 100 |
| Respons HTTP 200 | 100 / 100 |
| Latensi rata-rata | 46 ms |
| Latensi p50 / p95 / maks | 46 / 60 / 99 ms |
| Waktu total (berurutan) | 4.7 s |

## Temuan

- **Akurasi 56.0%** (56/100), **di atas** baseline tebakan acak 25%: interval kepercayaan 95% 46–65% tidak mencakup 25%. Requirement belum mencantumkan angka akurasi untuk model ini.
- **Bias posisi kuat:** model memilih a=47, b=13, c=25, d=15, sedangkan kunci a=25, b=27, c=20, d=28. Dari 56 jawaban benar, 21 adalah soal berkunci **a**; di luar huruf **a**, model benar 35 dari 53 kali (66.0%).
- **Akurasi per huruf kunci:** a 21/25 (84.0%), b 10/27 (37.0%), c 12/20 (60.0%), d 13/28 (46.4%). Jawaban benar tidak hanya berasal dari huruf **a**.
- **Per kategori:** tertinggi History (11/15), terendah Sports (10/23). Tiap kategori hanya ~17 soal, jadi selisih antarkategori belum bermakna.
- **Semua 600 soal mengonfirmasi hasilnya:** akurasi 348/600 (**58.0%**, interval kepercayaan 95% 54–62%), jauh di atas 25%. Per kategori: History 76%, Science 70%, Politics 57%, Music 50%, Sports 48%, Movie 47%.
- **Masih ada bias ke a dan c, tapi pilihannya terkait dengan kunci:** di 600 soal model memilih a=244, b=76, c=200, d=80. Saat memilih **b** ia benar 66/76 kali (87%) dan saat memilih **d** 64/80 (80%), sedangkan saat memilih **a** hanya 113/244 (46%) dan **c** 105/200 (53%). Artinya a dan c menjadi tebakan default saat model tidak yakin, sedangkan b dan d hanya dipilih saat yakin. Akibatnya soal berkunci b dan d lebih sering salah (benar 44% dan 43%) dibanding a (75%) dan c (70%).
- **Dibanding SmolLM2 pada 100 soal yang sama:** 135M dasar 30%, 135M fine-tuning 27%, 360M 28%, **Qwen2.5-0.5B 56%**. Qwen satu-satunya yang jelas di atas tebakan acak. Ini sesuai peringatan di requirement bahwa Qwen tahu lebih banyak, jadi model ini **tidak cocok** kalau tujuannya model yang minim pengetahuan.
- **Paling lambat:** rata-rata 46–52 ms per soal di beberapa run, dibanding sekitar 33 ms untuk SmolLM2-360M dan 20 ms untuk 135M di mesin yang sama.
- **Format patuh 100.0%:** grammar membuat setiap output persis salah satu opsi (`raw` sama persis dengan `huruf) teks` pada 100/100 soal), jadi tidak ada `null`, salah baca parser, atau huruf/teks yang bertentangan.
- **Layanan stabil dan cepat:** 100/100 HTTP 200, rata-rata 46 ms per soal, 100 soal selesai dalam 4.7 detik.

## Per kategori

| Kategori | Soal | Benar | Akurasi |
|---|---:|---:|---:|
| History | 15 | 11 | 73.3% |
| Movie | 21 | 10 | 47.6% |
| Music | 11 | 5 | 45.5% |
| Politics | 17 | 11 | 64.7% |
| Science | 13 | 9 | 69.2% |
| Sports | 23 | 10 | 43.5% |

## Distribusi huruf

| | a | b | c | d |
|---|---:|---:|---:|---:|
| Jawaban model | 47 | 13 | 25 | 15 |
| Kunci jawaban | 25 | 27 | 20 | 28 |
| Benar (kunci = huruf ini) | 21 | 10 | 12 | 13 |

## Detail per soal

| # | ID | Kategori | Pertanyaan | Kunci | Jawaban model | | ms |
|---:|---|---|---|---|---|:-:|---:|
| 1 | `EYJYVwwuscx6` | Sports | In baseball, how many strikes does it take for a batter to strike out? | **b** · 3 | **a** · 4 | ❌ | 36 |
| 2 | `bcUa5Bgc4oC3` | Music | In music, what does the tempo marking 'Allegro' mean? | **c** · Fast and lively | **c** · Fast and lively | ✅ | 48 |
| 3 | `JgETdCUgpwKZ` | Music | Who composed the classic Indonesian song 'Bengawan Solo'? | **a** · Gesang | **c** · Ismail Marzuki | ❌ | 58 |
| 4 | `TOgWjfZgedV5` | Movie | Which Pixar film features a lonely trash-compacting robot left behind on an abandoned Earth? | **c** · WALL-E | **c** · WALL-E | ✅ | 44 |
| 5 | `IY0LwuMmYx9O` | Science | Which force keeps the planets in orbit around the Sun? | **d** · Gravity | **d** · Gravity | ✅ | 30 |
| 6 | `Pk4E9bRVbTL3` | Science | What is the largest mammal on Earth? | **c** · Blue whale | **d** · Sperm whale | ❌ | 46 |
| 7 | `e4UkYJZ2cSyo` | Music | Which Beatles album cover shows the band walking across a zebra crossing? | **d** · Abbey Road | **c** · Help! | ❌ | 47 |
| 8 | `hHsgstLNTdQq` | Movie | Which film won the very first Academy Award for Best Picture, presented in 1929? | **b** · Wings | **a** · Metropolis | ❌ | 40 |
| 9 | `zpgoDIOVy3ga` | Politics | What is the elected lower house of the UK Parliament called? | **d** · House of Commons | **d** · House of Commons | ✅ | 46 |
| 10 | `eTehWphR0ei8` | Science | Who first used a telescope to observe the four largest moons of Jupiter, in 1610? | **d** · Galileo Galilei | **a** · Tycho Brahe | ❌ | 51 |
| 11 | `rARztZSBwLln` | Sports | What does the abbreviation NBA stand for? | **d** · National Basketball Association | **d** · National Basketball Association | ✅ | 47 |
| 12 | `8DbC5HcmLDTI` | History | Who introduced printing with movable metal type to Europe around 1440? | **c** · Johannes Gutenberg | **c** · Johannes Gutenberg | ✅ | 40 |
| 13 | `sxptlyhiBfw5` | Science | Which subatomic particle carries a negative electric charge? | **a** · Electron | **a** · Electron | ✅ | 30 |
| 14 | `WxO9kbFfZ9OF` | History | In which year did the American Civil War end? | **a** · 1865 | **c** · 1861 | ❌ | 57 |
| 15 | `0DyBdpdcwaET` | Politics | Who wrote the political treatise 'The Prince'? | **b** · Niccolò Machiavelli | **c** · Thomas Hobbes | ❌ | 55 |
| 16 | `P5IzxHRu796U` | Sports | What was the name of the original FIFA World Cup trophy, named after a former FIFA president? | **a** · Jules Rimet Trophy | **a** · Jules Rimet Trophy | ✅ | 58 |
| 17 | `UBVvvJFTfr0C` | Sports | Which Indonesian player won the women's singles badminton gold at the 1992 Barcelona Olympics? | **c** · Susi Susanti | **a** · Mia Audina | ❌ | 46 |
| 18 | `DlGwmNYUdwiK` | Music | Which composer wrote the piano piece 'Clair de lune'? | **d** · Claude Debussy | **c** · Maurice Ravel | ❌ | 53 |
| 19 | `4O5LRY2Uy1Xf` | Music | What is a composition for a solo instrument accompanied by an orchestra called? | **a** · Concerto | **a** · Concerto | ✅ | 35 |
| 20 | `ykA6gp3OX5eL` | Sports | What is the highest possible score in a game of ten-pin bowling? | **d** · 300 | **a** · 200 | ❌ | 51 |
| 21 | `u2QWQEqUyxwL` | Sports | Who was the first gymnast to score a perfect 10 at the Olympic Games, in 1976? | **c** · Nadia Comăneci | **c** · Nadia Comăneci | ✅ | 57 |
| 22 | `aSu9fb4SRB35` | History | Thailand was known by which name until 1939? | **d** · Siam | **c** · Champa | ❌ | 42 |
| 23 | `z5ZCgMbwBqZA` | Science | Which Indonesian volcano's 1815 eruption is the largest in recorded history? | **d** · Mount Tambora | **c** · Mount Agung | ❌ | 46 |
| 24 | `bc7nkPGOiwBn` | Sports | In chess, which piece can move only diagonally? | **a** · Bishop | **a** · Bishop | ✅ | 42 |
| 25 | `anB9grTTaA3a` | Sports | The Thomas Cup is the men's world team championship of which sport? | **c** · Badminton | **a** · Table tennis | ❌ | 47 |
| 26 | `eAtDXYuVQj0Z` | Science | What is the pH of pure water at 25 °C? | **d** · 7 | **d** · 7 | ✅ | 46 |
| 27 | `yfsvxWBdwuwg` | History | Which Russian ruler founded the city of St. Petersburg in 1703? | **a** · Peter the Great | **a** · Peter the Great | ✅ | 46 |
| 28 | `35Eb6L9viDq3` | Politics | 'Taoiseach' is the title of the head of government in which country? | **d** · Ireland | **d** · Ireland | ✅ | 42 |
| 29 | `V9VQpNeOY545` | Politics | The Bundestag is the federal parliament of which country? | **c** · Germany | **c** · Germany | ✅ | 36 |
| 30 | `mR0E8ZlHqIWx` | Movie | What is the name of the toy space ranger in 'Toy Story'? | **a** · Buzz Lightyear | **c** · Rex | ❌ | 35 |
| 31 | `BWqK2B9CO9a9` | History | Who founded the Mongol Empire in 1206? | **b** · Genghis Khan | **c** · Kublai Khan | ❌ | 51 |
| 32 | `t9DvZLw3vbiz` | History | Which Javanese prince led the Java War (1825-1830) against Dutch colonial rule? | **c** · Prince Diponegoro | **c** · Prince Diponegoro | ✅ | 58 |
| 33 | `uoldOq0OyQNz` | Politics | Who shared the 1993 Nobel Peace Prize with Nelson Mandela? | **d** · F. W. de Klerk | **b** · Desmond Tutu | ❌ | 47 |
| 34 | `YVhX0nSHpiy1` | Sports | Which country won the 2022 FIFA World Cup in Qatar? | **a** · Argentina | **a** · Argentina | ✅ | 36 |
| 35 | `vejlBDyBnn3k` | Sports | The ancient Olympic Games originated in which country? | **a** · Greece | **a** · Greece | ✅ | 30 |
| 36 | `i3OWidNqV5nN` | Science | In which layer of the atmosphere is most of the ozone layer found? | **d** · Stratosphere | **d** · Stratosphere | ✅ | 45 |
| 37 | `XHmE5flelD9U` | Sports | Which sport is played with a shuttlecock? | **c** · Badminton | **a** · Table tennis | ❌ | 41 |
| 38 | `R1t1xZ8VE7m5` | Movie | Dom Toretto is the main character of which action film franchise? | **a** · The Fast and the Furious | **a** · The Fast and the Furious | ✅ | 57 |
| 39 | `NhPTxX1bQfKO` | Movie | Which director made both 'Vertigo' (1958) and 'Psycho' (1960)? | **c** · Alfred Hitchcock | **c** · Alfred Hitchcock | ✅ | 46 |
| 40 | `07gccPjjMbaD` | Sports | How long is each half of a professional football match? | **a** · 45 minutes | **a** · 45 minutes | ✅ | 46 |
| 41 | `pZVKVN81nR3u` | History | On which ship did Charles Darwin make his famous voyage of discovery (1831-1836)? | **b** · HMS Beagle | **b** · HMS Beagle | ✅ | 45 |
| 42 | `fII03HoOsKSw` | Science | Which planet rotates on its side, with an axial tilt of about 98 degrees? | **c** · Uranus | **c** · Uranus | ✅ | 40 |
| 43 | `g25irGnrTFXT` | Movie | Which actor played Superman in the 1978 film 'Superman'? | **b** · Christopher Reeve | **a** · Brandon Routh | ❌ | 46 |
| 44 | `O0hz9foERsrc` | History | Which ancient Greek city-state was famous for its strict military society? | **d** · Sparta | **d** · Sparta | ✅ | 41 |
| 45 | `0PB7Y2G9igJY` | Sports | Which team won the first Cricket World Cup in 1975? | **b** · West Indies | **c** · England | ❌ | 35 |
| 46 | `tVf2YZO67JZP` | Movie | What is the name of the tall, blue-skinned native people in 'Avatar' (2009)? | **b** · Na'vi | **b** · Na'vi | ✅ | 47 |
| 47 | `g3ypAL6iwVNH` | Sports | In which sport would an athlete perform a 'triple axel'? | **b** · Figure skating | **a** · Gymnastics | ❌ | 40 |
| 48 | `CX1wytDqqe2a` | Politics | Who chaired the UN commission that drafted the Universal Declaration of Human Rights? | **a** · Eleanor Roosevelt | **a** · Eleanor Roosevelt | ✅ | 48 |
| 49 | `7dJyohhXJOwi` | Sports | In basketball, how many points is a field goal made from behind the arc worth? | **b** · 3 | **a** · 4 | ❌ | 35 |
| 50 | `Wm4GrU1fNwty` | History | Which explorer led the first expedition to sail around the world (1519-1522), though he died before it ended? | **d** · Ferdinand Magellan | **d** · Ferdinand Magellan | ✅ | 52 |
| 51 | `WL2dJinvVNbV` | Science | Which space telescope, launched in 2021, is considered the successor to Hubble? | **d** · James Webb Space Telescope | **d** · James Webb Space Telescope | ✅ | 52 |
| 52 | `hIGOLT9N6Sdv` | Sports | How many points is a try worth in rugby union? | **a** · 5 | **a** · 5 | ✅ | 40 |
| 53 | `T7Ag0yexi6KL` | Movie | Anthony Hopkins won the Best Actor Oscar for playing Hannibal Lecter in which film? | **d** · The Silence of the Lambs | **d** · The Silence of the Lambs | ✅ | 61 |
| 54 | `P9dONtRBv8lg` | Politics | The Cortes Generales is the national parliament of which country? | **b** · Spain | **a** · Mexico | ❌ | 35 |
| 55 | `39BJSbe1mcTA` | Music | Reggae music originated in which country? | **b** · Jamaica | **b** · Jamaica | ✅ | 30 |
| 56 | `TkGAfeMgRoGL` | Movie | What is the name of the commercial spaceship in 'Alien' (1979)? | **a** · Nostromo | **a** · Nostromo | ✅ | 45 |
| 57 | `Yxfpo9CrZu7s` | Politics | Which Indonesian president was an aeronautical engineer who had worked in Germany's aircraft industry? | **b** · B. J. Habibie | **c** · Abdurrahman Wahid | ❌ | 68 |
| 58 | `JlGq90KOcDbi` | Movie | What is the name of the young lion who is the hero of Disney's 'The Lion King' (1994)? | **d** · Simba | **a** · Mufasa | ❌ | 47 |
| 59 | `TDISx212k1Aj` | Sports | Which German driver won seven Formula One World Championships, including five in a row with Ferrari? | **d** · Michael Schumacher | **a** · Nico Rosberg | ❌ | 45 |
| 60 | `8VCgDsIMBSU4` | Movie | Which actor played Tony Stark / Iron Man in the Marvel Cinematic Universe? | **c** · Robert Downey Jr. | **a** · Chris Hemsworth | ❌ | 47 |
| 61 | `btAqpxEq4fkt` | Movie | Which actor won back-to-back Best Actor Oscars for 'Philadelphia' and 'Forrest Gump'? | **a** · Tom Hanks | **c** · Daniel Day-Lewis | ❌ | 51 |
| 62 | `aQmmKfW8b0Mf` | Music | Which rock singer is nicknamed 'The Boss'? | **d** · Bruce Springsteen | **a** · Tom Petty | ❌ | 48 |
| 63 | `NVmCypcEaMdF` | Politics | Which principal judicial organ of the United Nations settles legal disputes between states? | **b** · International Court of Justice | **b** · International Court of Justice | ✅ | 51 |
| 64 | `FhJG9SLqsPLC` | Movie | Tom Cruise plays agent Ethan Hunt in which film franchise? | **b** · Mission: Impossible | **b** · Mission: Impossible | ✅ | 51 |
| 65 | `Cds7s71rHE3S` | Science | What is the change of a solid directly into a gas, without becoming a liquid, called? | **a** · Sublimation | **a** · Sublimation | ✅ | 40 |
| 66 | `9aGHQ0iASmUa` | Politics | Which Indonesian body organizes the country's general elections? | **b** · Komisi Pemilihan Umum (KPU) | **b** · Komisi Pemilihan Umum (KPU) | ✅ | 94 |
| 67 | `rBQU4M2RyAhP` | Movie | Which actor played the Joker in 'The Dark Knight' (2008)? | **b** · Heath Ledger | **a** · Jack Nicholson | ❌ | 41 |
| 68 | `R2zoobH9bRLX` | Politics | In which year was NATO founded? | **a** · 1949 | **a** · 1949 | ✅ | 51 |
| 69 | `REi0vGOYSrE7` | Sports | Which Indonesian pair won the mixed doubles badminton gold at the 2016 Summer Olympics? | **c** · Tontowi Ahmad and Liliyana Natsir | **c** · Tontowi Ahmad and Liliyana Natsir | ✅ | 99 |
| 70 | `wrrlkHdrZtZZ` | History | Which Spanish conquistador led the conquest of the Aztec Empire? | **d** · Hernán Cortés | **b** · Francisco Pizarro | ❌ | 51 |
| 71 | `PMyMlPEfj6u1` | Politics | What is government by a small, privileged group of people called? | **b** · Oligarchy | **b** · Oligarchy | ✅ | 45 |
| 72 | `TxSECxIoNzm0` | Music | Which singer released the 1984 album 'Like a Virgin'? | **d** · Madonna | **a** · Janet Jackson | ❌ | 46 |
| 73 | `VWI2oOtdj63D` | Movie | Mr. Incredible and Elastigirl are the parents in which animated film? | **b** · The Incredibles | **b** · The Incredibles | ✅ | 50 |
| 74 | `KkABzrhZNf0O` | Politics | In which year was the United Nations founded? | **d** · 1945 | **a** · 1950 | ❌ | 51 |
| 75 | `HxXPgRz0RhFV` | Politics | How long is a single term for the President of the United States? | **a** · 4 years | **a** · 4 years | ✅ | 46 |
| 76 | `BMTbwSep75xx` | History | Which trading company, founded in 1602, dominated the spice trade in the East Indies? | **a** · VOC (Dutch East India Company) | **a** · VOC (Dutch East India Company) | ✅ | 71 |
| 77 | `OZgTpAGtQn3p` | Movie | Which actress won a record four Academy Awards for Best Actress? | **b** · Katharine Hepburn | **a** · Bette Davis | ❌ | 46 |
| 78 | `E7bVs95LSX0j` | History | Who was President of the United States during the American Civil War? | **d** · Abraham Lincoln | **d** · Abraham Lincoln | ✅ | 35 |
| 79 | `jEjF79Sum271` | Music | The pop group ABBA came from which country? | **a** · Sweden | **a** · Sweden | ✅ | 31 |
| 80 | `kQ3WOtuJswZD` | History | The largest pyramid at Giza was built for which pharaoh? | **c** · Khufu | **c** · Khufu | ✅ | 45 |
| 81 | `eCYIvOE9q7uG` | Music | How many lines make up a standard musical staff? | **b** · 5 | **a** · 6 | ❌ | 36 |
| 82 | `kToy803aOeOR` | Science | What is the chemical symbol for gold? | **c** · Au | **c** · Au | ✅ | 36 |
| 83 | `vVZjHtQxhQGL` | Sports | Which Indonesian legend won the All England men's singles badminton title eight times? | **c** · Rudy Hartono | **d** · Taufik Hidayat | ❌ | 60 |
| 84 | `PJNWTZO2wO5G` | History | Which of the Seven Wonders of the Ancient World stood in the city of Alexandria? | **a** · The Pharos lighthouse | **a** · The Pharos lighthouse | ✅ | 56 |
| 85 | `Rqxysy7fYsFF` | Sports | How many holes are played in a standard round of golf? | **c** · 18 | **a** · 12 | ❌ | 40 |
| 86 | `HEECfcJan2hn` | Music | Which musical term means gradually getting louder? | **a** · Crescendo | **a** · Crescendo | ✅ | 40 |
| 87 | `OU5WRRhv6QqO` | Movie | Which film won the first-ever Academy Award for Best Animated Feature, in 2002? | **b** · Shrek | **c** · Monsters, Inc. | ❌ | 57 |
| 88 | `JaZJV2cyaLCv` | Politics | A government in which one person holds absolute power is called what? | **b** · Autocracy | **b** · Autocracy | ✅ | 40 |
| 89 | `z1pRvKTnqyA1` | Science | Which organ produces the hormone insulin? | **a** · Pancreas | **a** · Pancreas | ✅ | 40 |
| 90 | `Uq8SaLrYPmRZ` | Movie | Who directed 'Inception' (2010)? | **b** · Christopher Nolan | **a** · David Fincher | ❌ | 45 |
| 91 | `yc0k2hSPNemZ` | Movie | Who directed 'Taxi Driver' (1976)? | **b** · Martin Scorsese | **a** · Sidney Lumet | ❌ | 45 |
| 92 | `NspU9sRvjcqu` | Movie | In 'Finding Nemo' (2003), what kind of fish is Nemo? | **d** · Clownfish | **d** · Clownfish | ✅ | 47 |
| 93 | `SRTOVsLjszKF` | Science | Which element has the atomic number 6? | **b** · Carbon | **a** · Nitrogen | ❌ | 36 |
| 94 | `70SR1AzSwFJh` | Sports | Which country hosted the 2010 FIFA World Cup, the first held in Africa? | **d** · South Africa | **a** · Morocco | ❌ | 36 |
| 95 | `FHuxBznAw5Zh` | Movie | The film industry nicknamed 'Bollywood' is based in which country? | **d** · India | **d** · India | ✅ | 35 |
| 96 | `rjoVnwUOxgQt` | Politics | How many electoral votes does a candidate need to win the U.S. presidency? | **a** · 270 | **a** · 270 | ✅ | 51 |
| 97 | `HtC10YRQvUaW` | History | Who became the first human to travel into space, in 1961? | **b** · Yuri Gagarin | **b** · Yuri Gagarin | ✅ | 57 |
| 98 | `QYB6hO78klIT` | Sports | Indonesia's Mandalika MotoGP circuit is located on which island? | **d** · Lombok | **b** · Bali | ❌ | 36 |
| 99 | `EIarIB8hUs99` | Politics | What is the name of the U.S. President's country retreat in Maryland? | **c** · Camp David | **a** · Blair House | ❌ | 41 |
| 100 | `iYidALSYoUno` | Sports | Which American became World Chess Champion in 1972 by defeating Boris Spassky? | **c** · Bobby Fischer | **c** · Bobby Fischer | ✅ | 41 |

Keterangan: ✅ benar · ❌ salah · ∅ tidak terbaca (`null`) · ⚠️ error HTTP. Kolom *raw* tidak ditampilkan karena dengan grammar isinya selalu sama dengan *Jawaban model*.

## Catatan

- `questions.jsonl` identik dengan dataset fine-tuning `laskar-ks/trivia-questions`. Qwen2.5 tidak dilatih khusus dengan dataset ini; akurasinya berasal dari pengetahuan umum hasil pretraining.
- Server berjalan di port 3009 (bukan 3002 seperti contoh di `third-requirement-qwen-version.md`).
- Saat model dimuat, log menampilkan peringatan llama.cpp `control-looking token: 128247 '</s>' was not control-type`. Ini pesan bawaan untuk file GGUF Qwen dan tidak memengaruhi jawaban.
- Decoding greedy (`temperature: 0`): seed dan nomor baris di atas cukup untuk mengulang uji ini dengan hasil yang sama.

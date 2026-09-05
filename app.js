/* ==================================================================== *
 *  Coffeerence — coffee と coherence。淹れ方と味を記録し、注ぐ
 *  タイミングを知らせるタイマーを持つ、コーヒーの記録帳。
 *
 *  作りは意図的に素朴に保っている。ビルド工程を持たず、index.html から
 *  この1ファイルを読むだけで動く。
 *
 *  記録はこの端末の IndexedDB にだけ置く。アカウントも、送信先の
 *  サーバも持たない。淹れた記録がどこかへ流れていくことはない。
 *  持ち出すときは、設定からCSVで書き出す。
 *
 *   1. 下ごしらえ（定数・小道具）
 *   2. IndexedDB
 *   3. 設定
 *   4. レシピと記録（読み書き）
 *   5. 音（チャイム・読み上げ）
 *   6. タイマー
 *   7. 画面 — 淹れる／タイマー／記録／詳細／記録の編集／レシピ／設定
 *   8. 起動
 * ==================================================================== */

const APP_VERSION = "1.2.0";

/* ホームのロゴの下に #002 の形で出す、mainへマージした回数。
   マージのたびに1つ増やす（この見た目になるまでに何回積んだか） */
const MERGE_COUNT = 3;

/* ------------------------------------------------------------------ *
 * 1. 下ごしらえ
 * ------------------------------------------------------------------ */
const $  = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* 秒 → 3:05 の形。タイマーの表示にも記録の表示にも使う */
function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* "3:05" も "185" も秒として読む。空欄は null（未入力と0を区別する） */
function parseClock(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mm = Number(m) || 0;
    const ss = Number(s) || 0;
    return mm * 60 + ss;
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtDate(ms) {
  const d = new Date(ms);
  const w = "日月火水木金土"[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}
function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} `
       + `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/* <input type="datetime-local"> は端末のローカル時刻の文字列を欲しがる */
function toLocalInput(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(text) {
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function ratioText(doseG, waterG) {
  const d = num(doseG), w = num(waterG);
  if (!d || !w) return "—";
  return `1:${(w / d).toFixed(1).replace(/\.0$/, "")}`;
}

function starsHtml(n) {
  const filled = Math.round(num(n, 0) || 0);
  let out = "";
  for (let i = 1; i <= 5; i++) out += i <= filled ? "★" : '<span class="off">★</span>';
  return out;
}

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* 消す操作の前に一度だけ訊く。confirm() はPWAだと素っ気ないので自前 */
function confirmAsk(text) {
  return new Promise((resolve) => {
    const backdrop = $("confirm-backdrop");
    $("confirm-text").textContent = text;
    backdrop.hidden = false;
    const close = (answer) => {
      backdrop.hidden = true;
      $("confirm-yes").onclick = null;
      $("confirm-no").onclick = null;
      backdrop.onclick = null;
      resolve(answer);
    };
    $("confirm-yes").onclick = () => close(true);
    $("confirm-no").onclick = () => close(false);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
  });
}

/* ------------------------------------------------------------------ *
 * 2. IndexedDB
 *    レシピ・記録・設定を置く。全部合わせても小さいので、起動時に
 *    まとめてメモリへ読み込み、以降は同期的に扱う。
 * ------------------------------------------------------------------ */
/* 名前は BrewNote 時代のまま。ここを変えると、すでに端末に入っている
   記録が別の入れ物に取り残されてしまう。外から見える名前ではない */
const DB_NAME = "brewnote";
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("recipes")) db.createObjectStore("recipes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("brews"))   db.createObjectStore("brews",   { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv"))      db.createObjectStore("kv",      { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbPutMany(store, values) {
  if (!values.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    values.forEach((v) => os.put(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function kvGet(k, fallback = null) {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction("kv", "readonly").objectStore("kv").get(k);
    req.onsuccess = () => resolve(req.result ? req.result.v : fallback);
    req.onerror = () => resolve(fallback);
  });
}
const kvSet = (k, v) => idbPut("kv", { k, v });

/* ------------------------------------------------------------------ *
 * 3. 設定
 * ------------------------------------------------------------------ */
const DEFAULT_SETTINGS = {
  chime: true,       // 手順の時刻にチーンと鳴らす
  precue: true,      // 3秒前に小さく予告する
  voice: true,       // 声で手順を読み上げる
  vibe: true,        // 対応端末でバイブ
  wakelock: true,    // タイマー中は画面を消さない
  volume: 70,
  theme: "auto",
};
let settings = { ...DEFAULT_SETTINGS };

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
  const dark = settings.theme === "dark"
    || (settings.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#101711" : "#1F6F63");
}

async function saveSettings() {
  await kvSet("settings", settings);
}

/* ------------------------------------------------------------------ *
 * 4. レシピと記録
 *    どちらも「消したこと」自体を updatedAt 付きで残す（deleted）。
 *    そうしないと、別の端末から消した記録が同期のたびに蘇ってしまう。
 * ------------------------------------------------------------------ */
let recipes = [];   // 削除済みも含む生の配列
let brews = [];

const liveRecipes = () => recipes.filter((r) => !r.deleted).sort((a, b) => (b.usedAt || b.createdAt) - (a.usedAt || a.createdAt));
const liveBrews   = () => brews.filter((b) => !b.deleted).sort((a, b) => b.brewedAt - a.brewedAt);
const findRecipe  = (id) => recipes.find((r) => r.id === id && !r.deleted) || null;
const findBrew    = (id) => brews.find((b) => b.id === id && !b.deleted) || null;

function emptyRecipe() {
  const now = Date.now();
  return {
    id: newId(), name: "", method: "V60", grind: "中細",
    doseG: 15, waterG: 240, tempC: 92,
    steps: [{ at: 0, kind: "pour", water: 45, label: "蒸らし", note: "" }],
    totalSec: 180, memo: "",
    createdAt: now, updatedAt: now, usedAt: 0, deleted: false,
  };
}

function emptyBrew() {
  const now = Date.now();
  return {
    id: newId(), brewedAt: now,
    bean: "", roaster: "", roast: "",
    method: "", grind: "", grinder: "",
    doseG: null, waterG: null, tempC: null, timeSec: null,
    recipeId: "", recipeName: "",
    taste: { acidity: 3, sweetness: 3, bitterness: 3, body: 3, aroma: 3 },
    rating: 0, flavors: [], notes: "", next: "",
    createdAt: now, updatedAt: now, deleted: false,
  };
}

async function saveRecipe(recipe) {
  recipe.updatedAt = Date.now();
  const i = recipes.findIndex((r) => r.id === recipe.id);
  if (i >= 0) recipes[i] = recipe; else recipes.push(recipe);
  await idbPut("recipes", recipe);
}

async function saveBrew(brew) {
  brew.updatedAt = Date.now();
  const i = brews.findIndex((b) => b.id === brew.id);
  if (i >= 0) brews[i] = brew; else brews.push(brew);
  await idbPut("brews", brew);
}

/* 削除は「墓標」を残す。中身は捨ててよいが、idと時刻は同期のために要る */
async function removeRecord(store, id) {
  const list = store === "recipes" ? recipes : brews;
  const rec = list.find((r) => r.id === id);
  if (!rec) return;
  rec.deleted = true;
  rec.updatedAt = Date.now();
  await idbPut(store, rec);
}

/* 最初に開いたときだけ入れる、よく知られたレシピ。
   使いながら自分の一杯へ寄せていくための出発点 */
function starterRecipes() {
  const now = Date.now();
  const mk = (name, method, grind, doseG, waterG, tempC, totalSec, steps, memo) => ({
    id: newId(), name, method, grind, doseG, waterG, tempC, totalSec, steps, memo,
    createdAt: now, updatedAt: now, usedAt: 0, deleted: false, starter: true,
  });
  return [
    mk("4:6メソッド", "V60", "中粗", 20, 300, 93, 210, [
      { at: 0,   kind: "pour", water: 60,  label: "1投目", note: "甘さを決める前半" },
      { at: 45,  kind: "pour", water: 120, label: "2投目", note: "" },
      { at: 90,  kind: "pour", water: 180, label: "3投目", note: "ここから後半・濃さを決める" },
      { at: 135, kind: "pour", water: 240, label: "4投目", note: "" },
      { at: 165, kind: "pour", water: 300, label: "5投目", note: "" },
      { at: 210, kind: "finish", water: 0, label: "落としきり", note: "" },
    ], "前半2投で甘さと酸味、後半3投で濃さを決める淹れ方。"),
    mk("V60 ふつうの一杯", "V60", "中細", 15, 240, 92, 165, [
      { at: 0,   kind: "pour", water: 45,  label: "蒸らし", note: "全体を湿らせて30秒待つ" },
      { at: 30,  kind: "pour", water: 150, label: "2投目", note: "中心から円を描く" },
      { at: 75,  kind: "pour", water: 240, label: "3投目", note: "" },
      { at: 165, kind: "finish", water: 0, label: "落としきり", note: "" },
    ], "迷ったらこれ。1:16 の素直な配合。"),
    mk("フレンチプレス", "フレンチプレス", "粗", 16, 260, 94, 270, [
      { at: 0,   kind: "pour",   water: 260, label: "一気に注ぐ", note: "粉全体に行き渡らせる" },
      { at: 60,  kind: "stir",   water: 0,   label: "泡を沈める", note: "表面をスプーンで軽く崩す" },
      { at: 240, kind: "plunge", water: 0,   label: "プランジャーを押す", note: "ゆっくり最後まで" },
      { at: 270, kind: "finish", water: 0,   label: "注ぎ分ける", note: "置きっぱなしにしない" },
    ], "浸けておくだけ。粗挽きで4分。"),
    mk("エアロプレス（標準）", "エアロプレス", "中細", 16, 220, 85, 150, [
      { at: 0,   kind: "pour",   water: 220, label: "注ぐ", note: "" },
      { at: 15,  kind: "stir",   water: 0,   label: "10回かき混ぜる", note: "" },
      { at: 90,  kind: "plunge", water: 0,   label: "押す", note: "30秒かけてゆっくり" },
      { at: 150, kind: "finish", water: 0,   label: "できあがり", note: "" },
    ], "湯温は低め。押す速さで表情が変わる。"),
    mk("アイス（急冷）", "V60", "中細", 20, 200, 93, 165, [
      { at: 0,   kind: "wait",   water: 0,   label: "氷100gをサーバーへ", note: "先に氷を入れておく" },
      { at: 10,  kind: "pour",   water: 60,  label: "蒸らし", note: "" },
      { at: 45,  kind: "pour",   water: 130, label: "2投目", note: "" },
      { at: 90,  kind: "pour",   water: 200, label: "3投目", note: "" },
      { at: 150, kind: "swirl",  water: 0,   label: "混ぜて急冷", note: "" },
      { at: 165, kind: "finish", water: 0,   label: "できあがり", note: "" },
    ], "湯200g＋氷100g。濃いめに落として一気に冷やす。"),
  ];
}

/* ------------------------------------------------------------------ *
 * 5. 音
 *    チャイムは音声ファイルを持たず、その場で合成する。オフラインでも
 *    鳴り、読み込み待ちで遅れることもない。
 *
 *    大事なのは「鳴る時刻の正確さ」。画面の更新は端末が背面に回ると
 *    止められてしまうので、音だけは先に Web Audio の時計へ予約して
 *    おく。予約済みの音は、こちらが眠っていても鳴る。
 * ------------------------------------------------------------------ */
let audioCtx = null;
let scheduledNodes = [];   // 予約済みの発振器（中断したら止める）

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

const volumeGain = () => Math.max(0, Math.min(1, (settings.volume ?? 70) / 100));

/* 金属が鳴るときの倍音は整数倍からずれている。そのずれを真似ると
   ピーではなく「チーン」に近づく */
function bellAt(when, base, dur, gain) {
  const ctx = audioCtx;
  const partials = [[1, 1], [2.01, 0.46], [2.98, 0.26], [4.17, 0.13], [5.43, 0.07]];
  for (const [mult, amp] of partials) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base * mult, when);
    /* 高い倍音ほど早く消える。これも本物の鐘のふるまい */
    const life = dur * (mult > 3 ? 0.45 : mult > 2 ? 0.7 : 1);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amp), when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + life);
    osc.connect(g).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + life + 0.05);
    scheduledNodes.push(osc);
  }
}

function blipAt(when, freq, gain) {
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
  osc.connect(g).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.14);
  scheduledNodes.push(osc);
}

/* kind: "step"（手順の合図）/ "finish"（できあがり）/ "cue"（予告） */
function scheduleSound(kind, when) {
  if (!ensureAudio()) return;
  const v = volumeGain();
  if (v <= 0) return;
  if (kind === "cue") { blipAt(when, 700, 0.09 * v); return; }
  if (kind === "finish") {
    bellAt(when,        932, 2.4, 0.30 * v);
    bellAt(when + 0.42, 932, 2.4, 0.26 * v);
    bellAt(when + 0.84, 1244, 3.0, 0.30 * v);
    return;
  }
  bellAt(when, 1046.5, 1.9, 0.32 * v);
}

function playSoundNow(kind) {
  if (!ensureAudio()) return;
  scheduleSound(kind, audioCtx.currentTime + 0.02);
}

function cancelScheduledSounds() {
  for (const osc of scheduledNodes) {
    try { osc.stop(0); } catch (err) { /* すでに鳴り終わっている */ }
  }
  scheduledNodes = [];
}

function speak(text) {
  if (!settings.voice || !text || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.05;
    u.volume = Math.max(0.2, volumeGain());
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (err) {
    console.warn("読み上げに失敗しました:", err);
  }
}

function buzz(pattern) {
  if (!settings.vibe || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (err) { /* 非対応 */ }
}

/* ------------------------------------------------------------------ *
 * 6. タイマー
 * ------------------------------------------------------------------ */
const KIND_LABEL = {
  pour: "注ぐ", wait: "待つ", stir: "混ぜる",
  swirl: "ゆらす", plunge: "押す", finish: "できあがり",
};

const timer = {
  recipe: null,      // null ならレシピなしの計測
  scale: 1,
  state: "idle",     // idle | running | paused | done
  baseMs: 0,         // 一時停止までに積んだ経過
  startedWall: 0,    // 走り出した時刻（Date.now）
  firedIdx: -1,      // ここまでの手順は画面・声で知らせ済み
  laps: [],
  rafId: 0,
  wakeLock: null,
  startedAt: 0,      // 記録に残すための「淹れ始めた時刻」
};

const timerElapsedMs = () =>
  timer.state === "running" ? timer.baseMs + (Date.now() - timer.startedWall) : timer.baseMs;

/* 粉量を変えたぶん、湯量も手順の目標量も一緒に伸び縮みさせる */
function scaledSteps() {
  const r = timer.recipe;
  if (!r) return [];
  const steps = (r.steps || [])
    .map((s) => ({
      ...s,
      water: s.water ? Math.round(s.water * timer.scale) : 0,
    }))
    .sort((a, b) => a.at - b.at);
  if (!steps.some((s) => s.kind === "finish")) {
    const last = steps.length ? steps[steps.length - 1].at : 0;
    steps.push({ at: Math.max(r.totalSec || 0, last + 30), kind: "finish", water: 0, label: "できあがり", note: "" });
  }
  return steps;
}

function timerTotalSec() {
  const steps = scaledSteps();
  if (!steps.length) return 0;
  return Math.max(timer.recipe?.totalSec || 0, steps[steps.length - 1].at);
}

const scaledDose  = () => Math.round((timer.recipe?.doseG || 0) * timer.scale * 10) / 10;
const scaledWater = () => Math.round((timer.recipe?.waterG || 0) * timer.scale);

/* 注ぐ手順だけを数えて「何投目か」を出す。回数を知らせるための土台 */
function pourIndex(steps, idx) {
  let n = 0;
  for (let i = 0; i <= idx; i++) if (steps[i].kind === "pour") n++;
  return n;
}
const pourTotal = (steps) => steps.filter((s) => s.kind === "pour").length;

function stepSpeech(step, steps, idx) {
  if (step.kind === "finish") return "できあがりです";
  if (step.kind === "pour") {
    const n = pourIndex(steps, idx);
    const total = pourTotal(steps);
    const head = step.label || `${n}投目`;
    return step.water ? `${head}。${step.water}グラムまで` : `${head}。あと${total - n}投`;
  }
  return step.label || KIND_LABEL[step.kind] || "次の手順";
}

/* 走り出す／再開するたびに、これから来る音を全部予約し直す */
function scheduleUpcomingSounds() {
  cancelScheduledSounds();
  if (!settings.chime || !timer.recipe) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const elapsed = timerElapsedMs() / 1000;
  const now = ctx.currentTime;
  for (const step of scaledSteps()) {
    const delay = step.at - elapsed;
    if (delay < 0) continue;
    scheduleSound(step.kind === "finish" ? "finish" : "step", now + delay);
    if (settings.precue && delay > 3.2 && step.kind !== "finish") {
      scheduleSound("cue", now + delay - 3);
    }
  }
}

async function acquireWakeLock() {
  if (!settings.wakelock || !("wakeLock" in navigator)) return;
  try {
    timer.wakeLock = await navigator.wakeLock.request("screen");
    timer.wakeLock.addEventListener("release", () => { timer.wakeLock = null; });
  } catch (err) {
    /* 電池が少ないなど、端末の都合で断られることがある。止める理由ではない */
    console.warn("画面の点灯を維持できませんでした:", err);
  }
}
function releaseWakeLock() {
  try { timer.wakeLock?.release(); } catch (err) { /* すでに解放済み */ }
  timer.wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && timer.state === "running") acquireWakeLock();
});

function openTimer(recipe) {
  stopTimerLoop();
  cancelScheduledSounds();
  releaseWakeLock();
  timer.recipe = recipe ? JSON.parse(JSON.stringify(recipe)) : null;
  timer.scale = 1;
  timer.state = "idle";
  timer.baseMs = 0;
  timer.firedIdx = -1;
  timer.laps = [];
  timer.startedAt = 0;
  $("timer-title").textContent = recipe ? recipe.name : "レシピなしで計る";
  renderTimerStatic();
  renderTimerLive();
  showScreen("timer");
}

function startTimer() {
  ensureAudio();                       // 最初の指で音を解禁しておく
  if (timer.state === "done") resetTimer();
  if (!timer.startedAt) timer.startedAt = Date.now();
  timer.state = "running";
  timer.startedWall = Date.now();
  scheduleUpcomingSounds();
  acquireWakeLock();
  startTimerLoop();
  renderTimerStatic();
}

function pauseTimer() {
  if (timer.state !== "running") return;
  timer.baseMs = timerElapsedMs();
  timer.state = "paused";
  cancelScheduledSounds();
  releaseWakeLock();
  stopTimerLoop();
  renderTimerStatic();
  renderTimerLive();
}

function resetTimer() {
  timer.state = "idle";
  timer.baseMs = 0;
  timer.firedIdx = -1;
  timer.laps = [];
  timer.startedAt = 0;
  cancelScheduledSounds();
  releaseWakeLock();
  stopTimerLoop();
  renderTimerStatic();
  renderTimerLive();
}

function finishTimer() {
  /* 画面が背面に回っていると、気づくのが数分後になることがある。
     記録に残す抽出時間は、レシピの合計時間で止めておく */
  const total = timerTotalSec() * 1000;
  timer.baseMs = timer.recipe ? Math.min(timerElapsedMs(), total) : timerElapsedMs();
  timer.state = "done";
  cancelScheduledSounds();
  releaseWakeLock();
  stopTimerLoop();
  buzz([120, 80, 120, 80, 220]);
  renderTimerStatic();
  renderTimerLive();
}

function startTimerLoop() {
  stopTimerLoop();
  const loop = () => {
    renderTimerLive();
    if (timer.state === "running") timer.rafId = requestAnimationFrame(loop);
  };
  timer.rafId = requestAnimationFrame(loop);
}
function stopTimerLoop() {
  if (timer.rafId) cancelAnimationFrame(timer.rafId);
  timer.rafId = 0;
}

/* 手順の時刻をまたいだ瞬間に、画面・声・振動で知らせる。
   （音そのものは先に予約済みなので、ここでは鳴らさない）
   背面に回っていた間に複数をまたいだときは、最後の1つだけ知らせる。
   3つ前の指示を今さら読み上げても混乱するだけなので */
function announceCrossedSteps(steps, elapsedSec) {
  let last = -1;
  for (let i = timer.firedIdx + 1; i < steps.length; i++) {
    if (steps[i].at <= elapsedSec) last = i; else break;
  }
  if (last < 0) return;
  timer.firedIdx = last;
  const step = steps[last];
  speak(stepSpeech(step, steps, last));
  buzz(step.kind === "finish" ? [120, 80, 120, 80, 220] : [90]);
  const flash = $("dial-flash");
  flash.classList.remove("ring");
  void flash.offsetWidth;              // アニメーションをやり直させる
  flash.classList.add("ring");
}

/* ------------------------------------------------------------------ *
 * 7. 画面
 * ------------------------------------------------------------------ */
const SCREEN_IDS = {
  brew: "screen-brew",
  timer: "screen-timer",
  log: "screen-log",
  "brew-detail": "screen-brew-detail",
  "brew-edit": "screen-brew-edit",
  recipes: "screen-recipes",
  "recipe-edit": "screen-recipe-edit",
  settings: "screen-settings",
};
const TAB_SCREENS = ["brew", "log", "recipes", "settings"];
const FULL_SCREENS = ["timer"];      // タブバーを隠す画面
let navStack = ["brew"];
let navSuppressHistory = false;

function showScreen(name, { replace = false } = {}) {
  const id = SCREEN_IDS[name];
  if (!id) return;
  for (const key of Object.keys(SCREEN_IDS)) {
    $(SCREEN_IDS[key]).classList.toggle("active", key === name);
  }
  if (TAB_SCREENS.includes(name)) navStack = [name];
  else if (replace) navStack[navStack.length - 1] = name;
  else if (navStack[navStack.length - 1] !== name) navStack.push(name);

  $("tabbar").classList.toggle("hidden", FULL_SCREENS.includes(name));
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.nav === name);
  }
  window.scrollTo(0, 0);
  if (!navSuppressHistory) history.pushState({ screen: name }, "");
}

function goBack() {
  if (navStack.length > 1) {
    navStack.pop();
    showScreen(navStack[navStack.length - 1], { replace: true });
  } else {
    showScreen("brew");
  }
}

/* ---------- 淹れる（ホーム） ---------- */
function renderHome() {
  const hour = new Date().getHours();
  $("greeting").textContent =
    hour < 5  ? "夜ふかしの一杯を" :
    hour < 11 ? "おはようございます。今日の一杯を" :
    hour < 17 ? "ひと息いれましょう" :
                "今日はどう淹れますか";

  renderStats($("home-stats"), liveBrews());

  const list = liveRecipes();
  const box = $("home-recipes");
  box.innerHTML = "";
  if (!list.length) {
    const empty = el("p", "empty-note", "レシピがまだありません。");
    box.appendChild(empty);
  }
  for (const r of list.slice(0, 4)) box.appendChild(recipeCard(r, false));

  const recent = liveBrews().slice(0, 3);
  $("home-recent-head").hidden = !recent.length;
  const rbox = $("home-recent");
  rbox.innerHTML = "";
  for (const b of recent) rbox.appendChild(brewItem(b));
}

function recipeCard(recipe, withEdit) {
  const card = el("button", "recipe-card");
  card.type = "button";
  const body = el("div", "rc-body");
  body.appendChild(el("div", "rc-name", recipe.name || "（名前なし）"));
  const meta = el("div", "rc-meta");
  const bits = [
    recipe.method || "",
    `${recipe.doseG}g / ${recipe.waterG}g`,
    ratioText(recipe.doseG, recipe.waterG),
    fmtClock(recipe.totalSec || 0),
  ].filter(Boolean);
  bits.forEach((t, i) => {
    if (i) meta.appendChild(el("span", "dot", "·"));
    meta.appendChild(el("span", null, t));
  });
  body.appendChild(meta);
  card.appendChild(body);

  if (withEdit) {
    const edit = el("span", "rc-edit");
    edit.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    edit.addEventListener("click", (e) => { e.stopPropagation(); openRecipeEditor(recipe.id); });
    card.appendChild(edit);
  }
  const go = el("span", "rc-go");
  go.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  card.appendChild(go);
  card.addEventListener("click", () => openTimer(recipe));
  return card;
}

function renderStats(box, list) {
  const now = new Date();
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const week = list.filter((b) => b.brewedAt >= weekAgo);
  const rated = list.filter((b) => b.rating > 0);
  const avg = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : 0;
  const methods = {};
  for (const b of list) if (b.method) methods[b.method] = (methods[b.method] || 0) + 1;
  const topMethod = Object.entries(methods).sort((a, b) => b[1] - a[1])[0];

  box.innerHTML = "";
  const cell = (num, unit, label) => {
    const s = el("div", "stat");
    const n = el("div", "stat-num");
    n.textContent = num;
    if (unit) n.appendChild(el("span", "small", unit));
    s.appendChild(n);
    s.appendChild(el("div", "stat-label", label));
    return s;
  };
  box.appendChild(cell(String(week.length), "杯", "この7日"));
  box.appendChild(cell(avg ? avg.toFixed(1) : "—", avg ? "★" : "", "平均の評価"));
  box.appendChild(cell(topMethod ? topMethod[0] : "—", "", "よく使う器具"));
}

/* ---------- タイマーの見た目 ---------- */
const DIAL_CIRCUMFERENCE = 2 * Math.PI * 88;

function renderTimerStatic() {
  const free = !timer.recipe;
  const idle = timer.state === "idle";

  $("timer-scale-row").hidden = free;
  $("timer-scale-row").classList.toggle("locked", !idle);
  if (!free) {
    $("scale-dose").textContent = String(scaledDose());
    $("scale-water").textContent = String(scaledWater());
    $("scale-ratio").textContent = ratioText(scaledDose(), scaledWater());
  }

  const toggle = $("timer-toggle");
  toggle.textContent = timer.state === "running" ? "一時停止"
    : timer.state === "paused" ? "つづける"
    : timer.state === "done" ? "もう一度" : "開始";
  toggle.classList.toggle("running", timer.state === "running");
  $("timer-lap").hidden = !free || timer.state === "idle";
  $("timer-to-log").hidden = !(timer.state === "done" || (free && timer.state !== "idle"));
  $("water-bar").hidden = free || !scaledWater();
  $("timer-total").textContent = free ? "レシピなし" : `/ ${fmtClock(timerTotalSec())}`;
  if (!free) $("water-goal").textContent = String(scaledWater());

  renderTimerTrack();
}

function renderTimerTrack() {
  const box = $("timer-steps");
  box.innerHTML = "";
  if (!timer.recipe) {
    if (!timer.laps.length) return;
    timer.laps.forEach((lap, i) => {
      const row = el("div", "track-step done");
      row.appendChild(el("span", "ts-time mono", fmtClock(lap / 1000)));
      row.appendChild(el("span", "ts-label", `${i + 1}回目`));
      box.appendChild(row);
    });
    return;
  }
  const steps = scaledSteps();
  const total = pourTotal(steps);
  steps.forEach((s, i) => {
    const row = el("div", "track-step");
    row.dataset.idx = String(i);
    row.appendChild(el("span", "ts-time mono", fmtClock(s.at)));
    const label = s.kind === "pour" && total > 1
      ? `${s.label || `${pourIndex(steps, i)}投目`}（${pourIndex(steps, i)}/${total}）`
      : (s.label || KIND_LABEL[s.kind] || "");
    row.appendChild(el("span", "ts-label", label));
    if (s.water) row.appendChild(el("span", "ts-water", `${s.water}g`));
    box.appendChild(row);
  });
}

function renderTimerLive() {
  const elapsedSec = timerElapsedMs() / 1000;
  $("timer-elapsed").textContent = fmtClock(elapsedSec);
  const dial = $("dial-progress");

  if (!timer.recipe) {
    /* レシピなしのときは、1分で一周する秒針のように回す */
    const p = (elapsedSec % 60) / 60;
    dial.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - p));
    $("timer-now-kind").textContent = timer.state === "running" ? "計測中" : "レシピなし";
    $("timer-now-label").textContent = timer.laps.length ? `${timer.laps.length}回 注いだ` : "自由に計る";
    $("timer-now-water").textContent = "";
    $("timer-next").textContent = "";
    return;
  }

  const steps = scaledSteps();
  const total = timerTotalSec();
  if (timer.state === "running") announceCrossedSteps(steps, elapsedSec);

  dial.style.strokeDashoffset = String(DIAL_CIRCUMFERENCE * (1 - Math.min(1, elapsedSec / (total || 1))));

  let curIdx = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i].at <= elapsedSec) curIdx = i; else break;
  const cur = curIdx >= 0 ? steps[curIdx] : null;
  const next = steps[curIdx + 1] || null;

  const kindEl = $("timer-now-kind");
  const labelEl = $("timer-now-label");
  const waterEl = $("timer-now-water");
  if (timer.state === "idle") {
    kindEl.textContent = "準備";
    labelEl.textContent = "開始を押してください";
    waterEl.textContent = `${scaledDose()}g の粉に ${scaledWater()}g`;
  } else if (cur) {
    const pt = pourTotal(steps);
    kindEl.textContent = cur.kind === "pour" && pt > 1
      ? `${KIND_LABEL.pour} ${pourIndex(steps, curIdx)}/${pt}`
      : (KIND_LABEL[cur.kind] || "手順");
    labelEl.textContent = cur.label || KIND_LABEL[cur.kind] || "";
    waterEl.textContent = cur.water ? `合計 ${cur.water}g まで` : (cur.note || "");
  } else {
    kindEl.textContent = "まもなく";
    labelEl.textContent = next ? (next.label || "") : "";
    waterEl.textContent = "";
  }

  const nextEl = $("timer-next");
  if (next && timer.state !== "done") {
    const left = Math.max(0, Math.ceil(next.at - elapsedSec));
    const name = next.label || KIND_LABEL[next.kind] || "次";
    nextEl.innerHTML = `次は「${escapeHtml(name)}」まで <span class="cd">${left}</span> 秒`;
  } else if (timer.state === "done") {
    nextEl.textContent = "できあがりです";
  } else {
    nextEl.textContent = "";
  }

  /* 湯量は「合計で何gまで」。直近の注ぎ手順の目標をそのまま見せる */
  const goal = scaledWater();
  if (goal) {
    let poured = 0;
    for (let i = 0; i <= curIdx; i++) if (steps[i].water) poured = steps[i].water;
    if (timer.state === "idle") poured = 0;
    $("water-now").textContent = String(poured);
    $("water-fill").style.width = `${Math.min(100, (poured / goal) * 100)}%`;
  }

  const rows = $("timer-steps").children;
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle("done", timer.state !== "idle" && i < curIdx);
    rows[i].classList.toggle("current", timer.state !== "idle" && i === curIdx);
  }

  if (timer.state === "running" && elapsedSec >= total) finishTimer();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* タイマーの操作 */
$("timer-toggle").addEventListener("click", () => {
  if (timer.state === "running") pauseTimer();
  else startTimer();
});
$("timer-reset").addEventListener("click", resetTimer);
$("timer-close").addEventListener("click", () => {
  if (timer.state === "running") pauseTimer();
  showScreen("brew");
  renderHome();
});
$("timer-lap").addEventListener("click", () => {
  if (timer.state !== "running") return;
  timer.laps.push(timerElapsedMs());
  playSoundNow("cue");
  buzz([60]);
  renderTimerTrack();
  renderTimerLive();
});
$("timer-mute").addEventListener("click", async () => {
  settings.chime = !settings.chime;
  await saveSettings();
  syncMuteIcon();
  if (timer.state === "running") scheduleUpcomingSounds(); else cancelScheduledSounds();
  toast(settings.chime ? "音を鳴らします" : "音を止めました");
});
function syncMuteIcon() {
  const svg = $("timer-mute").querySelector("svg");
  const on = settings.chime;
  svg.querySelector(".wave-1").style.display = on ? "" : "none";
  svg.querySelector(".wave-2").style.display = on ? "" : "none";
  svg.querySelector(".mute-x").style.display = on ? "none" : "";
  const box = $("s-chime");
  if (box) box.checked = on;
}

function changeScale(deltaG) {
  if (!timer.recipe || timer.state !== "idle") return;
  const base = timer.recipe.doseG || 15;
  const next = Math.max(5, Math.min(120, Math.round((scaledDose() + deltaG) * 10) / 10));
  timer.scale = next / base;
  renderTimerStatic();
  renderTimerLive();
}
$("scale-minus").addEventListener("click", () => changeScale(-1));
$("scale-plus").addEventListener("click", () => changeScale(1));

/* 淹れ終わったら、そのまま味の記録へ。器具や分量は書き写さなくていい */
$("timer-to-log").addEventListener("click", async () => {
  const draft = emptyBrew();
  draft.brewedAt = timer.startedAt || Date.now();
  draft.timeSec = Math.round(timerElapsedMs() / 1000);
  if (timer.recipe) {
    const r = timer.recipe;
    draft.recipeId = r.id;
    draft.recipeName = r.name;
    draft.method = r.method || "";
    draft.grind = r.grind || "";
    draft.doseG = scaledDose();
    draft.waterG = scaledWater();
    draft.tempC = r.tempC ?? null;
    const stored = findRecipe(r.id);
    if (stored) { stored.usedAt = Date.now(); await saveRecipe(stored); }
  }
  /* 前回と同じ豆を使うことが多いので、直近の記録から引き継ぐ */
  const last = liveBrews()[0];
  if (last) {
    draft.bean = last.bean;
    draft.roaster = last.roaster;
    draft.roast = last.roast;
    draft.grinder = last.grinder;
    if (!draft.method) draft.method = last.method;
  }
  openBrewEditor(draft, { isNew: true });
});

/* ---------- 記録の一覧 ---------- */
let logFilter = "all";
let logQuery = "";

function brewItem(brew) {
  const item = el("button", "brew-item");
  item.type = "button";
  const body = el("div", "bi-body");
  body.appendChild(el("div", "bi-title", brew.bean || brew.recipeName || brew.method || "名前のない一杯"));
  const bits = [];
  if (brew.method) bits.push(brew.method);
  if (brew.doseG && brew.waterG) bits.push(`${brew.doseG}g/${brew.waterG}g`);
  if (brew.doseG && brew.waterG) bits.push(ratioText(brew.doseG, brew.waterG));
  if (brew.tempC) bits.push(`${brew.tempC}℃`);
  if (brew.timeSec) bits.push(fmtClock(brew.timeSec));
  body.appendChild(el("div", "bi-sub", bits.join(" · ") || "—"));
  item.appendChild(body);

  const right = el("div", "bi-right");
  const stars = el("div", "stars-inline");
  stars.innerHTML = brew.rating ? starsHtml(brew.rating) : "";
  right.appendChild(stars);
  right.appendChild(el("div", "bi-date", fmtDate(brew.brewedAt)));
  item.appendChild(right);

  item.addEventListener("click", () => openBrewDetail(brew.id));
  return item;
}

function renderLog() {
  const all = liveBrews();
  let list = all;
  if (logFilter === "fav") list = list.filter((b) => (b.rating || 0) >= 4);
  if (logFilter === "month") {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    list = list.filter((b) => b.brewedAt >= from);
  }
  const q = logQuery.trim().toLowerCase();
  if (q) {
    list = list.filter((b) =>
      [b.bean, b.roaster, b.method, b.grinder, b.notes, b.next, b.recipeName, (b.flavors || []).join(" ")]
        .join(" ").toLowerCase().includes(q));
  }

  renderStats($("log-stats"), all);
  const box = $("log-list");
  box.innerHTML = "";
  $("log-empty").hidden = list.length > 0;
  if (!list.length) {
    $("log-empty").textContent = all.length
      ? "この条件に合う記録はありません。"
      : "まだ記録がありません。淹れたらここに残していきましょう。";
    return;
  }
  let lastKey = "";
  for (const b of list) {
    const d = new Date(b.brewedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      box.appendChild(el("div", "month-head", `${d.getFullYear()}年 ${d.getMonth() + 1}月`));
      lastKey = key;
    }
    box.appendChild(brewItem(b));
  }
}

$("log-search").addEventListener("input", (e) => { logQuery = e.target.value; renderLog(); });
$("log-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  logFilter = chip.dataset.filter;
  for (const c of $("log-filters").children) c.classList.toggle("active", c === chip);
  renderLog();
});
$("log-add-btn").addEventListener("click", () => {
  const draft = emptyBrew();
  const last = liveBrews()[0];
  if (last) {
    draft.bean = last.bean; draft.roaster = last.roaster; draft.roast = last.roast;
    draft.method = last.method; draft.grind = last.grind; draft.grinder = last.grinder;
    draft.doseG = last.doseG; draft.waterG = last.waterG; draft.tempC = last.tempC;
  }
  openBrewEditor(draft, { isNew: true });
});
$("home-manual-log-btn").addEventListener("click", () => $("log-add-btn").click());

/* ---------- 記録の詳細 ---------- */
const TASTE_AXES = [
  ["acidity", "酸味"], ["sweetness", "甘み"], ["bitterness", "苦味"],
  ["body", "コク"], ["aroma", "香り"],
];

/* 5つの軸をレーダーで描く。数字の羅列より、輪郭のほうが一杯ごとの
   違いを思い出しやすい */
function tasteRadar(taste) {
  const size = 220, cx = size / 2, cy = size / 2 + 6, R = 72;
  const n = TASTE_AXES.length;
  const point = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (R * Math.max(0, Math.min(5, v))) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  let svg = `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="味のバランス">`;
  for (let ring = 1; ring <= 5; ring++) {
    const pts = TASTE_AXES.map((_, i) => point(i, ring).map((v) => v.toFixed(1)).join(",")).join(" ");
    svg += `<polygon class="grid" points="${pts}"/>`;
  }
  TASTE_AXES.forEach((_, i) => {
    const [x, y] = point(i, 5);
    svg += `<line class="axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  });
  const shape = TASTE_AXES.map(([key], i) => point(i, taste?.[key] ?? 0).map((v) => v.toFixed(1)).join(",")).join(" ");
  svg += `<polygon class="shape" points="${shape}"/>`;
  TASTE_AXES.forEach(([, label], i) => {
    const [x, y] = point(i, 6.3);
    svg += `<text class="label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${label}</text>`;
  });
  return svg + "</svg>";
}

let detailId = "";

function openBrewDetail(id) {
  const b = findBrew(id);
  if (!b) return;
  detailId = id;
  $("detail-title").textContent = fmtDate(b.brewedAt) + " の一杯";

  const kv = (label, value, unit) =>
    `<div class="kv"><div class="kv-label">${label}</div><div class="kv-value">${value ?? "—"}${
      value != null && unit ? `<span class="unit">${unit}</span>` : ""}</div></div>`;

  const tags = (b.flavors || []).map((f) => `<span class="tag">${escapeHtml(f)}</span>`).join("");
  const note = (head, body) => body
    ? `<div class="note-block"><div class="note-head">${head}</div><div class="note-body">${escapeHtml(body)}</div></div>`
    : "";

  const sub = [b.roaster, b.roast, b.recipeName ? `レシピ: ${b.recipeName}` : "", fmtDateTime(b.brewedAt)]
    .filter(Boolean).join(" · ");

  $("detail-body").innerHTML = `
    <div class="detail-hero">
      <div class="dh-bean">${escapeHtml(b.bean || b.method || "名前のない一杯")}</div>
      <div class="dh-sub">${escapeHtml(sub)}</div>
      <div class="dh-stars">${b.rating ? starsHtml(b.rating) : '<span class="off">★★★★★</span>'}</div>
    </div>
    <div class="kv-grid">
      ${kv("粉", b.doseG, "g")}
      ${kv("湯", b.waterG, "g")}
      ${kv("比率", b.doseG && b.waterG ? ratioText(b.doseG, b.waterG) : null, "")}
      ${kv("湯温", b.tempC, "℃")}
      ${kv("時間", b.timeSec ? fmtClock(b.timeSec) : null, "")}
      ${kv("挽き目", b.grind || null, "")}
    </div>
    ${b.method || b.grinder ? `<div class="note-block"><div class="note-head">道具</div><div class="note-body">${
      escapeHtml([b.method, b.grinder].filter(Boolean).join(" / "))}</div></div>` : ""}
    <div class="radar-box">${tasteRadar(b.taste)}</div>
    ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    ${note("感想", b.notes)}
    ${note("次はこうする", b.next)}
    <button class="wide-btn primary" id="detail-rebrew" type="button">同じレシピで淹れる</button>
    <button class="wide-btn ghost" id="detail-copy" type="button">これをもとに新しく記録する</button>
  `;

  const rebrew = $("detail-rebrew");
  const recipe = b.recipeId ? findRecipe(b.recipeId) : null;
  if (recipe) {
    rebrew.addEventListener("click", () => openTimer(recipe));
  } else {
    rebrew.textContent = "レシピなしで計る";
    rebrew.addEventListener("click", () => openTimer(null));
  }
  $("detail-copy").addEventListener("click", () => {
    const copy = { ...JSON.parse(JSON.stringify(b)), id: newId(), brewedAt: Date.now(),
      rating: 0, notes: "", next: "", createdAt: Date.now() };
    openBrewEditor(copy, { isNew: true });
  });

  showScreen("brew-detail");
}

$("detail-edit").addEventListener("click", () => {
  const b = findBrew(detailId);
  if (b) openBrewEditor(JSON.parse(JSON.stringify(b)), { isNew: false });
});

/* ---------- 記録の編集 ---------- */
const FLAVOR_PRESETS = [
  "フローラル", "ベリー", "柑橘", "りんご", "ぶどう", "はちみつ",
  "チョコ", "ナッツ", "キャラメル", "スパイス", "紅茶", "青草", "焦げ",
];
let editingBrew = null;
let editingIsNew = false;

function refreshSuggestLists() {
  const fill = (id, values) => {
    const dl = $(id);
    if (!dl) return;
    dl.innerHTML = "";
    for (const v of [...new Set(values.filter(Boolean))].slice(0, 40)) {
      const opt = document.createElement("option");
      opt.value = v;
      dl.appendChild(opt);
    }
  };
  const all = liveBrews();
  fill("bean-suggest", all.map((b) => b.bean));
  fill("roaster-suggest", all.map((b) => b.roaster));
  fill("grinder-suggest", all.map((b) => b.grinder));
}

function openBrewEditor(brew, { isNew }) {
  editingBrew = brew;
  editingIsNew = isNew;
  refreshSuggestLists();
  $("brew-edit-title").textContent = isNew ? "記録する" : "記録を直す";
  $("brew-delete").hidden = isNew;

  $("f-brewed-at").value = toLocalInput(brew.brewedAt);
  $("f-bean").value = brew.bean || "";
  $("f-roaster").value = brew.roaster || "";
  $("f-roast").value = brew.roast || "";
  $("f-method").value = brew.method || "";
  $("f-grind").value = brew.grind || "";
  $("f-grinder").value = brew.grinder || "";
  $("f-dose").value = brew.doseG ?? "";
  $("f-water").value = brew.waterG ?? "";
  $("f-temp").value = brew.tempC ?? "";
  $("f-time").value = brew.timeSec ? fmtClock(brew.timeSec) : "";
  $("f-notes").value = brew.notes || "";
  $("f-next").value = brew.next || "";
  updateRatioReadout();
  renderStarPicker();
  renderTasteSliders();
  renderFlavorChips();
  showScreen("brew-edit");
}

function updateRatioReadout() {
  $("f-ratio").textContent = ratioText(num($("f-dose").value), num($("f-water").value));
}
$("f-dose").addEventListener("input", updateRatioReadout);
$("f-water").addEventListener("input", updateRatioReadout);

function renderStarPicker() {
  const box = $("f-rating");
  box.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const b = el("button", `star${i <= (editingBrew.rating || 0) ? " on" : ""}`, "★");
    b.type = "button";
    b.setAttribute("aria-label", `${i}点`);
    b.addEventListener("click", () => {
      /* 同じ星をもう一度押したら取り消し。付け間違いを直せるように */
      editingBrew.rating = editingBrew.rating === i ? 0 : i;
      renderStarPicker();
    });
    box.appendChild(b);
  }
}

function renderTasteSliders() {
  const box = $("f-taste");
  box.innerHTML = "";
  for (const [key, label] of TASTE_AXES) {
    const row = el("div", "taste-row");
    row.appendChild(el("span", "taste-name", label));
    const input = document.createElement("input");
    input.type = "range";
    input.min = "1"; input.max = "5"; input.step = "1";
    input.value = String(editingBrew.taste?.[key] ?? 3);
    const out = el("span", "taste-val mono", input.value);
    input.addEventListener("input", () => {
      editingBrew.taste = editingBrew.taste || {};
      editingBrew.taste[key] = Number(input.value);
      out.textContent = input.value;
    });
    row.appendChild(input);
    row.appendChild(out);
    box.appendChild(row);
  }
}

function renderFlavorChips() {
  const box = $("f-flavors");
  box.innerHTML = "";
  const chosen = editingBrew.flavors || [];
  const all = [...new Set([...FLAVOR_PRESETS, ...chosen])];
  for (const name of all) {
    const chip = el("button", `chip${chosen.includes(name) ? " active" : ""}`, name);
    chip.type = "button";
    chip.addEventListener("click", () => {
      const list = editingBrew.flavors || (editingBrew.flavors = []);
      const i = list.indexOf(name);
      if (i >= 0) list.splice(i, 1); else list.push(name);
      renderFlavorChips();
    });
    box.appendChild(chip);
  }
}

$("f-flavor-add").addEventListener("click", () => {
  const input = $("f-flavor-input");
  const value = input.value.trim();
  if (!value) return;
  editingBrew.flavors = editingBrew.flavors || [];
  if (!editingBrew.flavors.includes(value)) editingBrew.flavors.push(value);
  input.value = "";
  renderFlavorChips();
});
$("f-flavor-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("f-flavor-add").click(); }
});

$("brew-save").addEventListener("click", async () => {
  const b = editingBrew;
  b.brewedAt = fromLocalInput($("f-brewed-at").value);
  b.bean = $("f-bean").value.trim();
  b.roaster = $("f-roaster").value.trim();
  b.roast = $("f-roast").value;
  b.method = $("f-method").value.trim();
  b.grind = $("f-grind").value;
  b.grinder = $("f-grinder").value.trim();
  b.doseG = num($("f-dose").value);
  b.waterG = num($("f-water").value);
  b.tempC = num($("f-temp").value);
  b.timeSec = parseClock($("f-time").value);
  b.notes = $("f-notes").value.trim();
  b.next = $("f-next").value.trim();
  await saveBrew(b);
  toast(editingIsNew ? "記録しました" : "直しました");
  renderHome();
  renderLog();
  openBrewDetail(b.id);
});

$("brew-delete").addEventListener("click", async () => {
  if (!(await confirmAsk("この記録を削除します。よろしいですか。"))) return;
  await removeRecord("brews", editingBrew.id);
  toast("削除しました");
  renderHome();
  renderLog();
  showScreen("log");
});

/* ---------- レシピの一覧 ---------- */
function renderRecipes() {
  const box = $("recipe-list");
  box.innerHTML = "";
  const list = liveRecipes();
  if (!list.length) {
    box.appendChild(el("p", "empty-note", "レシピがありません。右上の＋から作れます。"));
    return;
  }
  for (const r of list) box.appendChild(recipeCard(r, true));
}
$("recipe-add-btn").addEventListener("click", () => openRecipeEditor(null));

/* ---------- レシピの編集 ---------- */
let editingRecipe = null;
let editingRecipeIsNew = false;

function openRecipeEditor(id) {
  const found = id ? findRecipe(id) : null;
  editingRecipe = found ? JSON.parse(JSON.stringify(found)) : emptyRecipe();
  editingRecipeIsNew = !found;
  $("recipe-edit-title").textContent = found ? "レシピを直す" : "レシピを作る";
  $("recipe-delete").hidden = !found;
  $("r-name").value = editingRecipe.name || "";
  $("r-method").value = editingRecipe.method || "";
  $("r-grind").value = editingRecipe.grind || "";
  $("r-dose").value = editingRecipe.doseG ?? "";
  $("r-water").value = editingRecipe.waterG ?? "";
  $("r-temp").value = editingRecipe.tempC ?? "";
  $("r-total").value = fmtClock(editingRecipe.totalSec || 0);
  $("r-memo").value = editingRecipe.memo || "";
  renderStepEditor();
  showScreen("recipe-edit");
}

function renderStepEditor() {
  const box = $("r-steps");
  box.innerHTML = "";
  editingRecipe.steps.forEach((step, i) => {
    const row = el("div", "step-row");

    const grid = el("div", "step-grid");
    const timeField = el("div", "field mini w-time");
    timeField.innerHTML = '<label>時刻</label>';
    const timeInput = document.createElement("input");
    timeInput.type = "text";
    timeInput.inputMode = "numeric";
    timeInput.value = fmtClock(step.at);
    timeInput.addEventListener("change", () => {
      step.at = parseClock(timeInput.value) ?? 0;
      editingRecipe.steps.sort((a, b) => a.at - b.at);
      renderStepEditor();
    });
    timeField.appendChild(timeInput);
    grid.appendChild(timeField);

    const kindField = el("div", "field mini w-kind");
    kindField.innerHTML = '<label>種類</label>';
    const kindSelect = document.createElement("select");
    for (const [value, label] of Object.entries(KIND_LABEL)) {
      const opt = document.createElement("option");
      opt.value = value; opt.textContent = label;
      if (step.kind === value) opt.selected = true;
      kindSelect.appendChild(opt);
    }
    kindSelect.addEventListener("change", () => {
      step.kind = kindSelect.value;
      if (step.kind !== "pour") step.water = 0;
      renderStepEditor();
    });
    kindField.appendChild(kindSelect);
    grid.appendChild(kindField);

    const waterField = el("div", "field mini w-water");
    waterField.innerHTML = '<label>合計g</label>';
    const waterInput = document.createElement("input");
    waterInput.type = "number";
    waterInput.inputMode = "decimal";
    waterInput.min = "0";
    waterInput.value = step.water || "";
    waterInput.disabled = step.kind !== "pour";
    waterInput.addEventListener("input", () => { step.water = num(waterInput.value, 0) || 0; });
    waterField.appendChild(waterInput);
    grid.appendChild(waterField);

    const del = el("button", "step-del");
    del.type = "button";
    del.setAttribute("aria-label", "この手順を消す");
    del.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", () => {
      editingRecipe.steps.splice(i, 1);
      renderStepEditor();
    });
    grid.appendChild(del);
    row.appendChild(grid);

    const labelField = el("div", "field mini");
    labelField.style.marginBottom = "0";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = step.kind === "pour" ? "例）2投目" : "例）泡を沈める";
    labelInput.value = step.label || "";
    labelInput.addEventListener("input", () => { step.label = labelInput.value; });
    labelField.appendChild(labelInput);
    row.appendChild(labelField);

    box.appendChild(row);
  });
}

$("r-add-step").addEventListener("click", () => {
  const steps = editingRecipe.steps;
  const last = steps[steps.length - 1];
  steps.push({
    at: last ? last.at + 30 : 0,
    kind: "pour",
    water: last?.water ? last.water + 60 : 60,
    label: "", note: "",
  });
  renderStepEditor();
});

$("recipe-save").addEventListener("click", async () => {
  const r = editingRecipe;
  r.name = $("r-name").value.trim() || "名前のないレシピ";
  r.method = $("r-method").value.trim();
  r.grind = $("r-grind").value;
  r.doseG = num($("r-dose").value, 15);
  r.waterG = num($("r-water").value, 240);
  r.tempC = num($("r-temp").value);
  r.memo = $("r-memo").value.trim();
  r.steps = r.steps
    .filter((s) => s.kind && Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);
  const lastAt = r.steps.length ? r.steps[r.steps.length - 1].at : 0;
  /* 合計時間が手順より短いと、最後の手順が鳴る前に終わってしまう */
  r.totalSec = Math.max(parseClock($("r-total").value) ?? 0, lastAt);
  await saveRecipe(r);
  toast(editingRecipeIsNew ? "レシピを作りました" : "保存しました");
  renderRecipes();
  renderHome();
  showScreen("recipes");
});

$("recipe-delete").addEventListener("click", async () => {
  if (!(await confirmAsk("このレシピを削除します。よろしいですか。"))) return;
  await removeRecord("recipes", editingRecipe.id);
  toast("削除しました");
  renderRecipes();
  renderHome();
  showScreen("recipes");
});

$("free-timer-btn").addEventListener("click", () => openTimer(null));

/* ---------- 設定 ---------- */
function bindSwitch(id, key, after) {
  const box = $(id);
  box.addEventListener("change", async () => {
    settings[key] = box.checked;
    await saveSettings();
    if (after) after();
  });
}

function renderSettings() {
  $("s-chime").checked = settings.chime;
  $("s-precue").checked = settings.precue;
  $("s-voice").checked = settings.voice;
  $("s-vibe").checked = settings.vibe;
  $("s-wakelock").checked = settings.wakelock;
  $("s-volume").value = String(settings.volume);
  $("s-volume-out").textContent = `${settings.volume}%`;
  $("s-theme").value = settings.theme;
  $("app-version").textContent = `v${APP_VERSION}`;
  $("s-data-note").textContent =
    `この端末に レシピ ${liveRecipes().length}件 / 記録 ${liveBrews().length}件`;
}

bindSwitch("s-chime", "chime", () => { syncMuteIcon(); if (timer.state === "running") scheduleUpcomingSounds(); });
bindSwitch("s-precue", "precue", () => { if (timer.state === "running") scheduleUpcomingSounds(); });
bindSwitch("s-voice", "voice");
bindSwitch("s-vibe", "vibe");
bindSwitch("s-wakelock", "wakelock", () => {
  if (settings.wakelock && timer.state === "running") acquireWakeLock(); else releaseWakeLock();
});
$("s-volume").addEventListener("input", (e) => {
  settings.volume = Number(e.target.value);
  $("s-volume-out").textContent = `${settings.volume}%`;
});
$("s-volume").addEventListener("change", saveSettings);
$("s-test-chime").addEventListener("click", () => { playSoundNow("step"); speak("2投目。160グラムまで"); });
$("s-theme").addEventListener("change", async (e) => {
  settings.theme = e.target.value;
  applyTheme();
  await saveSettings();
});

/* ---------- CSVで持ち出す ---------- *
 *  記録はこの端末の中にしかないので、持ち出す道を用意する。1杯が1行、
 *  1レシピが1行の表にして、表計算ソフトへ渡す。
 * ------------------------------------------------------------------ */
function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

/* RFC 4180 に沿って組む。区切り・引用符・改行を含む値だけを引用符でくくり、
   中の引用符は2つ重ねて逃がす。
   先頭のBOMは Excel のため。これが無いと、日本語がそのまま化ける */
function toCsv(headers, rows) {
  const cell = (v) => {
    const t = v == null ? "" : String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/* 時間は「3:00」と「180」の両方を出す。読むためと、並べ替え・計算のため */
function brewsCsv() {
  const headers = [
    "日時", "豆", "焙煎所", "焙煎度", "器具", "挽き目", "ミル・目盛り",
    "粉(g)", "湯(g)", "比率", "湯温(℃)", "抽出時間", "抽出秒数", "レシピ",
    "総合評価", "酸味", "甘み", "苦味", "コク", "香り", "風味", "感想", "次はこうする",
  ];
  const rows = liveBrews().slice().reverse().map((b) => [
    fmtDateTime(b.brewedAt),
    b.bean, b.roaster, b.roast, b.method, b.grind, b.grinder,
    b.doseG ?? "", b.waterG ?? "",
    b.doseG && b.waterG ? ratioText(b.doseG, b.waterG) : "",
    b.tempC ?? "",
    b.timeSec ? fmtClock(b.timeSec) : "", b.timeSec ?? "",
    b.recipeName,
    b.rating || "",
    ...TASTE_AXES.map(([key]) => b.taste?.[key] ?? ""),
    (b.flavors || []).join(" / "),
    b.notes, b.next,
  ]);
  return toCsv(headers, rows);
}

/* 手順は行を分けず、1つの欄にまとめる。1レシピ=1行のほうが表として扱いやすい */
function recipesCsv() {
  const headers = [
    "レシピ名", "器具", "挽き目", "粉(g)", "湯(g)", "比率", "湯温(℃)",
    "合計時間", "手順数", "手順", "メモ",
  ];
  const rows = liveRecipes().map((r) => {
    const steps = (r.steps || []).slice().sort((a, b) => a.at - b.at);
    const text = steps.map((st) =>
      [fmtClock(st.at), st.label || KIND_LABEL[st.kind] || "", st.water ? `${st.water}g` : ""]
        .filter(Boolean).join(" ")).join(" / ");
    return [
      r.name, r.method, r.grind, r.doseG ?? "", r.waterG ?? "",
      ratioText(r.doseG, r.waterG), r.tempC ?? "",
      fmtClock(r.totalSec || 0), steps.length, text, r.memo,
    ];
  });
  return toCsv(headers, rows);
}

$("s-export-csv").addEventListener("click", () => {
  const n = liveBrews().length;
  if (!n) { toast("書き出せる記録がまだありません"); return; }
  downloadFile(`coffeerence-records-${today()}.csv`, brewsCsv(), "text/csv;charset=utf-8");
  toast(`記録${n}件をCSVにしました`);
});

$("s-export-recipes-csv").addEventListener("click", () => {
  const n = liveRecipes().length;
  if (!n) { toast("書き出せるレシピがありません"); return; }
  downloadFile(`coffeerence-recipes-${today()}.csv`, recipesCsv(), "text/csv;charset=utf-8");
  toast(`レシピ${n}件をCSVにしました`);
});

$("s-restore-recipes").addEventListener("click", async () => {
  const existing = new Set(liveRecipes().map((r) => r.name));
  const add = starterRecipes().filter((r) => !existing.has(r.name));
  if (!add.length) { toast("すでに全部そろっています"); return; }
  recipes.push(...add);
  await idbPutMany("recipes", add);
  renderRecipes(); renderHome(); renderSettings();
  toast(`${add.length}件を入れ直しました`);
});

/* ------------------------------------------------------------------ *
 * 8. 起動
 * ------------------------------------------------------------------ */
for (const btn of document.querySelectorAll("[data-nav]")) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.nav;
    if (name === "brew") renderHome();
    if (name === "log") renderLog();
    if (name === "recipes") renderRecipes();
    if (name === "settings") renderSettings();
    showScreen(name);
  });
}
for (const btn of document.querySelectorAll("[data-back]")) {
  btn.addEventListener("click", goBack);
}
window.addEventListener("popstate", () => {
  navSuppressHistory = true;
  goBack();
  navSuppressHistory = false;
});

/* タイマーを動かしたまま離れようとしたら、一度だけ引き止める */
window.addEventListener("beforeunload", (e) => {
  if (timer.state !== "running") return;
  e.preventDefault();
  e.returnValue = "";
});

async function boot() {
  settings = { ...DEFAULT_SETTINGS, ...(await kvGet("settings", {})) };
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

  recipes = await idbAll("recipes");
  brews = await idbAll("brews");

  /* 空っぽの画面から始めさせない。最初の一度だけ、よく知られた
     レシピを置いておく（消したあとに勝手に戻ってこないよう印を残す） */
  if (!recipes.length && !(await kvGet("seeded", false))) {
    const starters = starterRecipes();
    recipes = starters;
    await idbPutMany("recipes", starters);
    await kvSet("seeded", true);
  }

  $("build-tag").textContent = `#${String(MERGE_COUNT).padStart(3, "0")}`;
  syncMuteIcon();
  renderHome();
  renderLog();
  renderRecipes();
  renderSettings();
  showScreen("brew");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .catch((err) => console.warn("Service Workerを登録できませんでした:", err));
  }
}

boot().catch((err) => {
  console.error("起動に失敗しました:", err);
  document.body.innerHTML =
    '<p style="padding:40px;text-align:center;line-height:2;">'
    + "アプリを開けませんでした。<br>ページを再読み込みしてみてください。</p>";
});
